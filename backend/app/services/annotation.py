"""Project / image / annotation logic that sits between the API and the DB."""
import uuid
from collections import Counter
from pathlib import Path

from sqlalchemy.orm import Session, selectinload

from app.core.config import settings
from app.core.logging_config import get_logger
from app.models.annotation import Annotation, Detection, ImageAsset, Project
from app.services.detector import detector_service

logger = get_logger("annotateai.annotation")

# COCO classes in YOLOv8 order - the index is the class id, so don't reorder.
YOLO_CLASSES = [
    "person", "bicycle", "car", "motorcycle", "airplane", "bus", "train",
    "truck", "boat", "traffic light", "fire hydrant", "stop sign",
    "parking meter", "bench", "bird", "cat", "dog", "horse", "sheep", "cow",
    "elephant", "bear", "zebra", "giraffe", "backpack", "umbrella", "handbag",
    "tie", "suitcase", "frisbee", "skis", "snowboard", "sports ball", "kite",
    "baseball bat", "baseball glove", "skateboard", "surfboard",
    "tennis racket", "bottle", "wine glass", "cup", "fork", "knife", "spoon",
    "bowl", "banana", "apple", "sandwich", "orange", "broccoli", "carrot",
    "hot dog", "pizza", "donut", "cake", "chair", "couch", "potted plant",
    "bed", "dining table", "toilet", "tv", "laptop", "mouse", "remote",
    "keyboard", "cell phone", "microwave", "oven", "toaster", "sink",
    "refrigerator", "book", "clock", "vase", "scissors", "teddy bear",
    "hair drier", "toothbrush",
]

_CLASS_ID = {name: i for i, name in enumerate(YOLO_CLASSES)}

LABELS_DIR = Path(settings.annotated_dir) / "labeled"


def yolo_class_id(class_name: str) -> int:
    """YOLO class id for a name, or -1 if it isn't a COCO class."""
    return _CLASS_ID.get(str(class_name or "").strip().lower(), -1)


def _clamp01(value: float) -> float:
    return min(1.0, max(0.0, value))


# owner_id scopes a query to the signed-in user. None means no filter, and is
# admin-only - see routes.scope_for().

def create_project(
    db: Session, name: str, owner_id: int, description: str | None = None
) -> Project:
    project = Project(
        owner_id=owner_id,
        name=name.strip(),
        description=description.strip() if description else None,
    )
    db.add(project)
    db.commit()
    db.refresh(project)
    return project


def list_projects(
    db: Session,
    owner_id: int | None = None,
    limit: int | None = None,
    offset: int = 0,
) -> list[Project]:
    query = db.query(Project).options(selectinload(Project.images))
    if owner_id is not None:
        query = query.filter(Project.owner_id == owner_id)
    query = query.order_by(Project.created_at.desc(), Project.id.desc())
    if offset:
        query = query.offset(offset)
    if limit is not None:
        query = query.limit(limit)
    return query.all()


def get_project(db: Session, project_id: int, owner_id: int | None = None) -> Project | None:
    """Fetch one project, or None if it is missing or not this user's.

    Both cases look the same on purpose: a 404 must not reveal that a project
    exists under another owner.
    """
    query = db.query(Project).filter(Project.id == project_id)
    if owner_id is not None:
        query = query.filter(Project.owner_id == owner_id)
    return query.first()


def save_upload(file_bytes: bytes, filename: str) -> Path:
    """Write the upload under a random name and return the path."""
    extension = Path(filename).suffix.lower() or ".jpg"
    destination = Path(settings.upload_dir) / f"{uuid.uuid4().hex}{extension}"
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_bytes(file_bytes)
    return destination


def process_image(
    db: Session,
    file_bytes: bytes,
    filename: str,
    owner_id: int,
    project_id: int | None = None,
    confidence_threshold: float | None = None,
    project_scope: int | None = None,
) -> ImageAsset:
    """Save an upload, run YOLO on it and store the image and its detections.

    project_scope is the owner filter for the project lookup, so nobody can add
    images to another user's project by guessing its id.
    """
    if project_id is not None and not get_project(db, project_id, owner_id=project_scope):
        raise ValueError(f"Project with ID {project_id} does not exist")

    original_path = save_upload(file_bytes, filename)
    annotated_path = Path(settings.annotated_dir) / f"ann_{original_path.name}"

    try:
        result = detector_service.detect(
            original_path, confidence_threshold=confidence_threshold
        )
        detections = result.get("detections", [])

        annotated_path.parent.mkdir(parents=True, exist_ok=True)
        detector_service.draw_boxes(original_path, detections, annotated_path)

        image = ImageAsset(
            owner_id=owner_id,
            project_id=project_id,
            filename=filename,
            original_path=str(original_path),
            annotated_path=str(annotated_path),
            width=int(result.get("width", 0)),
            height=int(result.get("height", 0)),
            status="annotated",
        )
        db.add(image)
        db.flush()  # need image.id for the child rows

        for det in detections:
            fields = dict(
                image_id=image.id,
                class_name=str(det.get("class_name", "unknown")).strip(),
                confidence=float(det.get("confidence", 0.0)),
                x=float(det.get("x", 0)),
                y=float(det.get("y", 0)),
                width=float(det.get("width", 0)),
                height=float(det.get("height", 0)),
            )
            # Detection keeps the AI's original result; Annotation is the
            # reviewer's working copy.
            db.add(Detection(**fields, is_deleted=0))
            db.add(Annotation(**fields, source="ai"))

        db.commit()
        db.refresh(image)
        logger.info("Processed %s -> %d objects", filename, len(detections))
        return image

    except Exception:
        # The transaction rolled back, so drop the files too.
        db.rollback()
        original_path.unlink(missing_ok=True)
        annotated_path.unlink(missing_ok=True)
        raise


def list_images(
    db: Session,
    project_id: int | None = None,
    owner_id: int | None = None,
    limit: int | None = None,
    offset: int = 0,
) -> list[ImageAsset]:
    """Images, newest first, with their boxes eager-loaded.

    Every caller reads the boxes straight afterwards, so lazy loading would
    cost two extra queries per image.
    """
    query = (
        db.query(ImageAsset)
        .options(selectinload(ImageAsset.detections), selectinload(ImageAsset.annotations))
        .order_by(ImageAsset.created_at.desc(), ImageAsset.id.desc())
    )
    if project_id is not None:
        query = query.filter(ImageAsset.project_id == project_id)
    if owner_id is not None:
        query = query.filter(ImageAsset.owner_id == owner_id)
    if offset:
        query = query.offset(offset)
    if limit is not None:
        query = query.limit(limit)
    return query.all()


def get_image(db: Session, image_id: int, owner_id: int | None = None) -> ImageAsset | None:
    query = db.query(ImageAsset).filter(ImageAsset.id == image_id)
    if owner_id is not None:
        query = query.filter(ImageAsset.owner_id == owner_id)
    return query.first()


def get_active_boxes(image: ImageAsset) -> list:
    """Current boxes: reviewed annotations once reviewed, else live detections.

    The test is on status alone, never on whether the annotation list is empty.
    An empty reviewed list means the reviewer deleted everything; falling back
    to detections there would restore the AI's boxes into the export.
    """
    if image.status == "reviewed":
        return list(image.annotations or [])
    return [d for d in (image.detections or []) if not d.is_deleted]


def class_counts_from_boxes(boxes: list) -> list[dict]:
    counter = Counter(
        str(box.class_name) for box in boxes if getattr(box, "class_name", None)
    )
    return [
        {"class_name": name, "count": count}
        for name, count in sorted(counter.items(), key=lambda kv: (-kv[1], kv[0].lower()))
    ]


def box_to_dict(box) -> dict:
    return {
        "id": getattr(box, "id", None),
        "class_name": box.class_name,
        "confidence": float(box.confidence),
        "x": float(box.x),
        "y": float(box.y),
        "width": float(box.width),
        "height": float(box.height),
        "source": getattr(box, "source", "ai"),
    }


def image_summary(image: ImageAsset) -> dict:
    """The shape every list screen uses: image info plus its current boxes."""
    boxes = get_active_boxes(image)
    return {
        "id": image.id,
        "filename": image.filename,
        "status": image.status,
        "width": image.width,
        "height": image.height,
        "created_at": image.created_at,
        "total_objects": len(boxes),
        "class_counts": class_counts_from_boxes(boxes),
        "detections": [box_to_dict(box) for box in boxes],
    }


def image_to_response(image: ImageAsset) -> dict:
    boxes = get_active_boxes(image)
    return {
        "image_id": image.id,
        "project_id": image.project_id,
        "filename": image.filename,
        "width": image.width,
        "height": image.height,
        "status": image.status,
        "original_url": f"/api/files/original/{image.id}",
        "annotated_url": (
            f"/api/files/annotated/{image.id}" if image.annotated_path else None
        ),
        "detections": [box_to_dict(box) for box in boxes],
        "class_counts": class_counts_from_boxes(boxes),
        "total_objects": len(boxes),
    }


def _clean_box(raw: dict) -> dict | None:
    """Validate one box from the client; return None to skip it."""
    class_name = str(raw.get("class_name", "")).strip()
    if not class_name:
        return None
    try:
        box = {
            "class_name": class_name,
            "confidence": min(1.0, max(0.0, float(raw.get("confidence", 1.0)))),
            "x": float(raw.get("x", 0)),
            "y": float(raw.get("y", 0)),
            "width": float(raw.get("width", 0)),
            "height": float(raw.get("height", 0)),
            "source": raw.get("source", "human"),
        }
    except (TypeError, ValueError):
        return None
    if box["width"] <= 0 or box["height"] <= 0:
        return None
    return box


def save_annotations(db: Session, image: ImageAsset, annotations: list[dict]) -> ImageAsset:
    """Replace the image's annotations with the reviewer's version, redraw the
    preview and regenerate the YOLO label file."""
    db.query(Annotation).filter(Annotation.image_id == image.id).delete(
        synchronize_session=False
    )

    cleaned = [box for box in (_clean_box(raw) for raw in annotations) if box]
    for box in cleaned:
        db.add(Annotation(image_id=image.id, **box))

    annotated_path = (
        Path(image.annotated_path)
        if image.annotated_path
        else Path(settings.annotated_dir) / f"ann_{Path(image.original_path).name}"
    )
    annotated_path.parent.mkdir(parents=True, exist_ok=True)
    detector_service.draw_boxes(Path(image.original_path), cleaned, annotated_path)

    image.annotated_path = str(annotated_path)
    image.status = "reviewed"
    db.commit()
    db.refresh(image)

    export_yolo_file(image)  # keep the .txt label file in sync
    return image


def clip_box(box, image_width: float, image_height: float) -> tuple[float, float, float, float] | None:
    """Trim a pixel box to the image, or None if nothing is left inside.

    Drawing past the border is normal; a label file describing a box outside
    the image is not, and training tools reject it.
    """
    x1 = max(0.0, min(float(box.x), image_width))
    y1 = max(0.0, min(float(box.y), image_height))
    x2 = max(0.0, min(float(box.x) + float(box.width), image_width))
    y2 = max(0.0, min(float(box.y) + float(box.height), image_height))
    width, height = x2 - x1, y2 - y1
    if width <= 0 or height <= 0:
        return None
    return x1, y1, width, height


def yolo_line(box, image_width, image_height, class_id: int | None = None) -> str | None:
    """One YOLO label line, normalised to 0-1, or None if it can't be used.

    class_id defaults to the COCO id for the class name; the dataset export
    passes its own ids, which have to match its data.yaml.

    Clip before normalising - clamping the centre and the size separately lets
    an overhanging box describe a region outside the image, which Ultralytics
    discards as "non-normalized or out of bounds coordinates".
    """
    if class_id is None:
        class_id = yolo_class_id(getattr(box, "class_name", None))

    width, height = float(image_width or 0), float(image_height or 0)
    if class_id < 0 or width <= 0 or height <= 0:
        return None

    clipped = clip_box(box, width, height)
    if clipped is None:
        return None
    x, y, w, h = clipped

    cx = _clamp01((x + w / 2) / width)
    cy = _clamp01((y + h / 2) / height)
    nw = _clamp01(w / width)
    nh = _clamp01(h / height)
    return f"{class_id} {cx:.6f} {cy:.6f} {nw:.6f} {nh:.6f}"


def yolo_lines_with_skipped(image: ImageAsset) -> tuple[list[str], list[str]]:
    """Label lines for one image, plus the class names left out.

    Per-image files use the global COCO ids, so a custom class the reviewer
    typed has no id to write under. The project export handles those, since it
    builds its own class list.
    """
    lines: list[str] = []
    skipped: list[str] = []
    for box in get_active_boxes(image):
        line = yolo_line(box, image.width, image.height)
        if line:
            lines.append(line)
            continue
        name = str(getattr(box, "class_name", "") or "").strip()
        if name and yolo_class_id(name) < 0 and name not in skipped:
            skipped.append(name)
    return lines, skipped


def export_yolo_file(image: ImageAsset) -> Path:
    LABELS_DIR.mkdir(parents=True, exist_ok=True)
    lines, skipped = yolo_lines_with_skipped(image)
    if skipped:
        logger.warning(
            "Image %s: %s not in the COCO class list, left out of %s.txt "
            "(the project export still includes them)",
            image.id, ", ".join(skipped), image.id,
        )
    output_path = LABELS_DIR / f"{image.id}.txt"
    output_path.write_text("\n".join(lines), encoding="utf-8")
    return output_path


def dashboard_stats(db: Session, owner_id: int | None = None) -> dict:
    images = list_images(db, owner_id=owner_id)
    class_names: list[str] = []
    recent = []
    annotated = reviewed = 0

    for image in images:
        class_names.extend(box.class_name for box in get_active_boxes(image))
        if image.status in ("annotated", "reviewed"):
            annotated += 1
        if image.status == "reviewed":
            reviewed += 1
        # Only the newest few are returned, so skip summaries for the rest.
        if len(recent) < 20:
            recent.append(image_summary(image))

    counter = Counter(class_names)
    return {
        "total_images": len(images),
        "total_objects": len(class_names),
        "annotated_images": annotated,
        "reviewed_images": reviewed,
        "class_counts": [
            {"class_name": name, "count": count}
            for name, count in sorted(counter.items(), key=lambda kv: (-kv[1], kv[0].lower()))
        ],
        "recent_images": recent,
    }
