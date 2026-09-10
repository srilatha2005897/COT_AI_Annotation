import threading
import time
import uuid
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy import inspect, text

from app.api.routes import router
from app.core.config import settings
from app.core.database import Base, engine
from app.core.logging_config import configure_logging, get_logger
from app.models import Annotation, Detection, ImageAsset, Project, User  # noqa: F401
from app.services.detector import DetectorService

configure_logging(settings.log_level)
logger = get_logger("annotateai")


def run_startup_migration() -> None:
    """Dev convenience: create tables and patch older SQLite databases.

    In production, set ENVIRONMENT=production and manage the schema with
    Alembic instead (`alembic upgrade head`).
    """
    if settings.is_production:
        logger.info("Production mode: skipping auto-migration, run `alembic upgrade head`")
        return

    Base.metadata.create_all(bind=engine)

    if not settings.database_url.startswith("sqlite"):
        return

    with engine.begin() as conn:
        columns = {col["name"] for col in inspect(conn).get_columns("users")}
        if "role" not in columns:
            conn.execute(
                text(
                    "ALTER TABLE users "
                    "ADD COLUMN role VARCHAR(20) NOT NULL DEFAULT 'user'"
                )
            )

        # Projects and images gained an owner, so adopt pre-existing rows to
        # the earliest account.
        first_user = conn.execute(text("SELECT MIN(id) FROM users")).scalar()
        for table in ("projects", "images"):
            existing = {col["name"] for col in inspect(conn).get_columns(table)}
            if "owner_id" in existing:
                continue
            conn.execute(text(f"ALTER TABLE {table} ADD COLUMN owner_id INTEGER"))
            if first_user is None:
                # No accounts, so nothing here belongs to anybody.
                conn.execute(text(f"DELETE FROM {table}"))
                continue
            conn.execute(
                text(f"UPDATE {table} SET owner_id = :uid WHERE owner_id IS NULL"),
                {"uid": first_user},
            )
            logger.info("Assigned existing %s to user %s", table, first_user)

        _drop_global_project_name_unique(conn)


def _drop_global_project_name_unique(conn) -> None:
    """Rebuild ``projects`` if it still carries the old global UNIQUE(name).

    Names are unique per owner now, but SQLite can't drop a column constraint in
    place - ALTER TABLE ADD COLUMN leaves the old one behind, and two people
    would still collide on a project called "Test". Copying the rows through a
    fresh table is the only way to be rid of it.
    """
    definition = conn.execute(
        text("SELECT sql FROM sqlite_master WHERE type='table' AND name='projects'")
    ).scalar() or ""
    if "UNIQUE (name)" not in definition and "UNIQUE(name)" not in definition:
        return

    # Keep SQLite from helpfully re-pointing other tables' foreign keys at the
    # renamed table while we swap it out.
    conn.exec_driver_sql("PRAGMA legacy_alter_table = ON")
    try:
        conn.execute(text("ALTER TABLE projects RENAME TO projects_old"))
        # Index names are database-wide, so free them before recreating.
        for index in ("ix_projects_id", "ix_projects_owner_id"):
            conn.execute(text(f"DROP INDEX IF EXISTS {index}"))

        Project.__table__.create(bind=conn)
        conn.execute(
            text(
                "INSERT INTO projects (id, owner_id, name, description, created_at) "
                "SELECT id, owner_id, name, description, created_at "
                "FROM projects_old WHERE owner_id IS NOT NULL"
            )
        )
        conn.execute(text("DROP TABLE projects_old"))
        logger.info("Rebuilt projects table: names are now unique per owner")
    finally:
        conn.exec_driver_sql("PRAGMA legacy_alter_table = OFF")


@asynccontextmanager
async def lifespan(_app: FastAPI):
    logger.info("Starting %s (%s)", settings.app_name, settings.environment)
    run_startup_migration()
    # Load the YOLO weights in the background so the first upload is fast.
    threading.Thread(target=DetectorService.warm_up, daemon=True).start()
    yield
    logger.info("Shutting down")


app = FastAPI(
    title=settings.app_name,
    description="AI-assisted image annotation. AI labels first, and humans do the rest.",
    version="1.3.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def request_logger(request: Request, call_next):
    request_id = request.headers.get("x-request-id") or uuid.uuid4().hex[:12]
    started = time.perf_counter()
    try:
        response = await call_next(request)
    except Exception:
        elapsed = (time.perf_counter() - started) * 1000
        logger.exception(
            "%s %s -> 500 (%.0f ms) [%s]",
            request.method,
            request.url.path,
            elapsed,
            request_id,
        )
        raise

    elapsed = (time.perf_counter() - started) * 1000
    logger.info(
        "%s %s -> %s (%.0f ms) [%s]",
        request.method,
        request.url.path,
        response.status_code,
        elapsed,
        request_id,
    )
    response.headers["x-request-id"] = request_id
    return response


@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception):
    logger.exception("Unhandled error on %s %s", request.method, request.url.path)
    return JSONResponse(
        status_code=500,
        content={"detail": "Something went wrong. Please try again."},
    )


app.include_router(router, prefix=settings.api_prefix)


@app.get("/")
def root():
    return {
        "name": settings.app_name,
        "version": app.version,
        "docs": "/docs",
        "health": f"{settings.api_prefix}/health",
    }
