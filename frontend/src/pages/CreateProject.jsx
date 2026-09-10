import { useState } from "react";
import { createProject } from "../api";
import "./CreateProject.css";

// Simple form for making a new project. Normally rendered inside the Workspace
export default function CreateProject({ onBack, onCreated }) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  function clearMessages() {
    setError("");
  }

  async function handleSubmit(event) {
    event.preventDefault();

    if (!name.trim()) {
      setError("Please enter a project name.");
      return;
    }

    setError("");
    setLoading(true);
    try {
      const project = await createProject({
        name: name.trim(),
        description: description.trim(),
      });
      onCreated?.(project);
    } catch (err) {
      setError(err?.message || "Unable to create the project. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  function handleCancel() {
    if (loading) return;
    if (onBack) onBack();
    else window.location.hash = "#/dashboard";
  }

  return (
    <div className="create-project-page embedded">
      <main className="create-project-main">
        <div className="create-project-container">
          <button
            type="button"
            className="create-project-back"
            onClick={handleCancel}
            disabled={loading}
          >
            ← Back to Dashboard
          </button>

          <section className="create-project-card">
            <div className="create-project-card-header">
              <div className="create-project-eyebrow">PROJECT MANAGEMENT</div>
              <h1>Create New Project</h1>
              <p>
                A project keeps your images, annotations and generated YOLO labels
                together.
              </p>
            </div>

            {error && (
              <div className="create-project-message create-project-error" role="alert">
                {error}
              </div>
            )}

            <form className="create-project-form" onSubmit={handleSubmit}>
              <div className="create-project-field">
                <label htmlFor="project-name">Project Name</label>
                <input
                  id="project-name"
                  type="text"
                  value={name}
                  onChange={(e) => {
                    setName(e.target.value);
                    clearMessages();
                  }}
                  placeholder="e.g. Road vehicles"
                  disabled={loading}
                  autoFocus
                  required
                />
              </div>

              <div className="create-project-field">
                <label htmlFor="project-description">Description</label>
                <textarea
                  id="project-description"
                  value={description}
                  onChange={(e) => {
                    setDescription(e.target.value);
                    clearMessages();
                  }}
                  placeholder="What is this dataset for? (optional)"
                  rows={6}
                  disabled={loading}
                />
              </div>

              <div className="create-project-actions">
                <button
                  type="button"
                  className="create-project-cancel"
                  onClick={handleCancel}
                  disabled={loading}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="create-project-submit"
                  disabled={loading}
                >
                  {loading ? "Creating..." : "Create Project"}
                </button>
              </div>
            </form>
          </section>
        </div>
      </main>
    </div>
  );
}
