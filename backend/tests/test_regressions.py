"""Regression tests for bugs found during QA.

Each test here failed before its fix went in. If one starts failing again, the
bug it names has come back.
"""


def _upload(client, project_id, sample_image, name="a.jpg"):
    return client.post(
        "/api/detect",
        files={"file": (name, sample_image, "image/jpeg")},
        data={"project_id": str(project_id)},
    )


# --- Deleting every box on an image used to bring the AI's boxes back ---


def test_clearing_all_boxes_sticks(user_client, project, sample_image):
    """A reviewer saying "there is nothing in this image" has to be recorded.

    get_active_boxes() used to test `status == "reviewed" and image.annotations`,
    so an empty annotation list fell through to the AI detections. Deleting every
    false positive and saving silently restored them.
    """
    image_id = _upload(user_client, project["id"], sample_image).json()["image_id"]

    resp = user_client.put(
        f"/api/images/{image_id}/annotations", json={"annotations": []}
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["total_objects"] == 0
    assert resp.json()["detections"] == []

    # and it must still be empty when the page is reloaded
    reloaded = user_client.get(f"/api/images/{image_id}").json()
    assert reloaded["total_objects"] == 0, "AI boxes came back after being deleted"
    assert reloaded["detections"] == []


def test_cleared_image_exports_no_labels(user_client, project, sample_image):
    """The deleted boxes must not reappear in the exported dataset either."""
    import io
    import zipfile

    image_id = _upload(user_client, project["id"], sample_image).json()["image_id"]
    user_client.put(f"/api/images/{image_id}/annotations", json={"annotations": []})

    resp = user_client.get("/api/export-yolo", params={"project_id": project["id"]})
    assert resp.status_code == 200

    archive = zipfile.ZipFile(io.BytesIO(resp.content))
    labels = [
        archive.read(name).decode().strip()
        for name in archive.namelist()
        if name.startswith("labels/") and name.endswith(".txt")
    ]
    assert labels and all(body == "" for body in labels), (
        "deleted boxes were exported as training labels"
    )


def test_dashboard_counts_cleared_image_as_empty(user_client, project, sample_image):
    image_id = _upload(user_client, project["id"], sample_image).json()["image_id"]
    user_client.put(f"/api/images/{image_id}/annotations", json={"annotations": []})

    stats = user_client.get("/api/dashboard").json()
    assert stats["total_objects"] == 0
    assert stats["reviewed_images"] == 1


# --- The setup key could mint unlimited admins through /auth/register ---


def test_setup_key_only_creates_the_first_admin(client):
    """/admin/create enforced "first admin only"; /auth/register did not, so the
    shared setup key stayed a permanent admin-minting credential."""
    first = client.post(
        "/api/auth/register",
        json={
            "name": "First Admin",
            "email": "admin-one@example.com",
            "password": "password123",
            "role": "admin",
            "setup_key": "test-admin-setup-key",
        },
    )
    assert first.status_code == 200, first.text
    assert first.json()["role"] == "admin"

    second = client.post(
        "/api/auth/register",
        json={
            "name": "Second Admin",
            "email": "admin-two@example.com",
            "password": "password123",
            "role": "admin",
            "setup_key": "test-admin-setup-key",
        },
    )
    assert second.status_code == 403, "setup key still minted a second admin"


def test_normal_signup_still_works_after_an_admin_exists(client):
    client.post(
        "/api/auth/register",
        json={
            "name": "First Admin",
            "email": "admin-one@example.com",
            "password": "password123",
            "role": "admin",
            "setup_key": "test-admin-setup-key",
        },
    )
    resp = client.post(
        "/api/auth/register",
        json={
            "name": "Normal Person",
            "email": "normal@example.com",
            "password": "password123",
            "role": "user",
        },
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["role"] == "user"


# --- One person's failed logins locked out everybody on the same IP ---


def test_failed_logins_do_not_lock_out_other_accounts(client):
    for email in ("victim@example.com", "bystander@example.com"):
        client.post(
            "/api/auth/register",
            json={
                "name": "Person",
                "email": email,
                "password": "password123",
                "role": "user",
            },
        )

    # Burn through the limit on one account.
    for _ in range(6):
        client.post(
            "/api/auth/login",
            json={
                "email": "victim@example.com",
                "password": "wrong-password",
                "role": "user",
            },
        )

    blocked = client.post(
        "/api/auth/login",
        json={"email": "victim@example.com", "password": "wrong-password", "role": "user"},
    )
    assert blocked.status_code == 429, "rate limit stopped working"

    # The other account shares the IP but must still be able to sign in. Behind
    # nginx or Docker every user shares one apparent IP, so keying the limiter on
    # the address alone locked out the whole user base.
    other = client.post(
        "/api/auth/login",
        json={"email": "bystander@example.com", "password": "password123", "role": "user"},
    )
    assert other.status_code == 200, "an unrelated account was locked out"


def test_rate_limit_uses_forwarded_ip(client):
    """Behind our nginx the socket belongs to the proxy, so X-Real-IP decides."""
    client.post(
        "/api/auth/register",
        json={
            "name": "Person",
            "email": "target@example.com",
            "password": "password123",
            "role": "user",
        },
    )
    bad = {"email": "target@example.com", "password": "wrong-password", "role": "user"}

    for _ in range(6):
        client.post("/api/auth/login", json=bad, headers={"X-Real-IP": "10.0.0.1"})

    assert (
        client.post("/api/auth/login", json=bad, headers={"X-Real-IP": "10.0.0.1"}).status_code
        == 429
    )
    # A different real client behind the same proxy is unaffected.
    assert (
        client.post("/api/auth/login", json=bad, headers={"X-Real-IP": "10.0.0.2"}).status_code
        == 401
    )


# --- Single-image export silently dropped non-COCO classes ---


def test_single_image_export_reports_unknown_classes(user_client, project, sample_image):
    """The per-image label file uses COCO ids, so a custom class has no id. It
    used to be dropped silently, producing a label file that looked complete."""
    image_id = _upload(user_client, project["id"], sample_image).json()["image_id"]
    user_client.put(
        f"/api/images/{image_id}/annotations",
        json={
            "annotations": [
                {"class_name": "widget", "x": 1, "y": 2, "width": 30, "height": 40},
                {"class_name": "car", "x": 5, "y": 6, "width": 20, "height": 20},
            ]
        },
    )

    resp = user_client.post(f"/api/images/{image_id}/export-yolo")
    assert resp.status_code == 400
    assert "widget" in resp.json()["detail"]


def test_single_image_export_still_works_for_coco_classes(
    user_client, project, sample_image
):
    image_id = _upload(user_client, project["id"], sample_image).json()["image_id"]
    user_client.put(
        f"/api/images/{image_id}/annotations",
        json={"annotations": [{"class_name": "car", "x": 5, "y": 6, "width": 20, "height": 20}]},
    )

    resp = user_client.post(f"/api/images/{image_id}/export-yolo")
    assert resp.status_code == 200
    assert resp.text.split()[0] == "2"  # "car" is COCO id 2


def test_project_export_keeps_custom_classes(user_client, project, sample_image):
    """The project export builds its own class list, so custom names survive."""
    import io
    import zipfile

    image_id = _upload(user_client, project["id"], sample_image).json()["image_id"]
    user_client.put(
        f"/api/images/{image_id}/annotations",
        json={"annotations": [{"class_name": "widget", "x": 1, "y": 2, "width": 30, "height": 40}]},
    )

    resp = user_client.get("/api/export-yolo", params={"project_id": project["id"]})
    archive = zipfile.ZipFile(io.BytesIO(resp.content))
    assert "widget" in archive.read("classes.txt").decode()
