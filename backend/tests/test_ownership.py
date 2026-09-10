"""One user must never see or touch another user's projects and images.

Before ownership existed, every one of these assertions failed: a second user
could list, rename, delete and download the first user's work.
"""
import pytest


def _register(client, email, role="user", setup_key=None):
    body = {
        "name": "Person",
        "email": email,
        "password": "password123",
        "role": role,
    }
    if setup_key:
        body["setup_key"] = setup_key
    resp = client.post("/api/auth/register", json=body)
    assert resp.status_code == 200, resp.text
    return {"Authorization": f"Bearer {resp.json()['access_token']}"}


@pytest.fixture()
def alice(user_client):
    """The default user_client, already signed in via its default headers."""
    return user_client


@pytest.fixture()
def bob(alice):
    """A second, unrelated account. Its requests pass an explicit header, which
    takes priority over the client's default one."""
    return _register(alice, "bob@example.com")


@pytest.fixture()
def alice_image(alice, project, sample_image):
    resp = alice.post(
        "/api/detect",
        files={"file": ("a.jpg", sample_image, "image/jpeg")},
        data={"project_id": str(project["id"])},
    )
    assert resp.status_code == 200, resp.text
    return resp.json()


# --- Reading ---


def test_projects_are_not_listed_to_other_users(alice, project, bob):
    assert [p["id"] for p in alice.get("/api/projects").json()] == [project["id"]]
    assert alice.get("/api/projects", headers=bob).json() == []


def test_other_users_project_is_a_404(alice, project, bob):
    assert alice.get(f"/api/projects/{project['id']}", headers=bob).status_code == 404


def test_images_are_not_listed_to_other_users(alice, alice_image, bob):
    assert len(alice.get("/api/images").json()) == 1
    assert alice.get("/api/images", headers=bob).json() == []


def test_other_users_image_is_a_404(alice, alice_image, bob):
    image_id = alice_image["image_id"]
    assert alice.get(f"/api/images/{image_id}", headers=bob).status_code == 404


def test_image_files_are_not_downloadable_by_other_users(alice, alice_image, bob):
    image_id = alice_image["image_id"]
    alice.cookies.clear()  # otherwise the cookie would authorise as Alice
    for kind in ("original", "annotated"):
        resp = alice.get(f"/api/files/{kind}/{image_id}", headers=bob)
        assert resp.status_code == 404, f"{kind} file leaked to another user"


def test_dashboard_only_counts_your_own_work(alice, alice_image, bob):
    assert alice.get("/api/dashboard").json()["total_images"] == 1
    assert alice.get("/api/dashboard", headers=bob).json()["total_images"] == 0


def test_project_dashboard_is_scoped(alice, project, bob):
    path = f"/api/project-dashboard/{project['id']}"
    assert alice.get(path).status_code == 200
    assert alice.get(path, headers=bob).status_code == 404


# --- Writing ---


def test_other_users_cannot_rename_a_project(alice, project, bob):
    resp = alice.put(
        f"/api/projects/{project['id']}",
        json={"name": "Bob was here", "description": "hacked"},
        headers=bob,
    )
    assert resp.status_code == 404
    assert alice.get(f"/api/projects/{project['id']}").json()["name"] == project["name"]


def test_other_users_cannot_delete_a_project(alice, project, bob):
    assert alice.delete(f"/api/projects/{project['id']}", headers=bob).status_code == 404
    assert alice.get(f"/api/projects/{project['id']}").status_code == 200


def test_other_users_cannot_edit_annotations(alice, alice_image, bob):
    image_id = alice_image["image_id"]
    resp = alice.put(
        f"/api/images/{image_id}/annotations",
        json={"annotations": [{"class_name": "dog", "x": 1, "y": 1, "width": 5, "height": 5}]},
        headers=bob,
    )
    assert resp.status_code == 404
    assert alice.get(f"/api/images/{image_id}").json()["detections"][0]["class_name"] == "car"


def test_other_users_cannot_upload_into_your_project(alice, project, bob, sample_image):
    resp = alice.post(
        "/api/detect",
        files={"file": ("b.jpg", sample_image, "image/jpeg")},
        data={"project_id": str(project["id"])},
        headers=bob,
    )
    assert resp.status_code == 400, "image was filed into someone else's project"
    assert alice.get("/api/images", params={"project_id": project["id"]}).json() == []


def test_other_users_cannot_export_your_dataset(alice, alice_image, project, bob):
    resp = alice.get(
        "/api/export-yolo", params={"project_id": project["id"]}, headers=bob
    )
    assert resp.status_code == 404


# --- Names are per-user now ---


def test_two_users_can_have_a_project_with_the_same_name(alice, project, bob):
    resp = alice.post("/api/projects", json={"name": project["name"]}, headers=bob)
    assert resp.status_code == 201, "project names are still globally unique"
    assert resp.json()["id"] != project["id"]


def test_you_still_cannot_reuse_your_own_project_name(alice, project):
    resp = alice.post("/api/projects", json={"name": project["name"]})
    assert resp.status_code == 409


# --- Admins ---


def test_admin_can_see_every_users_work(alice, project, alice_image, client):
    admin = _register(
        client, "boss@example.com", role="admin", setup_key="test-admin-setup-key"
    )
    assert [p["id"] for p in alice.get("/api/projects", headers=admin).json()] == [
        project["id"]
    ]
    assert len(alice.get("/api/images", headers=admin).json()) == 1
