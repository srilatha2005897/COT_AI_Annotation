def _upload(client, project_id, sample_image, name="a.jpg"):
    return client.post(
        "/api/detect",
        files={"file": (name, sample_image, "image/jpeg")},
        data={"project_id": str(project_id)},
    )


def test_detect_creates_image_with_boxes(user_client, project, sample_image):
    resp = _upload(user_client, project["id"], sample_image)
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["project_id"] == project["id"]
    assert body["total_objects"] == 1
    assert body["detections"][0]["class_name"] == "car"
    assert body["status"] == "annotated"


def test_detect_rejects_non_image(user_client, project):
    resp = user_client.post(
        "/api/detect",
        files={"file": ("a.txt", b"hello", "text/plain")},
        data={"project_id": str(project["id"])},
    )
    assert resp.status_code == 400


def test_detect_rejects_bad_confidence(user_client, project, sample_image):
    resp = user_client.post(
        "/api/detect",
        files={"file": ("a.jpg", sample_image, "image/jpeg")},
        data={"project_id": str(project["id"]), "confidence_threshold": "1.5"},
    )
    assert resp.status_code == 400


def test_list_and_fetch_image(user_client, project, sample_image):
    _upload(user_client, project["id"], sample_image)
    resp = user_client.get("/api/images", params={"project_id": project["id"]})
    assert resp.status_code == 200
    images = resp.json()
    assert len(images) == 1

    image_id = images[0]["id"]
    resp = user_client.get(f"/api/images/{image_id}")
    assert resp.status_code == 200
    assert resp.json()["image_id"] == image_id


def test_save_annotations_marks_reviewed(user_client, project, sample_image):
    image_id = _upload(user_client, project["id"], sample_image).json()["image_id"]
    resp = user_client.put(
        f"/api/images/{image_id}/annotations",
        json={
            "annotations": [
                {"class_name": "dog", "confidence": 1.0, "x": 1, "y": 2, "width": 30, "height": 40}
            ]
        },
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["status"] == "reviewed"
    assert body["total_objects"] == 1
    assert body["detections"][0]["class_name"] == "dog"


def test_file_download_needs_auth_but_works_with_cookie(user_client, project, sample_image):
    image_id = _upload(user_client, project["id"], sample_image).json()["image_id"]

    # The cookie set at registration authorises plain GETs (as an <img> tag would),
    # even without the Authorization header.
    token_cookie = user_client.cookies.get("annotateai_token")
    resp = user_client.get(
        f"/api/files/original/{image_id}",
        headers={"Authorization": ""},
    )
    assert resp.status_code == 200
    assert token_cookie

    # No cookie and no header -> rejected.
    user_client.cookies.clear()
    resp = user_client.get(
        f"/api/files/original/{image_id}", headers={"Authorization": ""}
    )
    assert resp.status_code == 401


def test_yolo_export_zip(user_client, project, sample_image):
    import io
    import zipfile

    # a handful of images so there's something to split into train/val
    for i in range(6):
        _upload(user_client, project["id"], sample_image, name=f"img{i}.jpg")

    resp = user_client.get("/api/export-yolo", params={"project_id": project["id"]})
    assert resp.status_code == 200
    assert resp.headers["content-type"] == "application/zip"

    zf = zipfile.ZipFile(io.BytesIO(resp.content))
    names = zf.namelist()
    assert "data.yaml" in names
    assert "classes.txt" in names
    assert "README.txt" in names

    # images and labels are split into train/ and val/
    assert any(n.startswith("images/train/") for n in names)
    assert any(n.startswith("images/val/") for n in names)
    assert any(n.startswith("labels/train/") for n in names)

    yaml = zf.read("data.yaml").decode()
    assert "nc: 1" in yaml
    assert "0: car" in yaml  # the fake detector only produces "car"

    # label lines must use the local class id (0), not the COCO id for car
    label_file = next(n for n in names if n.startswith("labels/train/") and n.endswith(".txt"))
    first_line = zf.read(label_file).decode().splitlines()[0]
    assert first_line.split()[0] == "0"


def test_project_dashboard(user_client, project, sample_image):
    _upload(user_client, project["id"], sample_image)
    resp = user_client.get(f"/api/project-dashboard/{project['id']}")
    assert resp.status_code == 200
    body = resp.json()
    assert body["total_images"] == 1
    assert body["total_objects"] == 1
    assert body["annotated_images"] == 1
