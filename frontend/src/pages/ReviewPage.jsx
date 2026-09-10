import { useEffect, useState } from "react";
import AnnotationEditor from "../components/AnnotationEditor";
import ClassBreakdown from "../components/ClassBreakdown";
import { getImage, listImages, saveAnnotations } from "../api";
import "../styles/shared.css";

// Count how many boxes there are of each class.
function getClassCounts(boxes = []) {
  const map = {};
  boxes.forEach((box) => {
    const name = box?.class_name || "unknown";
    map[name] = (map[name] || 0) + 1;
  });
  return Object.entries(map).map(([class_name, count]) => ({ class_name, count }));
}

// A box boiled down to the bits worth comparing, so we can tell whether the
// reviewer has actually changed anything. Coordinates are rounded to whole
// pixels - a sub-pixel wobble while dragging isn't an edit worth warning about.
function boxKey(box) {
  return [
    box?.class_name ?? "",
    Math.round(Number(box?.confidence ?? 1) * 1000),
    Math.round(Number(box?.x ?? 0)),
    Math.round(Number(box?.y ?? 0)),
    Math.round(Number(box?.width ?? 0)),
    Math.round(Number(box?.height ?? 0)),
  ].join("|");
}

function boxesMatch(a = [], b = []) {
  return a.length === b.length && a.every((box, i) => boxKey(box) === boxKey(b[i]));
}

// The screen where a person checks / fixes the AI boxes and saves the result.
// VerifyPage below is the same thing with a slightly different heading.
export function ReviewPage({ imageId, onSaved, onBack, mode = "review", readOnly = false }) {
  const [data, setData] = useState(null);
  const [boxes, setBoxes] = useState([]);
  // What the server last confirmed, so we can spot unsaved edits.
  const [savedBoxes, setSavedBoxes] = useState([]);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  // Ids of the other images in the same project, for prev / next navigation.
  const [siblings, setSiblings] = useState([]);

  useEffect(() => {
    let alive = true;
    getImage(imageId)
      .then((image) => {
        if (!alive) return;
        const loaded = (image.detections || []).map((d) => ({ ...d }));
        setData(image);
        setBoxes(loaded);
        setSavedBoxes(loaded.map((d) => ({ ...d })));
      })
      .catch((err) => {
        if (alive) setError(err.message || "Could not load image.");
      });
    return () => {
      alive = false;
    };
  }, [imageId]);

  useEffect(() => {
    const projectId = data?.project_id;
    if (!projectId) return undefined;

    let alive = true;
    listImages(projectId)
      .then((list) => {
        if (alive && Array.isArray(list)) {
          setSiblings(list.map((item) => item.id ?? item.image_id).filter(Boolean));
        }
      })
      .catch(() => {}); // prev/next is a nice-to-have
    return () => {
      alive = false;
    };
  }, [data?.project_id]);

  const currentIndex = siblings.indexOf(Number(imageId));
  const prevId = currentIndex > 0 ? siblings[currentIndex - 1] : null;
  const nextId =
    currentIndex >= 0 && currentIndex < siblings.length - 1
      ? siblings[currentIndex + 1]
      : null;

  const dirty = !boxesMatch(boxes, savedBoxes);

  // Catch a tab close / refresh with edits still in the editor.
  useEffect(() => {
    if (!dirty) return undefined;
    const warn = (event) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const confirmLeave = () =>
    !dirty ||
    window.confirm("You have unsaved annotation changes. Leave without saving?");

  const goTo = (targetId) => {
    if (targetId && confirmLeave()) {
      window.location.hash = `#/${mode === "verify" ? "verify" : "review"}/${targetId}`;
    }
  };

  const save = async () => {
    if (readOnly) return false;
    setSaving(true);
    setError("");

    try {
      const updated = await saveAnnotations(
        imageId,
        boxes.map(({ class_name, confidence, x, y, width, height, source }) => ({
          class_name,
          confidence: confidence ?? 1,
          x,
          y,
          width,
          height,
          source: source || "human",
        }))
      );

      const confirmed = (updated.detections || []).map((detection) => ({
        ...detection,
      }));
      setData(updated);
      setBoxes(confirmed);
      setSavedBoxes(confirmed.map((detection) => ({ ...detection })));

      onSaved?.(updated);
      return true;
    } catch (err) {
      setError(err.message || "Could not save annotations.");
      return false;
    } finally {
      setSaving(false);
    }
  };

  const saveAndNext = async () => {
    const ok = await save();
    if (ok && nextId) goTo(nextId);
  };

  if (error && !data) {
    return <div className="error">{error}</div>;
  }

  if (!data) {
    return (
      <div className="dashboard-loading">
        <div className="spinner" />
        Loading image...
      </div>
    );
  }

  return (
    <main className="review-page">
      <section className="dashboard-section">
        <div className="review-top-actions">
          <button
            type="button"
            className="secondary-button"
            onClick={() => {
              if (confirmLeave()) onBack?.();
            }}
          >
            ← Dashboard
          </button>

          {siblings.length > 1 && currentIndex >= 0 && (
            <div className="review-pager">
              <button
                type="button"
                className="secondary-button"
                onClick={() => goTo(prevId)}
                disabled={!prevId}
              >
                ← Prev
              </button>
              <span>
                Image {currentIndex + 1} of {siblings.length}
              </span>
              <button
                type="button"
                className="secondary-button"
                onClick={() => goTo(nextId)}
                disabled={!nextId}
              >
                Next →
              </button>
            </div>
          )}
        </div>

        <div className="section-heading">
          <div>
            <span className="section-eyebrow">
              {mode === "verify" ? "HUMAN VERIFICATION" : "IMAGE REVIEW"}
            </span>

            <h1>{mode === "verify" ? "Verify Annotations" : "Review & edit"}</h1>

            <p>
              {mode === "verify"
                ? "Validate AI detections, correct labels and save the final annotations."
                : "Add, move, resize, relabel or delete boxes, then save."}
            </p>
          </div>

          <div className="section-total">
            <strong>{boxes.length}</strong>

            <span>annotations</span>
          </div>
        </div>

        <ClassBreakdown counts={getClassCounts(boxes)} total={boxes.length} />

        <AnnotationEditor
          imageId={imageId}
          width={data.width}
          height={data.height}
          boxes={boxes}
          setBoxes={setBoxes}
          saving={saving}
          error={error}
          setError={setError}
          onSave={save}
          readOnly={readOnly}
        />

        <div className="review-next-bar">
          <span className={dirty ? "review-status-dirty" : undefined}>
            {dirty
              ? "Unsaved changes"
              : data.status === "reviewed"
                ? "This image is saved."
                : "Not saved yet."}
          </span>
          {!readOnly && nextId && (
            <button
              type="button"
              className="primary-button"
              disabled={saving}
              onClick={saveAndNext}
            >
              {saving ? "Saving..." : "Save & next image →"}
            </button>
          )}
        </div>
      </section>
    </main>
  );
}

export function VerifyPage(props) {
  return <ReviewPage {...props} mode="verify" />;
}
