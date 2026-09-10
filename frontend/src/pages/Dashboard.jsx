import "./Dashboard.css";

// The API gives us the active boxes under `detections`.
function getBoxes(image) {
  return Array.isArray(image?.detections) ? image.detections : [];
}

function averageConfidence(boxes) {
  if (!boxes.length) return 0;
  const total = boxes.reduce((sum, box) => sum + (Number(box?.confidence) || 0), 0);
  return Math.round((total / boxes.length) * 100);
}

export default function Dashboard({
  projects = [],
  images = [],
  stats = null,
  onOpenImage,
  onVerifyImage,
  loading = false,
  error = "",
}) {
  // Totals come from /api/dashboard so they cover the whole dataset, not just
  // the recent images we happen to have on screen.
  const totalProjects = projects.length;
  const totalImages = Number(stats?.total_images ?? images.length);
  const totalAnnotations = Number(
    stats?.total_objects ?? images.reduce((sum, img) => sum + getBoxes(img).length, 0)
  );

  const classStats = (Array.isArray(stats?.class_counts) ? stats.class_counts : [])
    .map((item) => ({
      name: item.class_name || "Unknown",
      count: Number(item.count || 0),
    }))
    .sort((a, b) => b.count - a.count);

  if (loading) {
    return (
      <div className="dashboard-page embedded">
        <main className="dashboard-container">
          <div className="dashboard-empty">
            <div className="spinner" />
            <p>Loading dashboard...</p>
          </div>
        </main>
      </div>
    );
  }

  if (error) {
    return (
      <div className="dashboard-page embedded">
        <main className="dashboard-container">
          <div className="dashboard-empty">
            <strong>Unable to load dashboard</strong>
            <p>{error}</p>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="dashboard-page embedded">
      <main className="dashboard-container">
        <p className="dashboard-subtitle dashboard-lede">
          Review AI detections and manually verify your dataset.
        </p>

        <section className="dashboard-stats">
          {[
            ["▣", "Projects", totalProjects],
            ["▧", "Images", totalImages],
            ["✎", "Annotations", totalAnnotations],
            ["◇", "Classes", classStats.length],
          ].map(([icon, label, value]) => (
            <div className="dashboard-stat-card" key={label}>
              <div className="dashboard-stat-icon">{icon}</div>
              <div className="dashboard-stat-content">
                <p className="dashboard-stat-label">{label}</p>
                <p className="dashboard-stat-value">{value}</p>
              </div>
            </div>
          ))}
        </section>

        <section className="dashboard-section">
          <div className="dashboard-section-header">
            <div>
              <h2 className="dashboard-section-title">Detected Classes</h2>
              <p className="dashboard-section-description">
                Distribution of detected objects in your dataset.
              </p>
            </div>
          </div>

          {classStats.length === 0 ? (
            <div className="dashboard-empty">No detected classes yet.</div>
          ) : (
            <div className="dashboard-class-grid">
              {classStats.map((item) => (
                <div className="dashboard-class-card" key={item.name}>
                  <p className="dashboard-class-name">{item.name}</p>
                  <div className="dashboard-class-count-box">
                    <span className="dashboard-class-count">{item.count}</span>
                  </div>
                  <p className="dashboard-class-description">
                    {item.count === 1
                      ? "1 detected object"
                      : `${item.count} detected objects`}
                  </p>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="dashboard-section">
          <div className="dashboard-section-header">
            <div>
              <h2 className="dashboard-section-title">Image Review</h2>
              <p className="dashboard-section-description">
                Compare original images with AI-labeled images and manually verify the
                detections.
              </p>
            </div>
          </div>

          {images.length === 0 ? (
            <div className="dashboard-empty">No images available for review.</div>
          ) : (
            <div className="dashboard-review-list">
              {images.map((image, index) => {
                const imageId = image.id ?? image.image_id;
                const imageName = image.filename || `Image #${imageId ?? index + 1}`;
                const boxes = getBoxes(image);
                const objectCount = Number(image.total_objects ?? boxes.length);
                const confidence = averageConfidence(boxes);

                return (
                  <article className="dashboard-review-card" key={imageId ?? index}>
                    <div className="dashboard-review-header">
                      <div className="dashboard-image-title">
                        <p className="dashboard-image-number">IMAGE {index + 1}</p>
                        <h3 className="dashboard-image-name">{imageName}</h3>
                        <p className="dashboard-image-meta">
                          {objectCount} detected object{objectCount !== 1 ? "s" : ""}
                        </p>
                      </div>
                      <button
                        type="button"
                        className="dashboard-button"
                        onClick={() => onOpenImage?.(image)}
                      >
                        Open Annotation
                      </button>
                    </div>

                    <div className="dashboard-review-layout">
                      <div className="dashboard-images">
                        {[
                          [
                            "Original Image",
                            "Source image",
                            `/api/files/original/${imageId}`,
                          ],
                          [
                            "Labeled Image",
                            "AI-generated annotations",
                            `/api/files/annotated/${imageId}`,
                          ],
                        ].map(([title, caption, src]) => (
                          <div className="dashboard-image-block" key={title}>
                            <div className="dashboard-image-label">
                              <div>
                                <strong>{title}</strong>
                                <span>{caption}</span>
                              </div>
                              <span className="dashboard-image-file-name">
                                {imageName}
                              </span>
                            </div>
                            <div className="dashboard-image-frame">
                              <img
                                src={src}
                                alt={`${title} ${imageName}`}
                                loading="lazy"
                              />
                            </div>
                          </div>
                        ))}
                      </div>

                      <aside className="dashboard-verification">
                        <div className="dashboard-verification-heading">
                          <div>
                            <p className="dashboard-verification-kicker">REVIEW PANEL</p>
                            <h3 className="dashboard-verification-title">
                              Manual Verification
                            </h3>
                            <p className="dashboard-verification-subtitle">
                              Review the AI-generated annotations before accepting the
                              image.
                            </p>
                          </div>
                        </div>

                        <div className="dashboard-field">
                          <span className="dashboard-field-label">Image Name</span>
                          <div className="dashboard-field-value">{imageName}</div>
                        </div>

                        <div className="dashboard-field">
                          <span className="dashboard-field-label">Objects Detected</span>
                          <div className="dashboard-object-number-large">
                            {objectCount}
                          </div>
                        </div>

                        <div className="dashboard-field">
                          <div className="dashboard-confidence">
                            <span className="dashboard-field-label">
                              Confidence Score
                            </span>
                            <span className="dashboard-confidence-value">
                              {confidence}%
                            </span>
                          </div>
                          <div className="dashboard-progress">
                            <div
                              className="dashboard-progress-bar"
                              style={{ width: `${Math.min(confidence, 100)}%` }}
                            />
                          </div>
                        </div>

                        <div className="dashboard-objects">
                          <span className="dashboard-field-label">Detected Objects</span>
                          {boxes.length === 0 ? (
                            <div className="dashboard-no-objects">
                              No annotations detected.
                            </div>
                          ) : (
                            <div className="dashboard-object-grid">
                              {boxes.map((box, boxIndex) => (
                                <div
                                  className="dashboard-object-card"
                                  key={box.id ?? boxIndex}
                                >
                                  <div className="dashboard-object-class">
                                    {box.class_name || "Unknown"}
                                  </div>
                                  <div className="dashboard-object-number">
                                    {Math.round((Number(box.confidence) || 0) * 100)}%
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>

                        <div className="dashboard-verification-status">
                          <span className="dashboard-status-dot" />
                          <div>
                            <strong>Ready for manual verification</strong>
                            <span>Review the boxes and class labels.</span>
                          </div>
                        </div>

                        <div className="dashboard-verification-actions">
                          <button
                            type="button"
                            className="dashboard-button"
                            onClick={() => onVerifyImage?.(image)}
                          >
                            Verify Annotations
                          </button>
                          <button
                            type="button"
                            className="dashboard-button secondary"
                            onClick={() => onOpenImage?.(image)}
                          >
                            Edit Classes
                          </button>
                        </div>
                      </aside>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
