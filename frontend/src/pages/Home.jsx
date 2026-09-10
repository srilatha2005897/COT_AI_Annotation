import heroImage from "../assets/image.png";
import "./Home.css";

// Public landing page. Only ever shown to logged-out visitors — App redirects
// signed-in users straight to the dashboard.
export default function HomePage({ onLogin, onRegister }) {
  return (
    <div className="landing">
      <header className="landing-nav">
        <a className="landing-logo" href="#/">
          Annotate<span>AI</span>
        </a>
        <button type="button" className="btn-ghost" onClick={onLogin}>
          Sign in
        </button>
      </header>

      <main className="landing-main">
        <section className="landing-hero">
          <div className="landing-hero-copy">
            <span className="landing-eyebrow">AI-assisted image annotation</span>
            <h1>Label your image datasets faster</h1>
            <p className="landing-tagline">AI labels first, and humans do the rest.</p>
            <p className="landing-lead">
              AnnotateAI runs YOLOv8 over your images to draw the first pass of bounding
              boxes. You review and fix them, then export a training-ready YOLO dataset.
            </p>
            <div className="landing-hero-actions">
              <button type="button" className="btn-primary" onClick={onRegister}>
                Create an account
              </button>
              <span className="landing-signin-hint">
                Already have an account?{" "}
                <button type="button" className="link-button" onClick={onLogin}>
                  Sign in
                </button>
              </span>
            </div>
          </div>

          <div className="landing-hero-image">
            <img
              src={heroImage}
              alt="The annotation editor with detected objects boxed"
            />
          </div>
        </section>

        <section className="landing-steps">
          <h2>How it works</h2>
          <ol>
            <li>
              <span className="step-num">1</span>
              <div>
                <strong>Upload your images</strong>
                <p>
                  Create a project and add images one at a time, in bulk, or a whole
                  folder.
                </p>
              </div>
            </li>
            <li>
              <span className="step-num">2</span>
              <div>
                <strong>Let the AI detect objects</strong>
                <p>
                  YOLOv8 finds objects and draws boxes on every upload, with an adjustable
                  confidence threshold.
                </p>
              </div>
            </li>
            <li>
              <span className="step-num">3</span>
              <div>
                <strong>Review and export</strong>
                <p>
                  Fix the boxes on the canvas, then download the project as a YOLO dataset
                  (images, labels, <code>data.yaml</code>).
                </p>
              </div>
            </li>
          </ol>
        </section>
      </main>

      <footer className="landing-footer">
        <span>AnnotateAI</span>
        <span>AI labels first, and humans do the rest.</span>
      </footer>
    </div>
  );
}

export { HomePage };
