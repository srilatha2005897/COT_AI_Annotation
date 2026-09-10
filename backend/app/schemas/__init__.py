import re
from datetime import datetime
from typing import Annotated

from pydantic import AfterValidator, BaseModel, ConfigDict, Field

EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def _valid_email(value: str) -> str:
    value = value.strip().lower()
    if not EMAIL_RE.match(value):
        raise ValueError("Please enter a valid email address")
    return value


# A lowercase, format-checked email string.
EmailField = Annotated[str, AfterValidator(_valid_email)]


class ORMModel(BaseModel):
    """Base for anything built straight from a SQLAlchemy row."""

    model_config = ConfigDict(from_attributes=True)


# Images and boxes


class BoundingBox(BaseModel):
    id: int | None = None
    class_name: str
    confidence: float = 1.0
    x: float
    y: float
    width: float
    height: float
    source: str = "ai"


class ClassCount(BaseModel):
    class_name: str
    count: int


class ImageSummary(ORMModel):
    id: int
    filename: str
    status: str
    width: int
    height: int
    created_at: datetime
    total_objects: int
    class_counts: list[ClassCount]
    # Boxes ride along so list screens don't fetch every image one by one.
    detections: list[BoundingBox] = Field(default_factory=list)


class DetectionResponse(BaseModel):
    image_id: int
    project_id: int | None = None
    filename: str
    width: int
    height: int
    status: str
    original_url: str
    annotated_url: str | None = None
    detections: list[BoundingBox]
    class_counts: list[ClassCount]
    total_objects: int


class SkippedFile(BaseModel):
    """A file the batch upload could not use, and why."""

    filename: str
    reason: str


class BatchDetectionResponse(BaseModel):
    results: list[DetectionResponse]
    # Rejects are named rather than silently dropped.
    skipped: list[SkippedFile] = Field(default_factory=list)


class AnnotationUpdate(BaseModel):
    class_name: str
    confidence: float = 1.0
    x: float
    y: float
    width: float
    height: float
    source: str = "human"


class AnnotationSaveRequest(BaseModel):
    annotations: list[AnnotationUpdate] = Field(default_factory=list)


# Projects


class ProjectCreate(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    description: str | None = Field(default=None, max_length=2000)


class ProjectUpdate(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    description: str | None = Field(default=None, max_length=2000)


class ProjectOut(ORMModel):
    id: int
    name: str
    description: str | None = None
    created_at: datetime
    image_count: int = 0


class DashboardStats(BaseModel):
    total_images: int
    total_objects: int
    annotated_images: int
    reviewed_images: int
    class_counts: list[ClassCount]
    recent_images: list[ImageSummary]


# Auth


class RegisterRequest(BaseModel):
    name: str = Field(min_length=2, max_length=120)
    email: EmailField = Field(min_length=5, max_length=255)
    password: str = Field(min_length=8, max_length=128)
    role: str = Field(default="user", pattern="^(user|annotator|team_lead|admin)$")
    setup_key: str | None = Field(default=None, max_length=255)


class LoginRequest(BaseModel):
    email: EmailField = Field(min_length=5, max_length=255)
    # No min_length on purpose - a short password is a failed login, not a
    # 422, so the rule isn't leaked to whoever is guessing.
    password: str = Field(min_length=1, max_length=128)
    role: str = Field(default="user", pattern="^(user|annotator|team_lead|admin)$")


class UserOut(ORMModel):
    id: int
    name: str
    email: str
    role: str
    created_at: datetime
    access_token: str


# Admin


class CreateAdminRequest(BaseModel):
    name: str = Field(min_length=2, max_length=120)
    email: EmailField = Field(min_length=5, max_length=255)
    password: str = Field(min_length=8, max_length=128)
    setup_key: str | None = Field(default=None, max_length=255)


class AdminUserOut(ORMModel):
    id: int
    name: str
    email: str
    role: str
    login_time: datetime | None = None
    logout_time: datetime | None = None


class AdminDashboard(BaseModel):
    total_users: int
    total_admins: int
    total_images: int
    total_objects: int
    users: list[AdminUserOut]
