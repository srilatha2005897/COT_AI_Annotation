import { useCallback, useRef, useState } from "react";
import AnnotationEditor from "../components/AnnotationEditor";
import { detectBatchChunked, detectImage, saveAnnotations } from "../api";
import "../styles/shared.css";

// Upload one or more images, run YOLO on them, then hand off to the editor.
export function UploadPage({ onDetected, projectId = null, onBack }) {
  const inputRef = useRef(null);
  const folderInputRef = useRef(null);

  const [dragOver, setDragOver] = useState(false);
  const [loading, setLoading] = useState(false);
  const [savingCorrections, setSavingCorrections] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState(null); // single-image result
  const [batchResults, setBatchResults] = useState([]); // multi-image result
  const [skipped, setSkipped] = useState([]);
  const [progress, setProgress] = useState(null); // {done, total}
  const [threshold, setThreshold] = useState(0.5);

  const handleFiles = useCallback(
    async (fileList) => {
      const files = Array.from(fileList || []).filter((file) =>
        file?.type?.startsWith("image/")
      );

      if (!files.length) {
        setError("Please select one or more image files.");
        return;
      }

      if (projectId === null || projectId === undefined || projectId === "") {
        setError("Please select a project before uploading images.");
        return;
      }

      setLoading(true);
      setError("");
      setResult(null);
      setBatchResults([]);
      setSkipped([]);
      setProgress(null);

      try {
        if (files.length === 1) {
          const data = await detectImage(files[0], projectId, threshold);
          setResult(data);
          onDetected?.(data);
        } else {
          // Sent in chunks, so a folder of any size works.
          const { results, skipped: rejected } = await detectBatchChunked(
            files,
            projectId,
            threshold,
            { onProgress: setProgress }
          );
          setBatchResults(results);
          setSkipped(rejected);
          if (!results.length) {
            setError("None of those files could be processed.");
          }
          onDetected?.(results);
        }

        // Nudge the app shell to refresh its project list / counts.
        window.dispatchEvent(new HashChangeEvent("hashchange"));
      } catch (err) {
        setError(err.message || "Detection failed.");
      } finally {
        setLoading(false);
        setProgress(null);
      }
    },
    [onDetected, projectId, threshold]
  );

  const saveResult = async (currentBoxes) => {
    if (!result) {
      return;
    }

    setSavingCorrections(true);
    setError("");

    try {
      const updated = await saveAnnotations(
        result.image_id,
        currentBoxes.map(({ class_name, confidence, x, y, width, height, source }) => ({
          class_name,
          confidence: confidence ?? 1,
          x,
          y,
          width,
          height,
          source: source || "human",
        }))
      );

      setResult(updated);
    } catch (err) {
      setError(err.message || "Could not save annotations.");
    } finally {
      setSavingCorrections(false);
    }
  };

  const uploadedCount = result ? 1 : batchResults.length;
  const hasResult = uploadedCount > 0;

  const goToImages = () => {
    if (projectId) {
      window.location.hash = `#/dashboard/project/${projectId}/images`;
    } else {
      onBack?.();
    }
  };

  const startOver = () => {
    setResult(null);
    setBatchResults([]);
    setError("");
  };

  return (
    <section className="upload-section">
      <div className="upload-top-actions">
        <button type="button" className="secondary-button" onClick={() => onBack?.()}>
          ← Back to project
        </button>
      </div>

      <div className="upload-section-header">
        <div>
          <span className="section-eyebrow">DATASET INGESTION</span>

          <h2>Upload images</h2>

          <p>
            AI will automatically detect objects and create bounding boxes for review.
          </p>
        </div>

        {projectId && <div className="project-selected-pill">Project #{projectId}</div>}
      </div>

      <div
        className={`upload-dropzone ${dragOver ? "drag-over" : ""} ${
          hasResult ? "compact" : ""
        }`}
        onClick={() => inputRef.current?.click()}
        onDragOver={(event) => {
          event.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragOver(false);

          handleFiles(event.dataTransfer.files);
        }}
      >
        <div className="upload-icon">↑</div>

        <h3>{hasResult ? "Add more images" : "Drop images here"}</h3>

        <p>Upload one image, multiple images, or an entire folder.</p>

        <div className="threshold-control">
          <div>
            <span>YOLO confidence</span>

            <strong>{Math.round(threshold * 100)}%</strong>
          </div>

          <input
            type="range"
            min="0.25"
            max="0.95"
            step="0.05"
            value={threshold}
            onChange={(event) => setThreshold(Number(event.target.value))}
            onClick={(event) => event.stopPropagation()}
          />
        </div>

        <div className="upload-buttons">
          <button
            type="button"
            className="primary-button"
            disabled={loading || !projectId}
            onClick={(event) => {
              event.stopPropagation();
              inputRef.current?.click();
            }}
          >
            + Select Images
          </button>

          <button
            type="button"
            className="secondary-button"
            disabled={loading || !projectId}
            onClick={(event) => {
              event.stopPropagation();
              folderInputRef.current?.click();
            }}
          >
            Select Folder
          </button>
        </div>

        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          multiple
          hidden
          onChange={(event) => {
            handleFiles(event.target.files);
            event.target.value = "";
          }}
        />

        <input
          ref={folderInputRef}
          type="file"
          accept="image/*"
          multiple
          webkitdirectory="true"
          directory="true"
          hidden
          onChange={(event) => {
            handleFiles(event.target.files);
            event.target.value = "";
          }}
        />
      </div>

      {loading && (
        <div className="loading">
          <div className="spinner" />
          {progress
            ? `Running YOLO detection… ${progress.done} of ${progress.total} images`
            : "Running YOLO detection..."}
          {progress && (
            <div className="upload-progress">
              <div
                className="upload-progress-bar"
                style={{ width: `${(progress.done / progress.total) * 100}%` }}
              />
            </div>
          )}
        </div>
      )}

      {error && !result && !batchResults.length && <div className="error">{error}</div>}

      {skipped.length > 0 && (
        <div className="upload-skipped">
          <strong>
            {skipped.length} file{skipped.length === 1 ? "" : "s"} skipped
          </strong>
          <ul>
            {skipped.slice(0, 8).map((item, index) => (
              <li key={`${item.filename}-${index}`}>
                {item.filename} — {item.reason}
              </li>
            ))}
          </ul>
          {skipped.length > 8 && <small>…and {skipped.length - 8} more.</small>}
        </div>
      )}

      {hasResult && (
        <div className="upload-success">
          <div className="upload-success-text">
            <span className="upload-success-check">✓</span>
            <div>
              <strong>
                {uploadedCount} image{uploadedCount === 1 ? "" : "s"} added to this
                project
              </strong>
              <span>
                AI detection finished. Review the boxes below or open the project.
              </span>
            </div>
          </div>
          <div className="upload-success-actions">
            <button type="button" className="primary-button" onClick={goToImages}>
              View project images →
            </button>
            <button type="button" className="secondary-button" onClick={startOver}>
              Upload more
            </button>
          </div>
        </div>
      )}

      {batchResults.length > 0 && (
        <div className="batch-results">
          <div className="batch-grid">
            {batchResults.map((image) => (
              <a
                key={image.image_id}
                className="batch-card"
                href={`#/review/${image.image_id}`}
              >
                <strong>{image.filename}</strong>
                <span>{image.total_objects} objects</span>
                <small>Review →</small>
              </a>
            ))}
          </div>
        </div>
      )}

      {result && (
        <AnnotationEditor
          imageId={result.image_id}
          width={result.width}
          height={result.height}
          boxes={result.detections || []}
          setBoxes={(updater) =>
            setResult((previous) => ({
              ...previous,

              detections:
                typeof updater === "function" ? updater(previous.detections) : updater,
            }))
          }
          saving={savingCorrections}
          error={error}
          setError={setError}
          onSave={() => saveResult(result.detections)}
        />
      )}
    </section>
  );
}
