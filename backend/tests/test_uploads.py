"""Batch uploads: how many images go in, and what happens to the ones that don't."""
from app.core.config import settings


def _files(sample_image, count, start=0):
    return [
        ("files", (f"img{i}.jpg", sample_image, "image/jpeg"))
        for i in range(start, start + count)
    ]


def test_batch_accepts_more_than_the_old_fifty(user_client, project, sample_image):
    assert settings.max_batch_files >= 100
    resp = user_client.post(
        "/api/detect/batch",
        files=_files(sample_image, 60),
        data={"project_id": str(project["id"])},
    )
    assert resp.status_code == 200, resp.text
    assert len(resp.json()["results"]) == 60


def test_batch_reports_what_it_skipped(user_client, project, sample_image):
    """Rejected files used to vanish without a word."""
    files = _files(sample_image, 2) + [
        ("files", ("notes.txt", b"hello", "text/plain")),
        ("files", ("empty.jpg", b"", "image/jpeg")),
    ]
    resp = user_client.post(
        "/api/detect/batch", files=files, data={"project_id": str(project["id"])}
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert len(body["results"]) == 2

    skipped = {item["filename"]: item["reason"] for item in body["skipped"]}
    assert "notes.txt" in skipped and "not an image" in skipped["notes.txt"]
    assert "empty.jpg" in skipped and "empty" in skipped["empty.jpg"]


def test_batch_over_the_limit_is_a_clear_error(user_client, project, sample_image):
    resp = user_client.post(
        "/api/detect/batch",
        files=_files(sample_image, settings.max_batch_files + 1),
        data={"project_id": str(project["id"])},
    )
    assert resp.status_code == 400
    assert str(settings.max_batch_files) in resp.json()["detail"]


def test_all_files_invalid_explains_why(user_client, project):
    resp = user_client.post(
        "/api/detect/batch",
        files=[("files", ("a.txt", b"x", "text/plain"))],
        data={"project_id": str(project["id"])},
    )
    assert resp.status_code == 400
    assert "a.txt" in resp.json()["detail"]


def test_listing_returns_more_than_the_old_page_of_fifty(
    user_client, project, sample_image
):
    user_client.post(
        "/api/detect/batch",
        files=_files(sample_image, 60),
        data={"project_id": str(project["id"])},
    )
    # No explicit limit: the default page has to be big enough to be useful.
    assert len(user_client.get("/api/images").json()) == 60
    # And an explicit limit is honoured.
    assert len(user_client.get("/api/images", params={"limit": 25}).json()) == 25
    assert len(user_client.get("/api/images", params={"limit": 25, "offset": 50}).json()) == 10
