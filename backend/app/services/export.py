"""Turning a project into a downloadable dataset.

Five formats, same boxes, different layouts:

    simple   annotated/ + not_annotated/ + annotations.json
    yolo     images/ + labels/ + data.yaml                    (Ultralytics)
    coco     images/ + annotations/instances_*.json           (Detectron2 etc.)
    voc      JPEGImages/ + Annotations/*.xml
    csv      images/ + annotations.csv

Everything except "simple" splits into train/val/test. build_plan() decides the
split once, so the formats all agree on where an image goes.
"""
import csv
import io
import json
import random
import xml.etree.ElementTree as ET
import zipfile
from datetime import datetime, timezone
from pathlib import Path

from app.core.logging_config import get_logger
from app.services.annotation import clip_box, get_active_boxes

logger = get_logger("annotateai.export")

FORMATS = ("simple", "yolo", "coco", "voc", "csv")
SPLITS = ("train", "val", "test")

# "simple" sorts by whether an image has boxes rather than into train/val/test,
# so the API ignores the split settings for it.
SPLITLESS_FORMATS = ("simple",)

# Pillow ships with ultralytics. Only used for the VOC "depth" field, so fall
# back to 3 (normal colour) if it is missing.
try:
    from PIL import Image
except Exception:
    Image = None


# build_plan() resolves names, classes and splits up front, so each write_*
# function below only has to write files. An item is:
#
#   {"image": row, "boxes": [...], "name": "road_01.jpg",
#    "stem": "road_01", "split": "train"}


def clean_file_name(raw_name, used_names, image_id):
    """Pick the file name an image gets inside the zip.

    Uploads are stored under a random uuid, so fall back on the name the person
    uploaded and only add a number when two images really do share one.
    """
    name = Path(raw_name or "").name.strip()  # .name drops any folder part
    if not name:
        name = f"image_{image_id}.jpg"

    # Drop anything that could upset a file system or confuse a path parser.
    safe = ""
    for character in name:
        if character.isalnum() or character in "._- ":
            safe += character
    safe = safe.strip()

    if not safe or safe.startswith("."):
        safe = f"image_{image_id}.jpg"

    stem = Path(safe).stem
    extension = Path(safe).suffix
    if not extension:
        extension = ".jpg"

    # Compared in lower case - Windows and macOS treat A.JPG and a.jpg as one.
    candidate = stem + extension
    counter = 1
    while candidate.lower() in used_names:
        candidate = f"{stem}_{counter}{extension}"
        counter += 1

    used_names.add(candidate.lower())
    return candidate


def assign_splits(ids, val_ratio, test_ratio, seed):
    """{image_id: "train" / "val" / "test"}.

    Seeded with the project id so the same project always splits the same way.
    A reshuffle would move yesterday's val image into train and leave the model
    tested on pictures it had already learnt from.
    """
    total = len(ids)
    if total == 0:
        return {}

    shuffled = sorted(ids)  # fixed starting order, then a fixed shuffle
    random.Random(seed).shuffle(shuffled)

    how_many_test = int(total * test_ratio)
    how_many_val = int(total * val_ratio)

    # With few images the percentages round down to zero; give anyone who asked
    # for a val set at least one image.
    if val_ratio > 0 and how_many_val == 0 and total >= 2:
        how_many_val = 1
    if test_ratio > 0 and how_many_test == 0 and total - how_many_val >= 2:
        how_many_test = 1

    # Never take so many that nothing is left to train on.
    if how_many_val > total - 1:
        how_many_val = total - 1
    if how_many_val < 0:
        how_many_val = 0
    if how_many_test > total - how_many_val - 1:
        how_many_test = total - how_many_val - 1
    if how_many_test < 0:
        how_many_test = 0

    # Test first, then val, then the rest to train.
    splits = {}
    for position, image_id in enumerate(shuffled):
        if position < how_many_test:
            splits[image_id] = "test"
        elif position < how_many_test + how_many_val:
            splits[image_id] = "val"
        else:
            splits[image_id] = "train"
    return splits


def build_plan(images, val_ratio=0.2, test_ratio=0.0, only_reviewed=False, seed=0):
    """Work out everything about the export before writing a single file."""
    # Skip images missing from disk, and unreviewed ones if asked.
    usable = []
    for image in images:
        if not image.original_path:
            continue
        if not Path(image.original_path).exists():
            continue
        if only_reviewed and image.status != "reviewed":
            continue
        usable.append(image)

    usable.sort(key=lambda image: image.id)

    image_ids = [image.id for image in usable]
    splits = assign_splits(image_ids, val_ratio, test_ratio, seed)

    used_names = set()
    items = []
    class_names = []

    for image in usable:
        boxes = get_active_boxes(image)

        for box in boxes:
            name = str(box.class_name).strip().lower()
            if name and name not in class_names:
                class_names.append(name)

        file_name = clean_file_name(image.filename, used_names, image.id)
        items.append(
            {
                "image": image,
                "boxes": boxes,
                "name": file_name,
                "stem": Path(file_name).stem,
                "split": splits.get(image.id, "train"),
            }
        )

    class_names.sort()  # a class keeps the same id across exports

    counts = {}
    for split in SPLITS:
        counts[split] = 0
    total_boxes = 0
    for item in items:
        counts[item["split"]] += 1
        total_boxes += len(item["boxes"])
    counts["images"] = len(items)
    counts["boxes"] = total_boxes

    return {"items": items, "class_names": class_names, "counts": counts}


def class_ids(class_names):
    """{"bus": 0, "car": 1, ...} - a class's id is its place in the sorted list."""
    ids = {}
    for position, name in enumerate(class_names):
        ids[name] = position
    return ids


def boxes_in_pixels(item):
    """The item's boxes as {"class", "x", "y", "width", "height"} dicts.

    x/y are the top-left corner in pixels. Boxes are clipped to the image:
    drawing over the edge is normal, but a label outside the image is not, and
    training tools throw those away.
    """
    width = float(item["image"].width or 0)
    height = float(item["image"].height or 0)

    if width <= 0 or height <= 0:
        return []

    result = []
    for box in item["boxes"]:
        name = str(box.class_name).strip().lower()
        if not name:
            continue

        trimmed = clip_box(box, width, height)
        if trimmed is None:
            # Nothing of this box was inside the image.
            continue

        box_x, box_y, box_width, box_height = trimmed
        result.append(
            {
                "class": name,
                "x": box_x,
                "y": box_y,
                "width": box_width,
                "height": box_height,
            }
        )
    return result


def image_depth(path):
    """How many colour channels the image has. VOC wants this; 3 means RGB."""
    if Image is None:
        return 3
    try:
        with Image.open(path) as opened:
            bands = len(opened.getbands())
        if bands:
            return bands
        return 3
    except Exception:
        # Not worth failing an entire export over one unreadable header.
        return 3


def timestamp_now():
    """The time, as text, without the microseconds."""
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


# simple: images sorted by done / not done, plus one JSON file

SIMPLE_README = """\
Annotations exported from AnnotateAI.

LAYOUT
  annotated/         images that have at least one box
  not_annotated/     images with no boxes yet
  annotations.json   every image and its boxes

COORDINATES
  Plain pixels, counted from the TOP-LEFT corner of the image:

    x, y            top-left corner of the box
    width, height   size of the box

  So a box is the rectangle from (x, y) to (x + width, y + height).
  Nothing is normalised or scaled - the numbers are pixels in the original
  image, and every box is inside the image bounds.

READING IT
  import json
  data = json.load(open("annotations.json"))
  for image in data["images"]:
      print(image["file"], len(image["boxes"]))
      for box in image["boxes"]:
          print("  ", box["class"], box["x"], box["y"], box["width"], box["height"])

NOTE
  This layout is for looking at and moving data around. It will NOT train a
  YOLO model - for that, export in the YOLO format instead.
"""


def write_simple(archive, plan, project):
    """Images split into "has boxes" / "has none", plus one JSON of coordinates.

    No train/val/test here on purpose: this format answers what is finished and
    what is left, not how to train a model.
    """
    records = []
    annotated_count = 0

    for item in plan["items"]:
        boxes = boxes_in_pixels(item)

        if boxes:
            folder = "annotated"
            annotated_count += 1
        else:
            folder = "not_annotated"

        archive.write(Path(item["image"].original_path), f"{folder}/{item['name']}")

        # One decimal is plenty for pixels and keeps the JSON readable.
        json_boxes = []
        for box in boxes:
            json_boxes.append(
                {
                    "class": box["class"],
                    "x": round(box["x"], 1),
                    "y": round(box["y"], 1),
                    "width": round(box["width"], 1),
                    "height": round(box["height"], 1),
                }
            )

        records.append(
            {
                "file": f"{folder}/{item['name']}",
                "width": int(item["image"].width or 0),
                "height": int(item["image"].height or 0),
                # Reviewed is not the same as having boxes - an image saved
                # empty is reviewed but still lands in not_annotated/.
                "reviewed": item["image"].status == "reviewed",
                "boxes": json_boxes,
            }
        )

    total_boxes = 0
    for record in records:
        total_boxes += len(record["boxes"])

    document = {
        "project": project.name,
        "exported_at": timestamp_now(),
        "coordinates": "pixels, top-left origin: x, y, width, height",
        "classes": plan["class_names"],
        "summary": {
            "images": len(records),
            "annotated": annotated_count,
            "not_annotated": len(records) - annotated_count,
            "boxes": total_boxes,
        },
        "images": records,
    }

    archive.writestr("annotations.json", json.dumps(document, indent=2))
    archive.writestr("README.txt", SIMPLE_README)


# yolo (Ultralytics)

YOLO_README = """\
YOLO dataset exported from AnnotateAI.

QUICK START
  cd into this folder, then:

    python setup_paths.py
    yolo detect train data=data.yaml model=yolov8n.pt epochs=50 imgsz=640

  Run setup_paths.py first. It writes this folder's absolute location into
  data.yaml. Ultralytics resolves a *relative* 'path:' against its own global
  datasets directory (see DATASETS_DIR in its settings), not against the folder
  data.yaml lives in - so without an absolute path it looks in the wrong place
  and reports "Dataset images not found".

LAYOUT
  images/{train,val,test}   image files
  labels/{train,val,test}   one .txt per image, same stem
  data.yaml                 the dataset config you pass to Ultralytics
  classes.txt               class names, one per line, in id order
  setup_paths.py            writes the absolute path into data.yaml

LABEL FORMAT
  One row per box:
    <class_id> <x_center> <y_center> <width> <height>
  All five values normalised to 0-1 and clipped to the image.

  An empty .txt means "this image has no objects". Keep those files - YOLO
  trains on them as background examples.
"""

# Written into the zip as a file, hence a string rather than real code.
SETUP_PATHS_SCRIPT = '''\
"""Point data.yaml at this folder.

Ultralytics resolves a relative 'path:' against its global datasets directory
rather than the folder data.yaml sits in, so a freshly unzipped dataset has to
say where it actually is. Run this once, from anywhere:

    python setup_paths.py
"""
import pathlib
import re

here = pathlib.Path(__file__).resolve().parent
config = here / "data.yaml"
text = config.read_text(encoding="utf-8")

updated, count = re.subn(
    r"^path:.*$", f"path: {here.as_posix()}", text, count=1, flags=re.MULTILINE
)
if not count:
    updated = f"path: {here.as_posix()}\\n{text}"

config.write_text(updated, encoding="utf-8")
print(f"data.yaml now points at {here}")
print("Next:  yolo detect train data=data.yaml model=yolov8n.pt epochs=50")
'''


def write_yolo(archive, plan):
    """images/ and labels/ folders plus the data.yaml Ultralytics reads."""
    ids = class_ids(plan["class_names"])

    # A split can end up empty, and data.yaml must not name a missing folder.
    splits_used = set()
    for item in plan["items"]:
        splits_used.add(item["split"])

    for item in plan["items"]:
        split = item["split"]
        archive.write(
            Path(item["image"].original_path), f"images/{split}/{item['name']}"
        )

        width = float(item["image"].width or 0)
        height = float(item["image"].height or 0)

        # YOLO wants the box centre, normalised to 0-1.
        lines = []
        for box in boxes_in_pixels(item):
            centre_x = (box["x"] + box["width"] / 2) / width
            centre_y = (box["y"] + box["height"] / 2) / height
            box_width = box["width"] / width
            box_height = box["height"] / height
            lines.append(
                f"{ids[box['class']]} {centre_x:.6f} {centre_y:.6f}"
                f" {box_width:.6f} {box_height:.6f}"
            )

        # Written even when empty - that is how YOLO marks a background image.
        archive.writestr(f"labels/{split}/{item['stem']}.txt", "\n".join(lines))

    # nc: 0 would be rejected by Ultralytics, so always name one class.
    names = plan["class_names"]
    if not names:
        names = ["object"]

    yaml_lines = [
        "# Ultralytics dataset config, generated by AnnotateAI.",
        "#",
        "# 'path' is the dataset root and train/val/test hang off it. Run",
        "# `python setup_paths.py` to replace the line below with this folder's",
        "# absolute location - Ultralytics resolves a relative path against its",
        "# own datasets directory, not against this file.",
        "path: .",
        "train: images/train",
    ]

    if "val" in splits_used:
        yaml_lines.append("val: images/val")
    else:
        # val on the training images is a meaningless score, so say so.
        yaml_lines.append("# val: images/val   (no validation split in this export)")
        yaml_lines.append("val: images/train")

    if "test" in splits_used:
        yaml_lines.append("test: images/test")

    yaml_lines.append("")
    yaml_lines.append(f"nc: {len(names)}")
    yaml_lines.append("names:")
    for position, name in enumerate(names):
        yaml_lines.append(f"  {position}: {name}")

    archive.writestr("data.yaml", "\n".join(yaml_lines) + "\n")
    archive.writestr("classes.txt", "\n".join(names) + "\n")
    archive.writestr("setup_paths.py", SETUP_PATHS_SCRIPT)
    archive.writestr("README.txt", YOLO_README)


# coco detection JSON

COCO_README = (
    "COCO detection dataset exported from AnnotateAI.\n\n"
    "Layout\n"
    "  images/{train,val,test}          image files\n"
    "  annotations/instances_*.json     one file per split\n\n"
    "bbox is [x, y, width, height] in absolute pixels, top-left origin,\n"
    "clipped to the image. Category ids start at 1, as COCO expects.\n"
)


def write_coco(archive, plan, project):
    """One JSON per split, in the shape the COCO tools expect."""
    categories = []  # COCO numbers categories from 1, not 0
    category_ids = {}
    for position, name in enumerate(plan["class_names"]):
        category_id = position + 1
        categories.append({"id": category_id, "name": name, "supercategory": "none"})
        category_ids[name] = category_id

    created = timestamp_now()
    year = datetime.now(timezone.utc).year

    # One document per split; only those with images get written out.
    documents = {}
    for split in SPLITS:
        documents[split] = {
            "info": {
                "description": f"{project.name} - exported from AnnotateAI",
                "version": "1.0",
                "year": year,
                "contributor": "AnnotateAI",
                "date_created": created,
            },
            "licenses": [{"id": 1, "name": "Unknown", "url": ""}],
            "images": [],
            "annotations": [],
            "categories": categories,
        }

    annotation_id = 1  # COCO annotation ids count from 1

    for item in plan["items"]:
        document = documents[item["split"]]

        document["images"].append(
            {
                "id": item["image"].id,
                "file_name": item["name"],
                "width": int(item["image"].width or 0),
                "height": int(item["image"].height or 0),
                "license": 1,
                "date_captured": "",
            }
        )

        for box in boxes_in_pixels(item):
            document["annotations"].append(
                {
                    "id": annotation_id,
                    "image_id": item["image"].id,
                    "category_id": category_ids[box["class"]],
                    "bbox": [
                        round(box["x"], 2),
                        round(box["y"], 2),
                        round(box["width"], 2),
                        round(box["height"], 2),
                    ],
                    "area": round(box["width"] * box["height"], 2),
                    "iscrowd": 0,
                    "segmentation": [],
                }
            )
            annotation_id += 1

        archive.write(
            Path(item["image"].original_path), f"images/{item['split']}/{item['name']}"
        )

    for split in SPLITS:
        document = documents[split]
        if document["images"]:
            archive.writestr(
                f"annotations/instances_{split}.json", json.dumps(document, indent=2)
            )

    archive.writestr("README.txt", COCO_README)


# Pascal VOC

VOC_README = (
    "Pascal VOC dataset exported from AnnotateAI.\n\n"
    "Layout\n"
    "  JPEGImages/          image files\n"
    "  Annotations/         one .xml per image, same stem\n"
    "  ImageSets/Main/      train.txt / val.txt / test.txt list the stems\n\n"
    "Box coordinates are 1-based and inclusive, as VOC specifies.\n"
)


def build_voc_xml(item, depth):
    """One Pascal VOC annotation file, returned as bytes ready to write."""
    root = ET.Element("annotation")
    ET.SubElement(root, "folder").text = "JPEGImages"
    ET.SubElement(root, "filename").text = item["name"]
    ET.SubElement(root, "path").text = f"JPEGImages/{item['name']}"

    source = ET.SubElement(root, "source")
    ET.SubElement(source, "database").text = "AnnotateAI"

    size = ET.SubElement(root, "size")
    ET.SubElement(size, "width").text = str(int(item["image"].width or 0))
    ET.SubElement(size, "height").text = str(int(item["image"].height or 0))
    ET.SubElement(size, "depth").text = str(depth)
    ET.SubElement(root, "segmented").text = "0"

    for box in boxes_in_pixels(item):
        obj = ET.SubElement(root, "object")
        ET.SubElement(obj, "name").text = box["class"]
        ET.SubElement(obj, "pose").text = "Unspecified"
        ET.SubElement(obj, "truncated").text = "0"
        ET.SubElement(obj, "difficult").text = "0"

        # VOC pixels are 1-based and inclusive: +1 on left/top, right/bottom
        # used as-is.
        bndbox = ET.SubElement(obj, "bndbox")
        ET.SubElement(bndbox, "xmin").text = str(int(round(box["x"])) + 1)
        ET.SubElement(bndbox, "ymin").text = str(int(round(box["y"])) + 1)
        ET.SubElement(bndbox, "xmax").text = str(int(round(box["x"] + box["width"])))
        ET.SubElement(bndbox, "ymax").text = str(int(round(box["y"] + box["height"])))

    ET.indent(root, space="  ")
    return ET.tostring(root, encoding="utf-8", xml_declaration=False)


def write_voc(archive, plan):
    """One XML per image, plus the ImageSets lists for each split."""
    split_lists = {}
    for split in SPLITS:
        split_lists[split] = []

    for item in plan["items"]:
        source_path = Path(item["image"].original_path)
        archive.write(source_path, f"JPEGImages/{item['name']}")

        xml_bytes = build_voc_xml(item, image_depth(source_path))
        archive.writestr(f"Annotations/{item['stem']}.xml", xml_bytes)

        split_lists[item["split"]].append(item["stem"])

    for split in SPLITS:
        stems = split_lists[split]
        if stems:
            archive.writestr(f"ImageSets/Main/{split}.txt", "\n".join(stems) + "\n")

    archive.writestr("classes.txt", "\n".join(plan["class_names"]) + "\n")
    archive.writestr("README.txt", VOC_README)


# flat CSV

CSV_README = (
    "CSV annotations exported from AnnotateAI.\n\n"
    "annotations.csv has one row per box, with absolute pixel corners\n"
    "(xmin, ymin, xmax, ymax). An image with no objects gets one row with\n"
    "the box columns left blank.\n"
)


def write_csv(archive, plan):
    """One row per box, for a spreadsheet or pandas."""
    buffer = io.StringIO()
    writer = csv.writer(buffer, lineterminator="\n")
    writer.writerow(
        ["filename", "split", "width", "height", "class", "xmin", "ymin", "xmax", "ymax"]
    )

    for item in plan["items"]:
        archive.write(
            Path(item["image"].original_path), f"images/{item['split']}/{item['name']}"
        )

        boxes = boxes_in_pixels(item)

        if not boxes:
            # A blank row still shows the image was included, just empty.
            writer.writerow(
                [
                    item["name"],
                    item["split"],
                    item["image"].width,
                    item["image"].height,
                    "",
                    "",
                    "",
                    "",
                    "",
                ]
            )
            continue

        for box in boxes:
            writer.writerow(
                [
                    item["name"],
                    item["split"],
                    int(item["image"].width or 0),
                    int(item["image"].height or 0),
                    box["class"],
                    int(round(box["x"])),
                    int(round(box["y"])),
                    int(round(box["x"] + box["width"])),
                    int(round(box["y"] + box["height"])),
                ]
            )

    archive.writestr("annotations.csv", buffer.getvalue())
    archive.writestr("classes.txt", "\n".join(plan["class_names"]) + "\n")
    archive.writestr("README.txt", CSV_README)




def write_archive(path, plan, fmt, project):
    """Create the zip file for one format and return where it was written."""
    path.parent.mkdir(parents=True, exist_ok=True)

    with zipfile.ZipFile(path, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        if fmt == "simple":
            write_simple(archive, plan, project)
        elif fmt == "yolo":
            write_yolo(archive, plan)
        elif fmt == "coco":
            write_coco(archive, plan, project)
        elif fmt == "voc":
            write_voc(archive, plan)
        elif fmt == "csv":
            write_csv(archive, plan)
        else:
            # The API validates fmt first, so this means FORMATS gained an
            # entry and nobody added a writer.
            raise ValueError(f"No writer for export format '{fmt}'")

    counts = plan["counts"]
    logger.info(
        "Exported project %s as %s: %d images, %d boxes, %d classes"
        " (train %d / val %d / test %d)",
        project.id,
        fmt,
        counts.get("images", 0),
        counts.get("boxes", 0),
        len(plan["class_names"]),
        counts.get("train", 0),
        counts.get("val", 0),
        counts.get("test", 0),
    )
    return path
