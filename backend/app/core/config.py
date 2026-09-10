import logging
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

logger = logging.getLogger("annotateai")

# These are only meant for local development. If they are still in use when the
# app starts we print a warning so nobody ships them to a real server.
DEV_TOKEN_SECRET = "annotateai-local-development-token-secret-change-me"
DEV_ADMIN_SETUP_KEY = "annotateai-admin-setup"

# Full path, not just ".env" - otherwise the file is only picked up when the
# server happens to be launched from backend/, and ignored everywhere else.
BACKEND_DIR = Path(__file__).resolve().parents[2]
ENV_FILE = BACKEND_DIR / ".env"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=ENV_FILE, extra="ignore")

    app_name: str = "AI Annotation Platform"
    api_prefix: str = "/api"
    database_url: str = "sqlite:///./annotation.db"
    upload_dir: Path = Path("uploads")
    annotated_dir: Path = Path("annotated")
    yolo_model: str = "yolov8n.pt"
    confidence_threshold: float = 0.50

    # Auth / security
    admin_setup_key: str = DEV_ADMIN_SETUP_KEY
    token_secret: str = DEV_TOKEN_SECRET
    access_token_ttl_seconds: int = 60 * 60 * 12
    login_max_attempts: int = 5
    login_attempt_window_seconds: int = 15 * 60
    auth_cookie_name: str = "annotateai_token"
    auth_cookie_secure: bool = False  # set True when served over HTTPS

    # Uploads / detection
    max_upload_mb: int = 50
    # Per request, not per project - the browser splits a big folder into
    # several requests, so this only guards against a proxy timeout.
    max_batch_files: int = 100
    upload_chunk_size: int = 20

    # Pagination
    default_page_size: int = 200
    max_page_size: int = 1000

    # Runtime
    log_level: str = "INFO"
    environment: str = "development"  # development | production

    cors_origins: list[str] = [
        "http://localhost:5173",
        "http://localhost:3000",
        "http://127.0.0.1:5173",
        "http://127.0.0.1:3000",
    ]

    @property
    def is_production(self) -> bool:
        return self.environment.lower() == "production"


settings = Settings()

_insecure = []
if settings.token_secret == DEV_TOKEN_SECRET:
    _insecure.append("TOKEN_SECRET")
if settings.admin_setup_key == DEV_ADMIN_SETUP_KEY:
    _insecure.append("ADMIN_SETUP_KEY")

if _insecure:
    message = (
        f"{' and '.join(_insecure)} still set to the built-in development "
        "value(s). Set them in backend/.env before deploying."
    )
    if settings.is_production:
        raise RuntimeError(message)
    logger.warning(message)

settings.upload_dir.mkdir(parents=True, exist_ok=True)
settings.annotated_dir.mkdir(parents=True, exist_ok=True)
