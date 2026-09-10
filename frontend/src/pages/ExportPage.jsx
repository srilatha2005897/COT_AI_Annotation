import { useCallback, useEffect, useState } from "react";
import { EXPORT_FORMATS, exportDataset, listImages, listProjects } from "../api";
import "../styles/shared.css";

// What ends up in the zip, per format — shown so people know what they're getting.
const FORMAT_CONTENTS = {
  simple: [
    ["✅", "annotated/", "Images that have boxes"],
    ["⬜", "not_annotated/", "Images with no boxes yet"],
    ["🏷️", "annotations.json", "Every image and its boxes, in pixels"],
  ],
  yolo: [
    ["📁", "images/train, val, test", "Image files, one folder per split"],
    ["🏷️", "labels/train, val, test", "One YOLO .txt per image, same name"],
    ["📄", "data.yaml", "Point Ultralytics at this file to train"],
    ["📋", "classes.txt", "Class names in id order"],
  ],
  coco: [
    ["📁", "images/train, val, test", "Image files, one folder per split"],
    ["🏷️", "annotations/instances_*.json", "One COCO JSON per split"],
    ["📐", "bbox = [x, y, w, h]", "Absolute pixels, category ids from 1"],
  ],
  voc: [
    ["📁", "JPEGImages/", "Image files"],
    ["🏷️", "Annotations/", "One Pascal VOC .xml per image"],
    ["📄", "ImageSets/Main/", "train.txt, val.txt, test.txt"],
  ],
  csv: [
    ["📁", "images/train, val, test", "Image files, one folder per split"],
    ["🏷️", "annotations.csv", "One row per box, pixel corners"],
    ["📋", "classes.txt", "Class names used in the file"],
  ],
};

// Pick a project and a format, and download it as a training dataset.
export function ExportYoloPage() {
  const [projects, setProjects] = useState([]);
  const [selectedProjectId, setSelectedProjectId] = useState(
    localStorage.getItem("annotateai_project_id") || ""
  );
  const [images, setImages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [format, setFormat] = useState("simple");
  const [valRatio, setValRatio] = useState(0.2);
  const [testRatio, setTestRatio] = useState(0);
  const [onlyReviewed, setOnlyReviewed] = useState(false);
  const [showAllFormats, setShowAllFormats] = useState(false);

  const load = useCallback(async (projectId) => {
    setLoading(true);
    setError("");
    try {
      const projectList = await listProjects();
      const list = Array.isArray(projectList) ? projectList : [];
      setProjects(list);
      // The remembered project may have been deleted since, so fall back to the
      // first one rather than leaving a dead id selected.
      const remembered = list.some((p) => String(p.id) === String(projectId));
      const id = (remembered && projectId) || list[0]?.id;
      if (id) {
        setSelectedProjectId(String(id));
        localStorage.setItem("annotateai_project_id", String(id));
        const imageList = await listImages(id);
        setImages(Array.isArray(imageList) ? imageList : []);
      } else {
        setImages([]);
      }
    } catch (err) {
      setError(err.message || "Could not load export data.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load(selectedProjectId);
  }, [load]);

  const handleProjectChange = async (event) => {
    const id = event.target.value;
    setSelectedProjectId(id);
    setMessage("");
    setError("");
    if (!id) {
      setImages([]);
      return;
    }
    localStorage.setItem("annotateai_project_id", id);
    try {
      const result = await listImages(id);
      setImages(Array.isArray(result) ? result : []);
    } catch (err) {
      setError(err.message || "Could not load project images.");
    }
  };

  const activeFormat = EXPORT_FORMATS.find((f) => f.id === format) || EXPORT_FORMATS[0];

  const extraFormats = EXPORT_FORMATS.filter((f) => !f.primary);
  // Keep whatever is selected on screen, even if it lives behind the toggle.
  const visibleFormats = EXPORT_FORMATS.filter(
    (f) => f.primary || showAllFormats || f.id === format
  );

  const handleExport = async () => {
    if (!selectedProjectId) {
      setError("Select a project before exporting.");
      return;
    }
    setExporting(true);
    setError("");
    setMessage("");
    try {
      const { blob, filename } = await exportDataset(selectedProjectId, {
        format,
        valRatio,
        testRatio,
        onlyReviewed,
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = filename || `annotateai_${format}_dataset.zip`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 500);
      setMessage(`${activeFormat.label} dataset exported successfully.`);
    } catch (err) {
      setError(err.message || "Export failed.");
    } finally {
      setExporting(false);
    }
  };

  const selectedProject = projects.find(
    (p) => String(p.id) === String(selectedProjectId)
  );
  const totalObjects = images.reduce(
    (sum, image) => sum + Number(image?.total_objects || 0),
    0
  );

  return (
    <main className="export-page">
      <div className="export-container">
        {error && <div className="export-alert error">{error}</div>}
        {message && <div className="export-alert success">{message}</div>}

        <section className="export-card">
          <div className="export-card-header">
            <div>
              <h2>Select project</h2>
              <p>Only annotations belonging to the selected project will be exported.</p>
            </div>
            <select
              value={selectedProjectId}
              onChange={handleProjectChange}
              disabled={loading}
            >
              <option value="">Choose a project</option>
              {projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
            </select>
          </div>

          <div className="export-stats">
            <div>
              <span>Project</span>
              <strong>{selectedProject?.name || "—"}</strong>
            </div>
            <div>
              <span>Images</span>
              <strong>{images.length}</strong>
            </div>
            <div>
              <span>Objects</span>
              <strong>{totalObjects}</strong>
            </div>
          </div>
        </section>

        <section className="export-card">
          <div className="export-card-header">
            <div>
              <h2>Format</h2>
              <p>Same annotations, written the way each toolchain expects them.</p>
            </div>
          </div>

          <div className="export-formats">
            {visibleFormats.map((option) => (
              <label
                key={option.id}
                className={`export-format ${format === option.id ? "selected" : ""}`}
              >
                <input
                  type="radio"
                  name="export-format"
                  value={option.id}
                  checked={format === option.id}
                  onChange={() => {
                    setFormat(option.id);
                    setMessage("");
                  }}
                />
                <div>
                  <strong>{option.label}</strong>
                  <small>{option.note}</small>
                </div>
              </label>
            ))}
          </div>

          {extraFormats.length > 0 && (
            <button
              type="button"
              className="export-more-formats"
              onClick={() => setShowAllFormats((shown) => !shown)}
            >
              {showAllFormats
                ? "Fewer formats"
                : `More formats (${extraFormats.map((f) => f.short).join(", ")})`}
            </button>
          )}
        </section>

        {!activeFormat.splitless && (
          <section className="export-card">
            <div className="export-card-header">
              <div>
                <h2>Split</h2>
                <p>
                  Which images go to training, validation and test. The split is worked
                  out from the project id, so re-exporting gives you the same one.
                </p>
              </div>
            </div>

            <div className="export-options">
              <label>
                Validation
                <select
                  value={valRatio}
                  onChange={(event) => setValRatio(Number(event.target.value))}
                >
                  {[0, 0.1, 0.15, 0.2, 0.25, 0.3].map((value) => (
                    <option key={value} value={value}>
                      {value === 0 ? "none" : `${Math.round(value * 100)}%`}
                    </option>
                  ))}
                </select>
              </label>

              <label>
                Test
                <select
                  value={testRatio}
                  onChange={(event) => setTestRatio(Number(event.target.value))}
                >
                  {[0, 0.1, 0.15, 0.2].map((value) => (
                    <option key={value} value={value}>
                      {value === 0 ? "none" : `${Math.round(value * 100)}%`}
                    </option>
                  ))}
                </select>
              </label>

              <label className="export-checkbox">
                <input
                  type="checkbox"
                  checked={onlyReviewed}
                  onChange={(event) => setOnlyReviewed(event.target.checked)}
                />
                <span>
                  Reviewed images only
                  <small>Leave out anything a person hasn&apos;t checked yet</small>
                </span>
              </label>
            </div>

            <p className="export-split-summary">
              Training gets{" "}
              <strong>{Math.round((1 - valRatio - testRatio) * 100)}%</strong> of the
              images.
            </p>
          </section>
        )}

        <section className="export-card">
          <div className="export-card-header">
            <div>
              <h2>What you get</h2>
              <p>Contents of the {activeFormat.label} zip.</p>
            </div>
          </div>
          <div className="export-files">
            {(FORMAT_CONTENTS[format] || []).map(([icon, name, note]) => (
              <div key={name}>
                <span>{icon}</span>
                <div>
                  <strong>{name}</strong>
                  <small>{note}</small>
                </div>
              </div>
            ))}
          </div>
          <button
            className="export-primary-button"
            type="button"
            onClick={handleExport}
            disabled={exporting || loading || !selectedProjectId}
          >
            {exporting ? "Preparing export..." : `Download ${activeFormat.label} ZIP →`}
          </button>
        </section>
      </div>
    </main>
  );
}
