import threading
from collections import Counter
from pathlib import Path

import cv2
from ultralytics import YOLO
from ultralytics import settings as yolo_settings

from app.core.config import settings

# Ultralytics' analytics/auto-update pings fire a network request on the first
# prediction and can stall it.
try:
    yolo_settings.update({"sync": False})
except Exception:  # pragma: no cover - never let this break startup
    pass


class DetectorService:
    """YOLO-based object detection — AI first pass."""

    _model: YOLO | None = None
    _lock = threading.Lock()

    @classmethod
    def get_model(cls) -> YOLO:
        # Weights take a few seconds; don't let two requests both load them.
        if cls._model is None:
            with cls._lock:
                if cls._model is None:
                    cls._model = YOLO(settings.yolo_model)
        return cls._model

    @classmethod
    def warm_up(cls) -> None:
        """Load the model ahead of the first request."""
        try:
            cls.get_model()
        except Exception:  # pragma: no cover
            pass

    @classmethod
    def detect(cls, image_path: Path, confidence_threshold: float | None = None) -> dict:
        model = cls.get_model()
        results = model.predict(
            source=str(image_path),
            conf=confidence_threshold if confidence_threshold is not None else settings.confidence_threshold,
            verbose=False,
        )
        result = results[0]
        boxes = []
        class_names: list[str] = []

        if result.boxes is not None:
            for box in result.boxes:
                xyxy = box.xyxy[0].cpu().numpy()
                conf = float(box.conf[0].cpu().numpy())
                cls_id = int(box.cls[0].cpu().numpy())
                name = result.names[cls_id]
                x1, y1, x2, y2 = map(float, xyxy)
                boxes.append(
                    {
                        "class_name": name,
                        "confidence": round(conf, 4),
                        "x": x1,
                        "y": y1,
                        "width": x2 - x1,
                        "height": y2 - y1,
                    }
                )
                class_names.append(name)

        counts = Counter(class_names)
        class_counts = [{"class_name": k, "count": v} for k, v in sorted(counts.items(), key=lambda i: (-i[1], i[0]))]

        height, width = result.orig_shape
        return {
            "width": int(width),
            "height": int(height),
            "detections": boxes,
            "class_counts": class_counts,
            "total_objects": len(boxes),
        }

    @classmethod
    def draw_boxes(cls, image_path: Path, detections: list[dict], output_path: Path) -> Path:
        image = cv2.imread(str(image_path))
        if image is None:
            raise ValueError(f"Cannot read image: {image_path}")

        palette = [
            (46, 204, 113),
            (52, 152, 219),
            (241, 196, 15),
            (231, 76, 60),
            (155, 89, 182),
            (26, 188, 156),
            (230, 126, 34),
            (52, 73, 94),
        ]
        class_colors: dict[str, tuple[int, int, int]] = {}

        for det in detections:
            name = det["class_name"]
            if name not in class_colors:
                class_colors[name] = palette[len(class_colors) % len(palette)]
            color = class_colors[name]
            x, y, w, h = int(det["x"]), int(det["y"]), int(det["width"]), int(det["height"])
            conf = det.get("confidence", 1.0)
            cv2.rectangle(image, (x, y), (x + w, y + h), color, 2)
            label = f"{name} {conf:.0%}"
            (tw, th), _ = cv2.getTextSize(label, cv2.FONT_HERSHEY_SIMPLEX, 0.55, 1)
            cv2.rectangle(image, (x, max(0, y - th - 8)), (x + tw + 6, y), color, -1)
            cv2.putText(
                image,
                label,
                (x + 3, max(th + 2, y - 4)),
                cv2.FONT_HERSHEY_SIMPLEX,
                0.55,
                (255, 255, 255),
                1,
                cv2.LINE_AA,
            )

        output_path.parent.mkdir(parents=True, exist_ok=True)
        cv2.imwrite(str(output_path), image)
        return output_path


detector_service = DetectorService()
