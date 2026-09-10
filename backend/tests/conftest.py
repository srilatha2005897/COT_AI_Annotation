"""Shared pytest fixtures.

The environment is configured *before* the app is imported so settings pick up
the test values, and the YOLO detector is replaced with a fast fake so tests
never load a real model.
"""
import io
import os
import tempfile

os.environ.setdefault("ENVIRONMENT", "test")
os.environ.setdefault("TOKEN_SECRET", "test-token-secret-value-000000000000")
os.environ.setdefault("ADMIN_SETUP_KEY", "test-admin-setup-key")
os.environ.setdefault("LOGIN_MAX_ATTEMPTS", "5")
os.environ.setdefault("LOG_LEVEL", "WARNING")
os.environ.setdefault(
    "DATABASE_URL", f"sqlite:///{os.path.join(tempfile.gettempdir(), 'annotateai_pytest.db')}"
)

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from PIL import Image  # noqa: E402
from sqlalchemy import create_engine  # noqa: E402
from sqlalchemy.orm import sessionmaker  # noqa: E402


@pytest.fixture()
def _test_db(tmp_path, monkeypatch):
    """Give every test its own SQLite database and storage directories."""
    from app.core import config, database

    engine = create_engine(
        f"sqlite:///{tmp_path / 'test.db'}",
        connect_args={"check_same_thread": False},
    )
    database.Base.metadata.create_all(bind=engine)

    monkeypatch.setattr(database, "engine", engine)
    monkeypatch.setattr(
        database,
        "SessionLocal",
        sessionmaker(bind=engine, autocommit=False, autoflush=False),
    )

    monkeypatch.setattr(config.settings, "upload_dir", tmp_path / "uploads")
    monkeypatch.setattr(config.settings, "annotated_dir", tmp_path / "annotated")
    (tmp_path / "uploads").mkdir()
    (tmp_path / "annotated").mkdir()

    yield engine
    engine.dispose()


@pytest.fixture()
def fake_detector(monkeypatch):
    from app.services import annotation as annotation_service

    class FakeDetector:
        def detect(self, image_path, confidence_threshold=None):
            return {
                "width": 640,
                "height": 480,
                "detections": [
                    {
                        "class_name": "car",
                        "confidence": 0.9,
                        "x": 10.0,
                        "y": 20.0,
                        "width": 100.0,
                        "height": 80.0,
                    }
                ],
                "class_counts": [{"class_name": "car", "count": 1}],
                "total_objects": 1,
            }

        def draw_boxes(self, image_path, detections, output_path):
            output_path.parent.mkdir(parents=True, exist_ok=True)
            output_path.write_bytes(b"fake-annotated-image")
            return output_path

    monkeypatch.setattr(annotation_service, "detector_service", FakeDetector())


@pytest.fixture()
def client(_test_db, fake_detector, monkeypatch):
    from app import main
    from app.services.detector import DetectorService

    monkeypatch.setattr(DetectorService, "warm_up", staticmethod(lambda: None))

    with TestClient(main.app) as test_client:
        yield test_client


@pytest.fixture()
def sample_image():
    buffer = io.BytesIO()
    Image.new("RGB", (64, 48), color=(120, 130, 140)).save(buffer, format="JPEG")
    return buffer.getvalue()


@pytest.fixture()
def user_client(client):
    resp = client.post(
        "/api/auth/register",
        json={
            "name": "Test User",
            "email": "user@example.com",
            "password": "password123",
            "role": "user",
        },
    )
    assert resp.status_code == 200, resp.text
    client.headers.update({"Authorization": f"Bearer {resp.json()['access_token']}"})
    return client


@pytest.fixture()
def admin_client(client):
    resp = client.post(
        "/api/admin/create",
        json={
            "name": "Admin",
            "email": "admin@example.com",
            "password": "password123",
            "setup_key": "test-admin-setup-key",
        },
    )
    assert resp.status_code == 200, resp.text
    client.headers.update({"Authorization": f"Bearer {resp.json()['access_token']}"})
    return client


@pytest.fixture()
def project(user_client):
    resp = user_client.post(
        "/api/projects", json={"name": "Test Project", "description": "d"}
    )
    assert resp.status_code == 201, resp.text
    return resp.json()
