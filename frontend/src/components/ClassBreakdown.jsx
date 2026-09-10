import "../styles/shared.css";

// Small "Detected classes" panel shown above the annotation editor.
// `counts` is a list of { class_name, count } (see getClassCounts in ReviewPage).
export default function ClassBreakdown({ counts = [], total = 0 }) {
  return (
    <section className="dashboard-section">
      <div className="section-heading">
        <div>
          <span className="section-eyebrow">ANALYTICS</span>
          <h2>Detected classes</h2>
          <p>Objects detected in this image.</p>
        </div>

        <div className="section-total">
          <strong>{total}</strong>
          <span>objects</span>
        </div>
      </div>

      {!counts.length ? (
        <div className="empty-state">
          <div className="empty-icon">◎</div>
          <h3>No objects detected yet</h3>
          <p>Upload an image to start AI-powered object detection.</p>
        </div>
      ) : (
        <div className="class-grid">
          {counts.map((item, index) => (
            <div className="class-card" key={`${item.class_name}-${index}`}>
              <div className="class-card-icon">
                {item.class_name.charAt(0).toUpperCase()}
              </div>
              <div className="class-card-info">
                <span>{item.class_name}</span>
                <strong>{item.count}</strong>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
