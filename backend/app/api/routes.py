"""HTTP API for the annotation platform.

Route groups: auth, admin, projects, detection, images, annotations,
YOLO export, dashboards and file downloads.
"""
import hmac
import time
from datetime import datetime
from collections import Counter
from pathlib import Path
from urllib import response

from fastapi import (
    APIRouter,
    Cookie,
    Depends,
    File,
    Form,
    Header,
    HTTPException,
    Query,
    Request,
    Response,
    UploadFile,
)
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import FileResponse
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.database import get_db
from app.core.logging_config import get_logger
from app.models.user import User
from app.schemas import (
    AdminDashboard,
    AdminUserOut,
    AnnotationSaveRequest,
    CreateAdminRequest,
    DashboardStats,
    BatchDetectionResponse,
    DetectionResponse,
    ImageSummary,
    LoginRequest,
    ProjectCreate,
    ProjectOut,
    ProjectUpdate,
    RegisterRequest,
    ResetPasswordRequest,
    SkippedFile,
    UserOut,
)
from app.services import annotation as svc
from app.services import auth as auth_svc
from app.services import export as exporter

logger = get_logger("annotateai.api")
router = APIRouter()

BACKEND_DIR = Path(__file__).resolve().parents[2]
LABELS_DIR = BACKEND_DIR / "annotated" / "labeled"
LABELS_DIR.mkdir(parents=True, exist_ok=True)

MAX_UPLOAD_BYTES = settings.max_upload_mb * 1024 * 1024


# Failed logins, keyed on (ip, email) rather than ip alone - behind nginx or
# Docker every user shares the proxy's address, so an IP-only key would let one
# person's typo lock out everybody. In-process, so it resets on restart and is
# not shared between workers; swap in Redis if this ever runs on more than one.
_login_attempts: dict[tuple[str, str], list[float]] = {}


def client_ip_of(request: Request) -> str:
    """The caller's address, preferring the X-Real-IP nginx sets."""
    forwarded = (request.headers.get("x-real-ip") or "").strip()
    if forwarded:
        return forwarded
    return request.client.host if request.client else "unknown"


def _drop_old_attempts(now: float) -> None:
    """Drop keys whose failures have aged out, so the dict can't grow forever."""
    window = settings.login_attempt_window_seconds
    for key in [k for k, times in _login_attempts.items() if all(now - t >= window for t in times)]:
        del _login_attempts[key]


def check_login_rate_limit(key: tuple[str, str]) -> None:
    now = time.time()
    _drop_old_attempts(now)
    window = settings.login_attempt_window_seconds
    recent = [t for t in _login_attempts.get(key, []) if now - t < window]
    if recent:
        _login_attempts[key] = recent
    if len(recent) >= settings.login_max_attempts:
        raise HTTPException(
            status_code=429,
            detail="Too many login attempts. Please wait a few minutes and try again.",
        )


def record_login_failure(key: tuple[str, str]) -> None:
    _login_attempts.setdefault(key, []).append(time.time())


def clear_login_failures(key: tuple[str, str]) -> None:
    _login_attempts.pop(key, None)


def _token_from_request(
    authorization: str | None,
    cookie_token: str | None,
    query_token: str | None,
) -> str | None:
    """Token from the Authorization header (fetch), a cookie (so plain <img>
    tags can load protected files) or a query parameter (downloads)."""
    if authorization and authorization.startswith("Bearer "):
        return authorization[7:].strip()
    return cookie_token or query_token or None


def auth_user(
    authorization: str | None = Header(default=None),
    query_token: str | None = Query(default=None, alias="token"),
    cookie_token: str | None = Cookie(default=None, alias=settings.auth_cookie_name),
    db: Session = Depends(get_db),
) -> User:
    token = _token_from_request(authorization, cookie_token, query_token)
    if not token:
        raise HTTPException(status_code=401, detail="Authentication required")

    user = auth_svc.get_user_from_token(db, token)
    if not user:
        raise HTTPException(status_code=401, detail="Invalid or expired session")
    return user


def admin_user(current: User = Depends(auth_user)) -> User:
    if current.role != "admin":
        raise HTTPException(status_code=403, detail="Administrator access required")
    return current


def scope_for(user: User) -> int | None:
    """Read scope for project/image queries.

    Users and team leads are view-only roles that can see the shared workspace.
    Admins can see everything. Annotators are restricted to projects they own.
    """
    if user.role in {"admin", "user", "team_lead"}:
        return None
    return user.id


def can_create_project(user: User) -> bool:
    return user.role in {"admin", "annotator"}


def can_edit_project(user: User) -> bool:
    return user.role in {"admin", "annotator"}


def can_delete_project(user: User) -> bool:
    return user.role == "admin"


def can_annotate(user: User) -> bool:
    return user.role in {"admin", "annotator"}


def _issue_session(response: Response, user: User) -> UserOut:
    """Create the access token, drop it in a cookie and return the login body."""
    token = auth_svc.create_access_token(user)
    response.set_cookie(
        key=settings.auth_cookie_name,
        value=token,
        max_age=settings.access_token_ttl_seconds,
        httponly=True,
        samesite="lax",
        secure=settings.auth_cookie_secure,
    )
    return UserOut(
        id=user.id,
        name=user.name,
        email=user.email,
        role=user.role,
        created_at=user.created_at,
        access_token=token,
    )


def _page_size(limit: int | None) -> int:
    return min(limit or settings.default_page_size, settings.max_page_size)


@router.post("/auth/register", response_model=UserOut)
def register(payload: RegisterRequest, response: Response, db: Session = Depends(get_db)):
    email = payload.email.strip().lower()
    if db.query(User).filter(User.email == email).first():
        raise HTTPException(status_code=409, detail="An account with this email already exists")

    role = payload.role.strip().lower()
    if role == "admin":
        # The setup key bootstraps the first admin only. It is a long-lived
        # shared secret, so anyone who saw it must not keep minting admins -
        # after the first, an existing admin creates the next.
        if db.query(User).filter(User.role == "admin").count() > 0:
            raise HTTPException(
                status_code=403,
                detail="An administrator already exists. Ask an existing "
                "administrator to create your account.",
            )
        entered = (payload.setup_key or "").strip()
        configured = (settings.admin_setup_key or "").strip()
        if not (entered and configured and hmac.compare_digest(entered, configured)):
            raise HTTPException(status_code=403, detail="Invalid Admin Setup Key")

    user = auth_svc.create_user(db, payload.name, email, payload.password, role=role)
    logger.info("Registered user %s (%s)", user.id, role)
    return _issue_session(response, user)


@router.post("/auth/login", response_model=UserOut)
def login(
    payload: LoginRequest,
    request: Request,
    response: Response,
    db: Session = Depends(get_db),
):
    attempt_key = (
        client_ip_of(request),
        payload.email.strip().lower(),
    )

    check_login_rate_limit(attempt_key)

    user = auth_svc.authenticate(
        db,
        payload.email,
        payload.password,
    )

    selected_role = payload.role.strip().lower()

    if not user or user.role != selected_role:
        record_login_failure(attempt_key)

        raise HTTPException(
            status_code=401,
            detail="Invalid email, password or account type",
        )

    clear_login_failures(attempt_key)

    # Record login time
    user.login_time = datetime.utcnow()

    # User is currently logged in
    user.logout_time = None

    db.commit()
    db.refresh(user)

    logger.info("Login: user %s", user.id)

    return _issue_session(response, user)


@router.post("/auth/reset-password")
def reset_password(
    payload: ResetPasswordRequest,
    db: Session = Depends(get_db),
):
    email = payload.email.strip().lower()

    user = db.query(User).filter(User.email == email).first()

    if not user:
        raise HTTPException(
            status_code=404,
            detail="No account found with this email address",
        )

    user.password_hash = auth_svc.hash_password(payload.password)

    db.commit()

    logger.info("Password reset for user %s", user.id)

    return {
        "success": True,
        "message": "Password reset successfully",
    }


@router.post("/auth/logout")
def logout(
    response: Response,
    db: Session = Depends(get_db),
    current_user: User = Depends(auth_user),
):
    # Record logout time
    current_user.logout_time = datetime.utcnow()

    db.commit()

    # Remove authentication cookie
    response.delete_cookie(
        settings.auth_cookie_name,
        httponly=True,
        samesite="lax",
        secure=settings.auth_cookie_secure,
    )

    logger.info("Logout: user %s", current_user.id)

    return {
        "success": True,
        "logout_time": current_user.logout_time,
    }


@router.get("/auth/me", response_model=AdminUserOut)
def whoami(current_user: User = Depends(auth_user)):
    return AdminUserOut.model_validate(current_user, from_attributes=True)


@router.post("/admin/create", response_model=UserOut)
def create_admin(
    payload: CreateAdminRequest,
    response: Response,
    db: Session = Depends(get_db),
    authorization: str | None = Header(default=None),
    cookie_token: str | None = Cookie(default=None, alias=settings.auth_cookie_name),
):
    email = payload.email.strip().lower()
    if db.query(User).filter(User.email == email).first():
        raise HTTPException(status_code=409, detail="An account with this email already exists")

    admin_count = db.query(User).filter(User.role == "admin").count()
    authorized = False

    if admin_count == 0:
        entered = (payload.setup_key or "").strip()
        configured = (settings.admin_setup_key or "").strip()
        authorized = bool(entered and configured and hmac.compare_digest(entered, configured))
    else:
        token = _token_from_request(authorization, cookie_token, None)
        current = auth_svc.get_user_from_token(db, token) if token else None
        authorized = bool(current and current.role == "admin")

    if not authorized:
        raise HTTPException(
            status_code=403,
            detail="Admin creation requires the setup key for the first admin, "
            "or an existing admin account.",
        )

    user = auth_svc.create_user(db, payload.name, email, payload.password, role="admin")
    logger.info("Created admin %s", user.id)
    return _issue_session(response, user)


@router.get("/admin/dashboard", response_model=AdminDashboard)
def admin_dashboard(db: Session = Depends(get_db), _admin: User = Depends(admin_user)):
    users = db.query(User).order_by(User.created_at.desc()).all()
    images = svc.list_images(db)
    total_objects = sum(len(svc.get_active_boxes(image)) for image in images)

    return AdminDashboard(
        total_users=sum(1 for u in users if u.role == "user"),
        total_admins=sum(1 for u in users if u.role == "admin"),
        total_images=len(images),
        total_objects=total_objects,
        users=[AdminUserOut.model_validate(u, from_attributes=True) for u in users],
    )


@router.get("/health")
def health():
    return {"status": "ok", "service": settings.app_name}


def _project_out(project) -> ProjectOut:
    return ProjectOut(
        id=project.id,
        name=project.name,
        description=project.description,
        created_at=project.created_at,
        image_count=len(project.images),
    )


@router.post("/projects", response_model=ProjectOut, status_code=201)
def create_project(
    payload: ProjectCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(auth_user),
):
    if not can_create_project(current_user):
        raise HTTPException(status_code=403, detail="Only annotators and administrators can create projects")

    name = payload.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="Project name is required")
    # Only clashes with this user's own projects matter.
    duplicate = (
        db.query(svc.Project)
        .filter(svc.Project.name == name, svc.Project.owner_id == current_user.id)
        .first()
    )
    if duplicate:
        raise HTTPException(status_code=409, detail="A project with this name already exists")

    description = payload.description.strip() if payload.description else None
    try:
        project = svc.create_project(db, name, current_user.id, description)
    except IntegrityError:
        # The check above lost a race with another request from the same user.
        db.rollback()
        raise HTTPException(
            status_code=409, detail="A project with this name already exists"
        ) from None
    logger.info("Project %s created by user %s", project.id, current_user.id)
    return ProjectOut(
        id=project.id,
        name=project.name,
        description=project.description,
        created_at=project.created_at,
        image_count=0,
    )


@router.get("/projects", response_model=list[ProjectOut])
def list_projects(
    db: Session = Depends(get_db),
    current_user: User = Depends(auth_user),
    limit: int | None = Query(default=None, ge=1),
    offset: int = Query(default=0, ge=0),
):
    projects = svc.list_projects(
        db, owner_id=scope_for(current_user), limit=_page_size(limit), offset=offset
    )
    return [_project_out(p) for p in projects]


@router.get("/projects/{project_id}", response_model=ProjectOut)
def get_project(
    project_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(auth_user),
):
    project = svc.get_project(db, project_id, owner_id=scope_for(current_user))
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    return _project_out(project)


@router.put("/projects/{project_id}", response_model=ProjectOut)
def update_project(
    project_id: int,
    payload: ProjectUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(auth_user),
):
    if not can_edit_project(current_user):
        raise HTTPException(status_code=403, detail="This role has view-only project access")

    project = svc.get_project(db, project_id, owner_id=scope_for(current_user))
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    name = payload.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="Project name is required")

    duplicate = (
        db.query(svc.Project)
        .filter(
            svc.Project.name == name,
            svc.Project.id != project_id,
            svc.Project.owner_id == project.owner_id,
        )
        .first()
    )
    if duplicate:
        raise HTTPException(status_code=409, detail="A project with this name already exists")

    project.name = name
    project.description = payload.description.strip() if payload.description else None
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(
            status_code=409, detail="A project with this name already exists"
        ) from None
    db.refresh(project)
    return _project_out(project)


def _delete_image_files(image) -> None:
    for path in (image.original_path, image.annotated_path):
        if path:
            try:
                Path(path).unlink(missing_ok=True)
            except OSError:
                logger.warning("Could not delete %s", path)
    try:
        (LABELS_DIR / f"{image.id}.txt").unlink(missing_ok=True)
    except OSError:
        pass


@router.delete("/projects/{project_id}")
def delete_project(
    project_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(auth_user),
):
    if not can_delete_project(current_user):
        raise HTTPException(status_code=403, detail="Only administrators can delete projects")

    project = svc.get_project(db, project_id, owner_id=scope_for(current_user))
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    for image in list(project.images):
        _delete_image_files(image)

    db.delete(project)
    db.commit()
    logger.info("Project %s deleted by user %s", project_id, current_user.id)
    return {"success": True, "message": "Project deleted successfully", "project_id": project_id}


def _validate_confidence(value: float | None) -> None:
    if value is not None and not (0.05 <= value <= 0.99):
        raise HTTPException(
            status_code=400,
            detail="Confidence threshold must be between 0.05 and 0.99",
        )


def _run_detection(
    db, content, filename, project_id, confidence_threshold, owner_id, scope
) -> dict:
    try:
        image = svc.process_image(
            db, content, filename,
            owner_id=owner_id,
            project_id=project_id,
            confidence_threshold=confidence_threshold,
            project_scope=scope,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return svc.image_to_response(image)


@router.post("/detect", response_model=DetectionResponse)
async def detect_image(
    file: UploadFile = File(...),
    project_id: int | None = Form(default=None),
    confidence_threshold: float | None = Form(default=None),
    db: Session = Depends(get_db),
    current_user: User = Depends(auth_user),
):
    if current_user.role not in {"admin", "annotator"}:
        raise HTTPException(status_code=403, detail="Only annotators and administrators can upload or run detection")

    if not file.content_type or not file.content_type.startswith("image/"):
        raise HTTPException(status_code=400, detail="Please upload an image file")
    _validate_confidence(confidence_threshold)

    content = await file.read()
    if not content:
        raise HTTPException(status_code=400, detail="The uploaded file is empty")
    if len(content) > MAX_UPLOAD_BYTES:
        raise HTTPException(
            status_code=413, detail=f"Image is larger than {settings.max_upload_mb} MB"
        )

    # YOLO inference is CPU-bound; run it off the event loop so it never
    # blocks other requests.
    return await run_in_threadpool(
        _run_detection, db, content, file.filename or "upload.jpg",
        project_id, confidence_threshold, current_user.id, scope_for(current_user),
    )


@router.post("/detect/batch", response_model=BatchDetectionResponse)
async def detect_batch(
    files: list[UploadFile] = File(...),
    project_id: int | None = Form(default=None),
    confidence_threshold: float | None = Form(default=None),
    db: Session = Depends(get_db),
    current_user: User = Depends(auth_user),
):
    if current_user.role not in {"admin", "annotator"}:
        raise HTTPException(status_code=403, detail="Only annotators and administrators can upload or run detection")

    _validate_confidence(confidence_threshold)
    if len(files) > settings.max_batch_files:
        raise HTTPException(
            status_code=400,
            detail=f"Please upload at most {settings.max_batch_files} images at once",
        )

    payloads: list[tuple[bytes, str]] = []
    skipped: list[SkippedFile] = []
    for file in files:
        name = file.filename or "upload.jpg"
        if not file.content_type or not file.content_type.startswith("image/"):
            skipped.append(SkippedFile(filename=name, reason="not an image file"))
            continue
        content = await file.read()
        if not content:
            skipped.append(SkippedFile(filename=name, reason="the file is empty"))
            continue
        if len(content) > MAX_UPLOAD_BYTES:
            skipped.append(
                SkippedFile(
                    filename=name,
                    reason=f"larger than {settings.max_upload_mb} MB",
                )
            )
            continue
        payloads.append((content, name))

    if not payloads:
        reasons = "; ".join(f"{s.filename}: {s.reason}" for s in skipped[:5])
        raise HTTPException(
            status_code=400,
            detail=f"No valid images in the upload. {reasons}" if reasons
            else "No valid images in the upload",
        )

    owner_id, scope = current_user.id, scope_for(current_user)

    def _process_all() -> list[dict]:
        return [
            _run_detection(
                db, content, name, project_id, confidence_threshold, owner_id, scope
            )
            for content, name in payloads
        ]

    results = await run_in_threadpool(_process_all)
    return BatchDetectionResponse(results=results, skipped=skipped)


@router.get("/images", response_model=list[ImageSummary])
def list_images(
    db: Session = Depends(get_db),
    current_user: User = Depends(auth_user),
    project_id: int | None = None,
    limit: int | None = Query(default=None, ge=1),
    offset: int = Query(default=0, ge=0),
):
    images = svc.list_images(
        db,
        project_id=project_id,
        owner_id=scope_for(current_user),
        limit=_page_size(limit),
        offset=offset,
    )
    return [svc.image_summary(image) for image in images]


@router.get("/images/{image_id}", response_model=DetectionResponse)
def get_image(
    image_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(auth_user),
):
    image = svc.get_image(db, image_id, owner_id=scope_for(current_user))
    if not image:
        raise HTTPException(status_code=404, detail="Image not found")
    return svc.image_to_response(image)


@router.put("/images/{image_id}/annotations", response_model=DetectionResponse)
def update_annotations(
    image_id: int,
    payload: AnnotationSaveRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(auth_user),
):
    if not can_annotate(current_user):
        raise HTTPException(status_code=403, detail="This role has view-only annotation access")

    image = svc.get_image(db, image_id, owner_id=scope_for(current_user))
    if not image:
        raise HTTPException(status_code=404, detail="Image not found")

    annotations = [a.model_dump() for a in payload.annotations]
    image = svc.save_annotations(db, image, annotations)
    logger.info("Saved %d annotations for image %s", len(annotations), image_id)
    return svc.image_to_response(image)


@router.post("/projects/{project_id}/save-annotations")
def save_project_annotations(
    project_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(auth_user),
):
    if not can_annotate(current_user):
        raise HTTPException(status_code=403, detail="This role has view-only annotation access")

    scope = scope_for(current_user)
    project = svc.get_project(db, project_id, owner_id=scope)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    saved = 0
    for image in svc.list_images(db, project_id=project_id, owner_id=scope):
        if svc.get_active_boxes(image):
            svc.export_yolo_file(image)
            saved += 1

    return {
        "success": True,
        "message": f"Annotations saved for {saved} image(s).",
        "project_id": project_id,
        "images_saved": saved,
    }


EXPORT_FILENAMES = {
    "simple": "annotations",
    "yolo": "yolo",
    "coco": "coco",
    "voc": "pascal_voc",
    "csv": "csv",
}


def _build_export(
    db: Session,
    project_id: int,
    current_user: User,
    fmt: str,
    val_ratio: float,
    test_ratio: float,
    only_reviewed: bool,
) -> FileResponse:
    fmt = (fmt or "yolo").strip().lower()
    if fmt not in exporter.FORMATS:
        raise HTTPException(
            status_code=400,
            detail=f"Unknown format '{fmt}'. Choose one of: {', '.join(exporter.FORMATS)}.",
        )
    # No train/val/test folders in this format, so the ratios mean nothing.
    if fmt in exporter.SPLITLESS_FORMATS:
        val_ratio = test_ratio = 0.0
    if not 0 <= val_ratio < 1 or not 0 <= test_ratio < 1 or val_ratio + test_ratio >= 1:
        raise HTTPException(
            status_code=400,
            detail="val and test shares must each be under 1, and leave something for training.",
        )

    scope = scope_for(current_user)
    project = svc.get_project(db, project_id, owner_id=scope)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    images = svc.list_images(db, project_id=project_id, owner_id=scope)
    plan = exporter.build_plan(
        images,
        val_ratio=val_ratio,
        test_ratio=test_ratio,
        only_reviewed=only_reviewed,
        seed=project_id,
    )
    if not plan["items"]:
        if only_reviewed:
            detail = (
                "No reviewed images to export. Review some images first, or turn "
                "off 'reviewed only'."
            )
        else:
            detail = "This project has no images to export"
        raise HTTPException(status_code=400, detail=detail)

    export_root = Path(settings.annotated_dir) / "exports"
    # Per-user filename, so simultaneous exports can't overwrite each other.
    stem = f"annotateai_{EXPORT_FILENAMES[fmt]}_project_{project_id}_u{current_user.id}"
    zip_path = export_root / f"{stem}.zip"
    exporter.write_archive(zip_path, plan, fmt, project)

    return FileResponse(
        path=zip_path,
        media_type="application/zip",
        filename=f"{stem}.zip",
    )


@router.get("/export")
def export_dataset(
    project_id: int,
    fmt: str = Query(default="yolo", alias="format"),
    val_ratio: float = Query(default=0.2, ge=0, lt=1),
    test_ratio: float = Query(default=0.0, ge=0, lt=1),
    only_reviewed: bool = Query(default=False),
    db: Session = Depends(get_db),
    current_user: User = Depends(auth_user),
):
    """Download a project as a training dataset.

    format:
      simple  images sorted into annotated/ and not_annotated/, plus one
              annotations.json of pixel coordinates. No train/val/test.
      yolo    Ultralytics: images/ + labels/ + data.yaml
      coco    COCO detection JSON
      voc     Pascal VOC XML
      csv     one row per box

    Apart from "simple", the split is deterministic per project, so the same
    image always lands in the same split whichever format you ask for.
    """
    return _build_export(
        db, project_id, current_user, fmt, val_ratio, test_ratio, only_reviewed
    )


@router.get("/export-yolo")
def export_yolo_dataset(
    project_id: int,
    val_ratio: float = Query(default=0.2, ge=0, lt=1),
    test_ratio: float = Query(default=0.0, ge=0, lt=1),
    only_reviewed: bool = Query(default=False),
    db: Session = Depends(get_db),
    current_user: User = Depends(auth_user),
):
    """YOLO export. Kept as its own path so existing links keep working."""
    return _build_export(
        db, project_id, current_user, "yolo", val_ratio, test_ratio, only_reviewed
    )


@router.post("/images/{image_id}/export-yolo")
def export_yolo_text(
    image_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(auth_user),
):
    image = svc.get_image(db, image_id, owner_id=scope_for(current_user))
    if not image:
        raise HTTPException(status_code=404, detail="Image not found")

    lines, skipped = svc.yolo_lines_with_skipped(image)
    if skipped:
        names = ", ".join(f'"{name}"' for name in skipped)
        is_are = "is not a COCO class" if len(skipped) == 1 else "are not COCO classes"
        raise HTTPException(
            status_code=400,
            detail=(
                f"{names} {is_are}, so there is no class id to write in a "
                "single-image label file. Export the whole project instead - that "
                "download builds its own class list and includes custom classes."
            ),
        )
    if not lines:
        raise HTTPException(status_code=400, detail="No annotations available to export")

    file_path = LABELS_DIR / f"{image_id}.txt"
    file_path.write_text("\n".join(lines), encoding="utf-8")
    return FileResponse(file_path, media_type="text/plain", filename=f"{image_id}.txt")


@router.get("/dashboard", response_model=DashboardStats)
def dashboard(db: Session = Depends(get_db), current_user: User = Depends(auth_user)):
    return svc.dashboard_stats(db, owner_id=scope_for(current_user))


@router.get("/project-dashboard/{project_id}")
def project_dashboard(
    project_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(auth_user),
):
    scope = scope_for(current_user)
    project = svc.get_project(db, project_id, owner_id=scope)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    images = svc.list_images(db, project_id=project_id, owner_id=scope)
    total_objects = 0
    annotated_images = 0
    reviewed_images = 0
    class_names: list[str] = []
    recent_images = []

    for image in images:
        boxes = svc.get_active_boxes(image)
        total_objects += len(boxes)
        class_names.extend(box.class_name for box in boxes)

        if image.status == "reviewed":
            reviewed_images += 1
            annotated_images += 1
        elif image.status == "annotated":
            annotated_images += 1

        if len(recent_images) < 20:
            recent_images.append(svc.image_summary(image))

    counter = Counter(class_names)
    class_counts = [
        {"class_name": name, "count": count}
        for name, count in sorted(counter.items(), key=lambda kv: (-kv[1], kv[0]))
    ]

    return {
        "project": {
            "id": project.id,
            "name": project.name,
            "description": project.description,
            "created_at": project.created_at,
        },
        "total_images": len(images),
        "total_objects": total_objects,
        "annotated_images": annotated_images,
        "reviewed_images": reviewed_images,
        "class_counts": class_counts,
        "recent_images": recent_images,
    }


def _serve_image_file(
    db: Session, image_id: int, annotated: bool, owner_id: int | None
) -> FileResponse:
    image = svc.get_image(db, image_id, owner_id=owner_id)
    if not image:
        raise HTTPException(status_code=404, detail="Image not found")

    stored = image.annotated_path if annotated else image.original_path
    if not stored or not Path(stored).exists():
        raise HTTPException(status_code=404, detail="File not found")

    prefix = "annotated_" if annotated else ""
    return FileResponse(stored, filename=f"{prefix}{image.filename}")


@router.get("/files/original/{image_id}")
def get_original(
    image_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(auth_user),
):
    return _serve_image_file(
        db, image_id, annotated=False, owner_id=scope_for(current_user)
    )


@router.get("/files/annotated/{image_id}")
def get_annotated(
    image_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(auth_user),
):
    return _serve_image_file(
        db, image_id, annotated=True, owner_id=scope_for(current_user)
    )
