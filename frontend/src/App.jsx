import { useEffect, useState } from "react";

import DashboardPage from "./pages/Dashboard";
import { UploadPage } from "./pages/UploadPage";
import { ReviewPage, VerifyPage } from "./pages/ReviewPage";
import { ExportYoloPage } from "./pages/ExportPage";
import { LoginPage, RegisterPage } from "./pages/Auth";
import HomePage from "./pages/Home";
import { AdminDashboardPage } from "./pages/Admin";
import CreateProject from "./pages/CreateProject";
import ProjectOverview from "./pages/Project";
import Workspace from "./components/Workspace";

import { getDashboard, listProjects, logout } from "./api";

import "./index.css";

function parseRoute() {
  const hash = window.location.hash.replace(/^#/, "") || "/";
  const parts = hash.split("/").filter(Boolean);

  if (parts[0] === "dashboard" && parts[1] === "project") {
    return {
      page: "project",
      projectId: parts[2] || null,
      projectSection: parts[3] || "overview",
    };
  }

  switch (parts[0]) {
    case "dashboard":
      return { page: "dashboard" };
    case "new-project":
      return { page: "new-project" };
    case "review":
      return { page: "review", imageId: parts[1] || null };
    case "verify":
      return { page: "verify", imageId: parts[1] || null };
    case "export-yolo":
      return { page: "export-yolo" };
    case "admin":
      return { page: "admin" };
    case "register":
      return { page: "register" };
    case "login":
      return { page: "login" };
    default:
      return { page: "home" };
  }
}

function navigate(path) {
  const clean = path.startsWith("#") ? path.slice(1) : path;
  const nextHash = `#${clean}`;
  if (window.location.hash !== nextHash) {
    window.location.hash = nextHash;
  } else {
    window.dispatchEvent(new HashChangeEvent("hashchange"));
  }
}

export default function App() {
  const [route, setRoute] = useState(parseRoute);

  const [user, setUser] = useState(() => {
    try {
      const saved = localStorage.getItem("annotateai_user");
      return saved ? JSON.parse(saved) : null;
    } catch {
      return null;
    }
  });

  // Bumped on every navigation so data is re-fetched when the user returns to
  // a screen (e.g. the dashboard after uploading images).
  const [navTick, setNavTick] = useState(0);

  const [projects, setProjects] = useState([]);
  const [dashboardImages, setDashboardImages] = useState([]);
  const [dashboardStats, setDashboardStats] = useState(null);
  const [dashboardLoading, setDashboardLoading] = useState(false);
  const [dashboardError, setDashboardError] = useState("");

  useEffect(() => {
    function handleHashChange() {
      setRoute(parseRoute());
      setNavTick((tick) => tick + 1);
      window.scrollTo(0, 0);
    }
    window.addEventListener("hashchange", handleHashChange);
    return () => window.removeEventListener("hashchange", handleHashChange);
  }, []);

  // Project list — cheap, refreshed on every navigation.
  useEffect(() => {
    if (!user) {
      setProjects([]);
      return undefined;
    }
    let alive = true;
    listProjects()
      .then((list) => {
        if (alive) setProjects(Array.isArray(list) ? list : []);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [user, navTick]);

  // Dashboard images — heavier, only loaded while the dashboard is on screen.
  useEffect(() => {
    if (!user || route.page !== "dashboard") return undefined;

    let alive = true;
    setDashboardLoading(true);
    setDashboardError("");

    (async () => {
      try {
        // recent_images already includes each image's boxes, so this one call
        // is all the dashboard needs.
        const result = await getDashboard();
        if (!alive) return;
        setDashboardStats(result || null);
        setDashboardImages(
          Array.isArray(result?.recent_images) ? result.recent_images : []
        );
      } catch (error) {
        if (alive) {
          setDashboardError(error?.message || "Unable to load dashboard data.");
          setDashboardImages([]);
        }
      } finally {
        if (alive) setDashboardLoading(false);
      }
    })();

    return () => {
      alive = false;
    };
  }, [user, route.page, navTick]);

  function handleLogin(loggedInUser) {
    setUser(loggedInUser);
    localStorage.setItem("annotateai_user", JSON.stringify(loggedInUser));
    navigate("/dashboard");
  }

  function handleLogout() {
    logout();
    localStorage.removeItem("annotateai_user");
    localStorage.removeItem("annotateai_project_id");
    setUser(null);
    // Set the route too, so the render between "user is null" and the
    // hashchange firing doesn't briefly hit the "needs login" guard below.
    setRoute({ page: "home" });
    window.location.hash = "#/";
  }

  // api.js fires this when a request comes back 401 (expired / invalid session).
  useEffect(() => {
    function onSessionExpired() {
      setUser(null);
      navigate("/login");
    }
    window.addEventListener("annotateai:unauthorized", onSessionExpired);
    return () => window.removeEventListener("annotateai:unauthorized", onSessionExpired);
  }, []);

  // ---- Public routes ----

  if (route.page === "login") {
    return <LoginPage onSuccess={handleLogin} />;
  }

  if (route.page === "register") {
    return <RegisterPage onSuccess={handleLogin} />;
  }

  if (route.page === "home") {
    if (user) {
      navigate("/dashboard");
      return null;
    }
    return (
      <HomePage
        onLogin={() => navigate("/login")}
        onRegister={() => navigate("/register")}
      />
    );
  }

  // ---- Everything below requires a session ----

  if (!user) {
    navigate("/login");
    return null;
  }

  const shell = (content, opts = {}) => (
    <Workspace
      user={user}
      projects={projects}
      active={opts.active}
      activeProjectId={opts.activeProjectId}
      title={opts.title}
      actions={opts.actions}
      onLogout={handleLogout}
    >
      {content}
    </Workspace>
  );

  if (route.page === "new-project") {
    if (!["admin", "annotator"].includes(user.role)) {
      navigate("/dashboard");
      return null;
    }
    return shell(
      <CreateProject
        onBack={() => navigate("/dashboard")}
        onCreated={(project) => {
          const projectId = project?.id ?? project?.project_id;
          navigate(projectId ? `/dashboard/project/${projectId}` : "/dashboard");
        }}
      />,
      { active: "new-project", title: "New project" }
    );
  }

  if (route.page === "admin") {
    if (user.role !== "admin") {
      navigate("/dashboard");
      return null;
    }
    return shell(<AdminDashboardPage user={user} onLogout={handleLogout} />, {
      active: "admin",
      title: "Admin",
    });
  }

  if (route.page === "dashboard") {
    return shell(
      <DashboardPage
        projects={projects}
        images={dashboardImages}
        stats={dashboardStats}
        loading={dashboardLoading}
        error={dashboardError}
        onOpenImage={(image) => {
          const id = image?.id ?? image?.image_id;
          if (id) navigate(`/review/${id}`);
        }}
        onVerifyImage={(image) => {
          const id = image?.id ?? image?.image_id;
          if (id) navigate(`/verify/${id}`);
        }}
      />,
      {
        active: "dashboard",
        title: "Dashboard",
        actions: ["admin", "annotator"].includes(user.role) ? (
          <button
            type="button"
            className="ws-primary-btn"
            onClick={() => navigate("/new-project")}
          >
            + New project
          </button>
        ) : null,
      }
    );
  }

  if (route.page === "project") {
    if (!route.projectId) {
      navigate("/dashboard");
      return null;
    }

    if (route.projectSection === "upload") {
      if (!["admin", "annotator"].includes(user.role)) {
        navigate(`/dashboard/project/${route.projectId}`);
        return null;
      }
      return shell(
        <UploadPage
          projectId={route.projectId}
          onBack={() => navigate(`/dashboard/project/${route.projectId}`)}
        />,
        {
          active: "dashboard",
          activeProjectId: route.projectId,
          title: "Upload images",
        }
      );
    }

    return shell(
      <ProjectOverview
        projectId={route.projectId}
        canManage={["admin", "annotator"].includes(user.role)}
        section={route.projectSection}
        onOpenUpload={() => navigate(`/dashboard/project/${route.projectId}/upload`)}
        onOpenImage={(image) => {
          const id = image?.id ?? image?.image_id;
          if (id) navigate(`/review/${id}`);
        }}
      />,
      { active: "dashboard", activeProjectId: route.projectId }
    );
  }

  if (route.page === "export-yolo") {
    return shell(<ExportYoloPage />, {
      active: "export",
      title: "Export YOLO dataset",
    });
  }

  if (route.page === "verify" || route.page === "review") {
    if (!route.imageId) {
      navigate("/dashboard");
      return null;
    }
    const Page = route.page === "verify" ? VerifyPage : ReviewPage;
    return shell(
      <Page
        imageId={route.imageId}
        onBack={() => navigate("/dashboard")}
        readOnly={!['admin', 'annotator'].includes(user.role)}
      />,
      {
      active: "dashboard",
    });
  }

  navigate("/dashboard");
  return null;
}
