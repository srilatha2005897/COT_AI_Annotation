import { useState } from "react";
import { deleteProject } from "../api";
import "./Workspace.css";

/**
 * Shared application shell for every signed-in screen: a fixed sidebar with the
 * primary navigation and the project list, plus a content area for the page.
 * The project list is owned by App so it stays in sync across screens.
 */
export default function Workspace({
  user,
  projects = [],
  active = "dashboard",
  activeProjectId = null,
  title,
  actions = null,
  onLogout,
  children,
}) {
  const [open, setOpen] = useState(false);
  const [busyId, setBusyId] = useState(null);

  const isAdmin = user?.role === "admin";
  const isAnnotator = user?.role === "annotator";
  const canCreate = isAdmin || isAnnotator;
  const canDelete = isAdmin;
  const go = (hash) => {
    window.location.hash = hash;
    setOpen(false);
  };

  const removeProject = async (event, project) => {
    event.stopPropagation();
    if (
      !window.confirm(
        `Delete "${project.name}"?\n\nThis permanently removes the project, its images and annotations.`
      )
    ) {
      return;
    }
    setBusyId(project.id);
    try {
      await deleteProject(project.id);
      if (localStorage.getItem("annotateai_project_id") === String(project.id)) {
        localStorage.removeItem("annotateai_project_id");
      }
      // Leave the project view if we're on it, and refresh the shell.
      if (window.location.hash.includes(`/project/${project.id}`)) {
        window.location.hash = "#/dashboard";
      } else {
        window.dispatchEvent(new HashChangeEvent("hashchange"));
      }
    } catch (err) {
      window.alert(err?.message || "Could not delete the project.");
    } finally {
      setBusyId(null);
    }
  };

  const navItem = (id, label, hash, icon) => (
    <button
      type="button"
      className={`ws-nav-item ${active === id ? "is-active" : ""}`}
      onClick={() => go(hash)}
    >
      <span className="ws-nav-icon" aria-hidden="true">
        {icon}
      </span>
      {label}
    </button>
  );

  const roleLabel = ({ admin: "Admin", annotator: "Annotator", team_lead: "Team Lead", user: "User" }[user?.role] || user?.role || "User");

  const initials =
    (user?.name || user?.email || "U")
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((p) => p[0].toUpperCase())
      .join("") || "U";

  return (
    <div className="ws-shell">
      <button
        type="button"
        className="ws-menu-toggle"
        onClick={() => setOpen((v) => !v)}
        aria-label="Toggle navigation"
      >
        ☰
      </button>

      <aside className={`ws-sidebar ${open ? "is-open" : ""}`}>
        <button type="button" className="ws-brand" onClick={() => go("#/dashboard")}>
          <span className="ws-brand-mark" />
          <span>
            Annotate<span>AI</span>
          </span>
        </button>

        <nav className="ws-nav">
          {navItem("dashboard", "Dashboard", "#/dashboard", "▦")}
          {canCreate && navItem("new-project", "New project", "#/new-project", "＋")}
          {navItem("export", "Export YOLO", "#/export-yolo", "⇩")}
          {isAdmin && navItem("admin", "Admin", "#/admin", "⚙")}
        </nav>

        <div className="ws-projects">
          <div className="ws-projects-head">Projects</div>
          <div className="ws-project-list">
            {projects.length === 0 && (
              <p className="ws-projects-empty">No projects yet</p>
            )}
            {projects.map((project) => (
              <div
                key={project.id}
                className={`ws-project ${
                  String(project.id) === String(activeProjectId) ? "is-active" : ""
                } ${busyId === project.id ? "is-busy" : ""}`}
              >
                <button
                  type="button"
                  className="ws-project-open"
                  onClick={() => go(`#/dashboard/project/${project.id}`)}
                >
                  <span className="ws-project-dot" />
                  <span className="ws-project-name">{project.name}</span>
                  <span className="ws-project-count">{project.image_count ?? 0}</span>
                </button>
                {canDelete && <button
                  type="button"
                  className="ws-project-delete"
                  title="Delete project"
                  aria-label={`Delete ${project.name}`}
                  disabled={busyId === project.id}
                  onClick={(e) => removeProject(e, project)}
                >
                  ×
                </button>}
              </div>
            ))}
          </div>
        </div>

        <div className="ws-user">
          <span className="ws-avatar">{initials}</span>
          <span className="ws-user-copy">
            <strong>{user?.name || "User"}</strong>
            <small>{roleLabel}</small>
          </span>
          <button type="button" className="ws-logout" onClick={onLogout} title="Log out">
            ⏻
          </button>
        </div>
      </aside>

      {open && <div className="ws-scrim" onClick={() => setOpen(false)} />}

      <div className="ws-content">
        {(title || actions) && (
          <header className="ws-topbar">
            <h1>{title}</h1>
            {actions && <div className="ws-topbar-actions">{actions}</div>}
          </header>
        )}
        <main className="ws-main">{children}</main>
      </div>
    </div>
  );
}
