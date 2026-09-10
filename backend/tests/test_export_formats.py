"""Dataset exports must match what the tools that read them expect."""
import io
import json
import xml.etree.ElementTree as ET
import zipfile

import pytest


def _upload(client, project_id, sample_image, name="a.jpg"):
    return client.post(
        "/api/detect",
        files={"file": (name, sample_image, "image/jpeg")},
        data={"project_id": str(project_id)},
    )


def _zip(client, project_id, **params):
    resp = client.get(
        "/api/export", params={"project_id": project_id, **params}
    )
    assert resp.status_code == 200, resp.text
    assert resp.headers["content-type"] == "application/zip"
    return zipfile.ZipFile(io.BytesIO(resp.content))


@pytest.fixture()
def project_with_images(user_client, project, sample_image):
    for i in range(6):
        _upload(user_client, project["id"], sample_image, name=f"img{i}.jpg")
    return project


# --- The bug that made every export subtly wrong ---


def test_yolo_boxes_stay_inside_the_image(user_client, project, sample_image):
    """A box drawn over the edge must be clipped, not just clamped.

    Clamping the centre and the size separately let a box hang outside the
    image, and Ultralytics throws those labels away with a "non-normalized or
    out of bounds coordinates" warning.
    """
    image_id = _upload(user_client, project["id"], sample_image).json()["image_id"]
    # The detector reports the image as 640x480 (see conftest), and every one of
    # these boxes pokes out of that frame.
    user_client.put(
        f"/api/images/{image_id}/annotations",
        json={
            "annotations": [
                {"class_name": "car", "x": 600, "y": 100, "width": 200, "height": 80},
                {"class_name": "car", "x": 100, "y": 450, "width": 80, "height": 200},
                {"class_name": "car", "x": -60, "y": -40, "width": 200, "height": 150},
                {"class_name": "car", "x": -20, "y": -20, "width": 900, "height": 700},
            ]
        },
    )

    archive = _zip(user_client, project["id"], format="yolo")
    label = next(n for n in archive.namelist() if n.startswith("labels/") and n.endswith(".txt"))
    rows = [r for r in archive.read(label).decode().splitlines() if r.strip()]
    assert len(rows) == 4

    for row in rows:
        _, cx, cy, w, h = row.split()
        cx, cy, w, h = float(cx), float(cy), float(w), float(h)
        assert 0 <= cx <= 1 and 0 <= cy <= 1
        assert 0 < w <= 1 and 0 < h <= 1
        # and the box itself, not just its centre, must sit inside the image
        assert cx - w / 2 >= -1e-6, row
        assert cx + w / 2 <= 1 + 1e-6, row
        assert cy - h / 2 >= -1e-6, row
        assert cy + h / 2 <= 1 + 1e-6, row


def test_box_entirely_outside_the_image_is_dropped(user_client, project, sample_image):
    image_id = _upload(user_client, project["id"], sample_image).json()["image_id"]
    user_client.put(
        f"/api/images/{image_id}/annotations",
        json={
            "annotations": [
                {"class_name": "car", "x": 5000, "y": 5000, "width": 30, "height": 30}
            ]
        },
    )
    archive = _zip(user_client, project["id"], format="yolo")
    label = next(n for n in archive.namelist() if n.startswith("labels/"))
    assert archive.read(label).decode().strip() == ""


# --- YOLO ---


def test_yolo_layout_and_data_yaml(project_with_images, user_client):
    archive = _zip(user_client, project_with_images["id"], format="yolo", val_ratio=0.2)
    names = archive.namelist()

    assert "data.yaml" in names
    assert "classes.txt" in names
    assert any(n.startswith("images/train/") for n in names)
    assert any(n.startswith("images/val/") for n in names)
    assert any(n.startswith("labels/train/") for n in names)

    yaml = archive.read("data.yaml").decode()
    assert "path: ." in yaml
    assert "train: images/train" in yaml
    assert "val: images/val" in yaml
    assert "nc: 1" in yaml
    assert "0: car" in yaml

    # every image has a matching label file with the same stem
    stems = {n.rsplit("/", 1)[1].rsplit(".", 1)[0] for n in names if n.startswith("images/")}
    label_stems = {n.rsplit("/", 1)[1][:-4] for n in names if n.startswith("labels/")}
    assert stems == label_stems


def test_yolo_never_points_val_at_the_training_set(project_with_images, user_client):
    """With no val split, data.yaml must not quietly validate on train data."""
    archive = _zip(user_client, project_with_images["id"], format="yolo", val_ratio=0)
    yaml = archive.read("data.yaml").decode()
    assert "no validation split" in yaml


def test_yolo_test_split(project_with_images, user_client):
    archive = _zip(
        user_client, project_with_images["id"], format="yolo", val_ratio=0.2, test_ratio=0.2
    )
    names = archive.namelist()
    assert any(n.startswith("images/test/") for n in names)
    assert "test: images/test" in archive.read("data.yaml").decode()


def test_original_filenames_are_kept(project_with_images, user_client):
    archive = _zip(user_client, project_with_images["id"], format="yolo")
    stored = {n.rsplit("/", 1)[1] for n in archive.namelist() if n.startswith("images/")}
    assert "img0.jpg" in stored, "uploads were exported under their uuid instead"


def test_duplicate_filenames_are_disambiguated(user_client, project, sample_image):
    for _ in range(3):
        _upload(user_client, project["id"], sample_image, name="same.jpg")
    archive = _zip(user_client, project["id"], format="yolo")
    stored = sorted(n.rsplit("/", 1)[1] for n in archive.namelist() if n.startswith("images/"))
    assert len(stored) == 3, "an upload was overwritten by one with the same name"
    assert len(set(stored)) == 3


# --- COCO ---


def test_coco_json_is_valid(project_with_images, user_client):
    archive = _zip(user_client, project_with_images["id"], format="coco", val_ratio=0.2)
    names = archive.namelist()
    assert "annotations/instances_train.json" in names
    assert "annotations/instances_val.json" in names

    document = json.loads(archive.read("annotations/instances_train.json"))
    for key in ("info", "licenses", "images", "annotations", "categories"):
        assert key in document

    # COCO category ids start at 1
    assert [c["id"] for c in document["categories"]] == [1]
    assert document["categories"][0]["name"] == "car"

    image = document["images"][0]
    assert {"id", "file_name", "width", "height"} <= set(image)
    assert image["width"] == 640 and image["height"] == 480

    annotation = document["annotations"][0]
    assert annotation["category_id"] == 1
    assert annotation["iscrowd"] == 0
    x, y, w, h = annotation["bbox"]  # absolute pixels, not normalised
    assert w > 1 and h > 1
    assert annotation["area"] == pytest.approx(w * h, rel=0.01)
    # every annotation points at an image that is in the same file
    ids = {img["id"] for img in document["images"]}
    assert all(a["image_id"] in ids for a in document["annotations"])


# --- Pascal VOC ---


def test_voc_layout_and_xml(project_with_images, user_client):
    archive = _zip(user_client, project_with_images["id"], format="voc", val_ratio=0.2)
    names = archive.namelist()
    assert any(n.startswith("JPEGImages/") for n in names)
    assert "ImageSets/Main/train.txt" in names
    assert "ImageSets/Main/val.txt" in names

    xml_name = next(n for n in names if n.startswith("Annotations/"))
    root = ET.fromstring(archive.read(xml_name).decode())
    assert root.tag == "annotation"
    assert root.findtext("size/width") == "640"
    assert root.findtext("size/height") == "480"

    obj = root.find("object")
    assert obj.findtext("name") == "car"
    box = obj.find("bndbox")
    xmin, ymin = int(box.findtext("xmin")), int(box.findtext("ymin"))
    xmax, ymax = int(box.findtext("xmax")), int(box.findtext("ymax"))
    # VOC is 1-based, so nothing may be 0, and corners must be ordered
    assert xmin >= 1 and ymin >= 1
    assert xmax > xmin and ymax > ymin
    assert xmax <= 640 and ymax <= 480


# --- CSV ---


def test_csv_rows(project_with_images, user_client):
    import csv

    archive = _zip(user_client, project_with_images["id"], format="csv")
    assert "annotations.csv" in archive.namelist()

    rows = list(csv.DictReader(io.StringIO(archive.read("annotations.csv").decode())))
    assert rows
    first = rows[0]
    assert first["class"] == "car"
    assert first["split"] in ("train", "val", "test")
    assert int(first["xmax"]) > int(first["xmin"])
    assert int(first["ymax"]) > int(first["ymin"])


# --- Splits ---


def test_split_is_stable_between_exports(project_with_images, user_client):
    def splits():
        archive = _zip(user_client, project_with_images["id"], format="yolo", val_ratio=0.2)
        return sorted(n for n in archive.namelist() if n.startswith("images/"))

    assert splits() == splits(), "the same project split differently on re-export"


def test_split_is_shared_across_formats(project_with_images, user_client):
    def val_names(fmt, prefix):
        archive = _zip(user_client, project_with_images["id"], format=fmt, val_ratio=0.2)
        return sorted(
            n.rsplit("/", 1)[1] for n in archive.namelist() if n.startswith(prefix)
        )

    assert val_names("yolo", "images/val/") == val_names("csv", "images/val/")


def test_only_reviewed_filter(user_client, project, sample_image):
    reviewed = _upload(user_client, project["id"], sample_image, name="done.jpg").json()
    _upload(user_client, project["id"], sample_image, name="todo.jpg")
    user_client.put(
        f"/api/images/{reviewed['image_id']}/annotations",
        json={"annotations": [{"class_name": "car", "x": 1, "y": 1, "width": 9, "height": 9}]},
    )

    archive = _zip(user_client, project["id"], format="yolo", only_reviewed="true")
    stored = {n.rsplit("/", 1)[1] for n in archive.namelist() if n.startswith("images/")}
    assert stored == {"done.jpg"}


def test_only_reviewed_with_nothing_reviewed_explains_itself(
    project_with_images, user_client
):
    resp = user_client.get(
        "/api/export",
        params={"project_id": project_with_images["id"], "only_reviewed": "true"},
    )
    assert resp.status_code == 400
    assert "reviewed" in resp.json()["detail"].lower()


def test_unknown_format_is_rejected(project_with_images, user_client):
    resp = user_client.get(
        "/api/export", params={"project_id": project_with_images["id"], "format": "tfrecord"}
    )
    assert resp.status_code == 400
    assert "yolo" in resp.json()["detail"]


def test_legacy_export_yolo_path_still_works(project_with_images, user_client):
    resp = user_client.get(
        "/api/export-yolo", params={"project_id": project_with_images["id"]}
    )
    assert resp.status_code == 200
    archive = zipfile.ZipFile(io.BytesIO(resp.content))
    assert "data.yaml" in archive.namelist()


def test_yolo_zip_ships_the_path_setup_script(project_with_images, user_client):
    """Ultralytics resolves a relative 'path:' against its own datasets dir, not
    against data.yaml, so a freshly unzipped dataset needs its absolute path
    written in before training will find the images."""
    archive = _zip(user_client, project_with_images["id"], format="yolo")
    assert "setup_paths.py" in archive.namelist()
    script = archive.read("setup_paths.py").decode()
    assert "data.yaml" in script and "path:" in script
    assert "setup_paths.py" in archive.read("README.txt").decode()


# --- Simple: images sorted by done/not-done, plus one JSON ---


def test_simple_format_layout(user_client, project, sample_image):
    """Images with boxes and images without go in separate folders."""
    with_boxes = _upload(user_client, project["id"], sample_image, name="done.jpg").json()
    without = _upload(user_client, project["id"], sample_image, name="empty.jpg").json()
    # the reviewer clears every box on one image
    user_client.put(f"/api/images/{without['image_id']}/annotations", json={"annotations": []})

    archive = _zip(user_client, project["id"], format="simple")
    names = archive.namelist()

    assert "annotations.json" in names
    assert "annotated/done.jpg" in names
    assert "not_annotated/empty.jpg" in names
    # no training layout at all
    assert not any(n.startswith(("images/", "labels/")) for n in names)
    assert "data.yaml" not in names


def test_simple_json_coordinates(user_client, project, sample_image):
    image_id = _upload(user_client, project["id"], sample_image, name="a.jpg").json()["image_id"]
    user_client.put(
        f"/api/images/{image_id}/annotations",
        json={
            "annotations": [
                {"class_name": "car", "x": 10, "y": 20, "width": 100, "height": 80}
            ]
        },
    )

    archive = _zip(user_client, project["id"], format="simple")
    document = json.loads(archive.read("annotations.json"))

    assert document["classes"] == ["car"]
    assert document["summary"]["images"] == 1
    assert document["summary"]["annotated"] == 1
    assert document["summary"]["boxes"] == 1
    assert "pixels" in document["coordinates"]

    entry = document["images"][0]
    assert entry["file"] == "annotated/a.jpg"
    assert entry["width"] == 640 and entry["height"] == 480
    assert entry["reviewed"] is True

    box = entry["boxes"][0]
    assert box == {"class": "car", "x": 10.0, "y": 20.0, "width": 100.0, "height": 80.0}


def test_simple_json_lists_every_image_including_empty_ones(
    project_with_images, user_client
):
    archive = _zip(user_client, project_with_images["id"], format="simple")
    document = json.loads(archive.read("annotations.json"))
    assert len(document["images"]) == 6
    # every file named in the JSON is actually in the zip
    names = set(archive.namelist())
    assert all(entry["file"] in names for entry in document["images"])


def test_simple_boxes_are_clipped_to_the_image(user_client, project, sample_image):
    image_id = _upload(user_client, project["id"], sample_image).json()["image_id"]
    user_client.put(
        f"/api/images/{image_id}/annotations",
        json={
            "annotations": [
                {"class_name": "car", "x": 600, "y": 100, "width": 200, "height": 80}
            ]
        },
    )
    archive = _zip(user_client, project["id"], format="simple")
    box = json.loads(archive.read("annotations.json"))["images"][0]["boxes"][0]
    assert box["x"] + box["width"] <= 640
    assert box["y"] + box["height"] <= 480


def test_simple_ignores_split_settings(project_with_images, user_client):
    """Asking for a split on a format that has none must not split anything."""
    archive = _zip(
        user_client, project_with_images["id"], format="simple", val_ratio=0.5, test_ratio=0.2
    )
    assert not any("/train/" in n or "/val/" in n for n in archive.namelist())
