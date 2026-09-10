import { useEffect, useState } from "react";
import {
  deleteProject,
  getProjectDashboard,
  listImages,
  updateProject,
  saveProjectAnnotations,
} from "../api";
import { formatDate, timeAgo } from "../lib/dates";
import "./Project.css";

function Icon({ name, size = 20 }) {
  const common = {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.8,
    strokeLinecap: "round",
    strokeLinejoin: "round",
    "aria-hidden": true,
  };

  const paths = {
    folder: (
      <>
        <path d="M3 6.5A2.5 2.5 0 0 1 5.5 4H10l2 2h6.5A2.5 2.5 0 0 1 21 8.5v8A2.5 2.5 0 0 1 18.5 19h-13A2.5 2.5 0 0 1 3 16.5z" />
        <path d="M3 9h18" />
      </>
    ),

    image: (
      <>
        <rect x="3" y="4" width="18" height="16" rx="2" />
        <circle cx="8.5" cy="9" r="1.5" />
        <path d="m21 16-5-5-7 7" />
      </>
    ),

    box: (
      <>
        <path d="m12 3 8 4.5v9L12 21l-8-4.5v-9z" />
        <path d="m4 7.5 8 4.5 8-4.5M12 12v9" />
      </>
    ),

    pencil: (
      <>
        <path d="m4 20 4.5-1 10-10a2.1 2.1 0 0 0-3-3l-10 10z" />
        <path d="m14 7 3 3" />
      </>
    ),

    upload: (
      <>
        <path d="M12 16V4" />
        <path d="m7 9 5-5 5 5" />
        <path d="M4 14v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4" />
      </>
    ),

    more: (
      <>
        <circle
          cx="5"
          cy="12"
          r="1"
          fill="currentColor"
          stroke="none"
        />
        <circle
          cx="12"
          cy="12"
          r="1"
          fill="currentColor"
          stroke="none"
        />
        <circle
          cx="19"
          cy="12"
          r="1"
          fill="currentColor"
          stroke="none"
        />
      </>
    ),

    arrow: (
      <>
        <path d="M5 12h13" />
        <path d="m13 6 6 6-6 6" />
      </>
    ),

    save: (
      <>
        <path d="M5 4h12l2 2v14H5z" />
        <path d="M8 4v6h8V4M8 20v-5h8v5" />
      </>
    ),

    trash: (
      <>
        <path d="M4 7h16M10 11v6M14 11v6" />
        <path d="M6 7l1 13h10l1-13M9 7V4h6v3" />
      </>
    ),
  };

  return <svg {...common}>{paths[name] || paths.folder}</svg>;
}

export default function ProjectOverview({
  projectId = null,
  onOpenUpload,
  onOpenImage,
  section = "overview",
  readOnly = false,
  canManage = false,
}) {
  /*
   * ============================================================
   * ROLE / PERMISSION HANDLING
   * ============================================================
   *
   * USER:
   *   - View only
   *   - Cannot edit project
   *   - Cannot upload images
   *   - Cannot save annotations
   *   - Cannot delete project
   *   - Cannot access project settings
   *
   * ANNOTATOR:
   *   - Existing canManage permissions are preserved
   *
   * TEAM LEAD:
   *   - Can save annotations
   *
   * ADMIN:
   *   - Existing canManage permissions are preserved
   */

  const loggedInUser = JSON.parse(
    localStorage.getItem("user") || "null"
  );

  const userRole = String(
    loggedInUser?.role || ""
  ).toLowerCase();

  // Normal USER is always view-only
  const isUser = userRole === "user";

  // readOnly prop can also force view-only mode
  const isReadOnly = readOnly || isUser;

  // Management permission remains controlled by the parent.
  const effectiveCanManage =
    canManage && !isReadOnly;

  /*
   * TEAM LEAD is explicitly allowed to save annotations.
   * USER remains blocked because isUser makes the role read-only.
   */
  const canEdit =
    effectiveCanManage ||
    userRole === "team lead" ||
    userRole === "team_lead";

  const [dashboard, setDashboard] = useState(null);
  const [images, setImages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [sectionLoading, setSectionLoading] = useState(false);
  const [error, setError] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [saveMessage, setSaveMessage] = useState("");

  /*
   * ============================================================
   * STATISTICS LOCK
   * ============================================================
   *
   * Statistics remain locked until Save All Annotations
   * successfully completes.
   */
  const [statisticsUnlocked, setStatisticsUnlocked] =
    useState(false);

  const [activeTab, setActiveTab] = useState(
    (section || "overview").toLowerCase()
  );

  /*
   * ============================================================
   * HANDLE ACTIVE TAB
   * ============================================================
   */

  useEffect(() => {
    const next = (section || "overview").toLowerCase();

    // USER / read-only users cannot open settings
    if (!effectiveCanManage && next === "settings") {
      setActiveTab("overview");
      return;
    }

    // Do not allow Statistics to be opened directly
    // until annotations have been saved.
    if (next === "statistics" && !statisticsUnlocked) {
      setActiveTab("overview");
      return;
    }

    setActiveTab(next);
  }, [
    section,
    effectiveCanManage,
    statisticsUnlocked,
  ]);

  /*
   * ============================================================
   * LOAD PROJECT
   * ============================================================
   */

  const loadProject = async () => {
    if (!projectId) return;

    setLoading(true);
    setError("");

    try {
      const result = await getProjectDashboard(projectId);

      setDashboard(result || null);
      setName(result?.project?.name || "");
      setDescription(result?.project?.description || "");
    } catch (err) {
      setError(
        err?.message || "Unable to load project data."
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadProject();

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  /*
   * ============================================================
   * LOAD IMAGES / ANNOTATIONS
   * ============================================================
   */

  useEffect(() => {
    if (
      !projectId ||
      activeTab === "overview" ||
      activeTab === "settings" ||
      activeTab === "statistics"
    ) {
      return undefined;
    }

    let alive = true;

    setSectionLoading(true);

    listImages(projectId)
      .then((list) => {
        if (alive) {
          setImages(
            Array.isArray(list) ? list : []
          );
        }
      })
      .catch((err) => {
        if (alive) {
          setError(
            err?.message ||
              "Unable to load project images."
          );
        }
      })
      .finally(() => {
        if (alive) {
          setSectionLoading(false);
        }
      });

    return () => {
      alive = false;
    };
  }, [projectId, activeTab]);

  /*
   * ============================================================
   * PROJECT DATA
   * ============================================================
   */

  const project = dashboard?.project || {
    id: projectId,
    name: "Project",
    description: "",
  };

  const classCounts = Array.isArray(
    dashboard?.class_counts
  )
    ? dashboard.class_counts
    : [];

  const totalAnnotations = Number(
    dashboard?.total_objects || 0
  );

  const totalImages = Number(
    dashboard?.total_images || 0
  );

  const annotatedImages = Number(
    dashboard?.annotated_images || 0
  );

  const reviewedImages = Number(
    dashboard?.reviewed_images || 0
  );

  const pendingImages = Math.max(
    0,
    totalImages - annotatedImages
  );

  const recentImages = Array.isArray(
    dashboard?.recent_images
  )
    ? dashboard.recent_images.slice(0, 5)
    : [];

  /*
   * ============================================================
   * OPEN UPLOAD
   * ============================================================
   */

  const openUpload = () => {
    if (!canEdit) {
      setSaveMessage(
        "You have view-only access to this project."
      );
      return;
    }

    if (onOpenUpload) {
      onOpenUpload(projectId);
    } else {
      window.location.hash =
        `#/dashboard/project/${projectId}/upload`;
    }
  };

  /*
   * ============================================================
   * HANDLE TAB
   * ============================================================
   */

  const handleTab = (tab) => {
    const value = tab.toLowerCase();

    // USER cannot open settings
    if (
      value === "settings" &&
      !effectiveCanManage
    ) {
      return;
    }

    /*
     * ==========================================================
     * STATISTICS LOCK
     * ==========================================================
     */
    if (
      value === "statistics" &&
      !statisticsUnlocked
    ) {
      setSaveMessage(
        "Please click 'Save All Annotations' before viewing statistics."
      );
      return;
    }

    setSaveMessage("");

    setActiveTab(value);

    window.location.hash =
      value === "overview"
        ? `#/dashboard/project/${projectId}`
        : `#/dashboard/project/${projectId}/${value}`;
  };

  /*
   * ============================================================
   * OPEN IMAGE
   * ============================================================
   *
   * USER can open images.
   * The image-review component should separately enforce
   * read-only annotation controls for USER.
   */

  const openImage = (image) => {
    const id =
      image?.id ?? image?.image_id;

    if (!id) return;

    if (onOpenImage) {
      onOpenImage(image);
    } else {
      window.location.hash = `#/review/${id}`;
    }
  };

  /*
   * ============================================================
   * SAVE PROJECT
   * ============================================================
   */

  const saveProject = async () => {
    if (!canEdit) {
      setSaveMessage(
        "You have view-only access to this project."
      );
      return;
    }

    setSaveMessage("");

    try {
      const updated = await updateProject(
        projectId,
        {
          name,
          description,
        }
      );

      setDashboard((old) => ({
        ...old,
        project: {
          ...old?.project,
          ...updated,
        },
      }));

      setSaveMessage(
        "Project changes saved successfully."
      );
    } catch (err) {
      setSaveMessage(
        err?.message ||
          "Unable to save project changes."
      );
    }
  };

  /*
   * ============================================================
   * SAVE ALL ANNOTATIONS
   * ============================================================
   *
   * IMPORTANT:
   * Statistics are unlocked ONLY after the API call
   * succeeds successfully.
   *
   * Admin + Team Lead can use this button.
   */

  const saveAnnotations = async () => {
    if (!canEdit) {
      setSaveMessage(
        "You have view-only access to this project."
      );
      return false;
    }

    setSaveMessage("");

    try {
      const result =
        await saveProjectAnnotations(projectId);

      /*
       * Unlock Statistics only after successful save.
       */
      setStatisticsUnlocked(true);

      setSaveMessage(
        result?.message ||
          "All annotations saved successfully. Statistics are now available."
      );

      /*
       * Refresh project data after saving.
       */
      await loadProject();

      return true;
    } catch (err) {
      /*
       * Keep Statistics locked when saving fails.
       */
      setStatisticsUnlocked(false);

      setSaveMessage(
        err?.message ||
          "Unable to save all annotations. Statistics are still locked."
      );

      return false;
    }
  };

  /*
   * ============================================================
   * DELETE PROJECT
   * ============================================================
   */

  const handleDelete = async () => {
    if (!canEdit) {
      setSaveMessage(
        "You have view-only access to this project."
      );
      return;
    }

    if (
      !window.confirm(
        `Delete project "${project.name}"? This will delete its images and annotations.`
      )
    ) {
      return;
    }

    try {
      await deleteProject(projectId);

      localStorage.removeItem(
        "annotateai_project_id"
      );

      window.location.hash = "#/dashboard";
    } catch (err) {
      setSaveMessage(
        err?.message ||
          "Unable to delete project."
      );
    }
  };

  /*
   * ============================================================
   * LOADING
   * ============================================================
   */

  if (loading) {
    return (
      <div className="project-shell embedded">
        <div className="project-loading">
          <div className="project-spinner" />

          <span>
            Loading project...
          </span>
        </div>
      </div>
    );
  }

  /*
   * ============================================================
   * MAIN UI
   * ============================================================
   */

  return (
    <div className="project-shell embedded">
      <main className="project-main">

        {/* ======================================================
            PROJECT HEADER
        ====================================================== */}

        <header className="project-main-header">

          <div className="project-title-block">

            <div className="title-line">

              <h2>
                {project.name ||
                  "Untitled Project"}
              </h2>

              {/* USER DOES NOT SEE EDIT BUTTON */}
              {effectiveCanManage && (
                <button
                  className="icon-button"
                  title="Project settings"
                  onClick={() =>
                    handleTab("Settings")
                  }
                >
                  <Icon
                    name="pencil"
                    size={17}
                  />
                </button>
              )}

            </div>

            <p>
              Created on{" "}
              {formatDate(
                project.created_at
              )}{" "}
              <span>•</span>{" "}
              Updated{" "}
              {timeAgo(
                project.updated_at ||
                  project.created_at
              )}
            </p>

          </div>

          {/* ==================================================
              USER DOES NOT SEE UPLOAD / MORE OPTIONS
          ================================================== */}

          {effectiveCanManage && (
            <div className="main-header-actions">

              <button
                className="upload-button"
                onClick={openUpload}
              >
                <Icon
                  name="upload"
                  size={17}
                />

                Upload Images
              </button>

              <button
                className="header-more"
                title="Project options"
                onClick={() =>
                  handleTab("Settings")
                }
              >
                <Icon
                  name="more"
                  size={20}
                />
              </button>

            </div>
          )}

        </header>

        {/* ======================================================
            PROJECT TABS
        ====================================================== */}

        <nav
          className="project-tabs"
          aria-label="Project sections"
        >
          {[
            "Overview",
            "Images",
            "Annotations",
            "Statistics",
            ...(effectiveCanManage
              ? ["Settings"]
              : []),
          ].map((tab) => {
            const isStatistics =
              tab.toLowerCase() ===
              "statistics";

            return (
              <button
                key={tab}
                type="button"
                className={
                  activeTab ===
                  tab.toLowerCase()
                    ? "active"
                    : ""
                }
                disabled={
                  isStatistics &&
                  !statisticsUnlocked
                }
                title={
                  isStatistics &&
                  !statisticsUnlocked
                    ? "Save all annotations before viewing statistics"
                    : tab
                }
                onClick={() =>
                  handleTab(tab)
                }
              >
                {tab}

                {isStatistics &&
                  !statisticsUnlocked && (
                    <span className="statistics-lock-icon">
                      🔒
                    </span>
                  )}
              </button>
            );
          })}
        </nav>

        {/* ======================================================
            ERROR
        ====================================================== */}

        {error && (
          <div className="project-error">
            {error}
          </div>
        )}

        {/* ======================================================
            OVERVIEW
        ====================================================== */}

        {activeTab === "overview" && (
          <section className="project-content">

            <div className="project-info-card">

              <div>

                <span className="card-label">
                  Project Information
                </span>

                <p>
                  {project.description ||
                    "Dataset for detecting and annotating objects in different environments and conditions."}
                </p>

              </div>

              {/* USER DOES NOT SEE VIEW DETAILS / SETTINGS */}
              {effectiveCanManage && (
                <button
                  className="details-button"
                  onClick={() =>
                    handleTab("Settings")
                  }
                >
                  View Details{" "}
                  <Icon
                    name="arrow"
                    size={16}
                  />
                </button>
              )}

            </div>

            {/* ==================================================
                STATISTICS SUMMARY
            ================================================== */}

            <div className="stat-grid">

              <div className="project-stat-card stat-images">

                <span className="stat-icon">
                  <Icon
                    name="image"
                    size={18}
                  />
                </span>

                <strong>
                  {totalImages}
                </strong>

                <span>
                  Total Images
                </span>

                <small>
                  Live from backend
                </small>

              </div>

              <div className="project-stat-card stat-classes">

                <span className="stat-icon">
                  <Icon
                    name="box"
                    size={18}
                  />
                </span>

                <strong>
                  {classCounts.length}
                </strong>

                <span>
                  Classes
                </span>

                <small>
                  {totalAnnotations} annotations
                </small>

              </div>

              <div className="project-stat-card stat-annotations">

                <span className="stat-icon">
                  <Icon
                    name="pencil"
                    size={18}
                  />
                </span>

                <strong>
                  {totalAnnotations.toLocaleString()}
                </strong>

                <span>
                  Annotations
                </span>

                <small>
                  AI + human labels
                </small>

              </div>

            </div>

            {/* ==================================================
                OVERVIEW GRID
            ================================================== */}

            <div className="overview-grid">

              {/* CLASS BREAKDOWN */}

              <section className="class-card">

                <div className="section-title-row">

                  <div>

                    <h3>
                      Class Breakdown
                    </h3>

                    <p>
                      Objects detected in
                      this project
                    </p>

                  </div>

                  <button
                    onClick={() =>
                      handleTab(
                        "Statistics"
                      )
                    }
                  >
                    <Icon
                      name="arrow"
                      size={16}
                    />
                  </button>

                </div>

                {classCounts.length ===
                0 ? (
                  <div className="empty-mini">
                    No annotations yet.
                    Upload images to
                    populate classes.
                  </div>
                ) : (
                  <div className="class-list">

                    {classCounts
                      .slice(0, 6)
                      .map(
                        (
                          item,
                          index
                        ) => {

                          const count =
                            Number(
                              item.count ||
                                0
                            );

                          const percentage =
                            totalAnnotations
                              ? Math.round(
                                  (count /
                                    totalAnnotations) *
                                    100
                                )
                              : 0;

                          return (
                            <div
                              className="class-row"
                              key={
                                item.class_name ||
                                index
                              }
                            >

                              <span
                                className={`class-dot dot-${
                                  index % 6
                                }`}
                              />

                              <span className="class-name">
                                {item.class_name ||
                                  "Unknown"}
                              </span>

                              <span className="class-bar">
                                <i
                                  style={{
                                    width: `${percentage}%`,
                                  }}
                                />
                              </span>

                              <span className="class-percent">
                                {percentage}%
                              </span>

                              <strong>
                                {count}
                              </strong>

                            </div>
                          );
                        }
                      )}

                  </div>
                )}

              </section>

              {/* RECENT IMAGES */}

              <section className="recent-card">

                <div className="section-title-row">

                  <div>

                    <h3>
                      Recent Images
                    </h3>

                    <p>
                      Latest images added
                      to the dataset
                    </p>

                  </div>

                  <button
                    onClick={() =>
                      handleTab("Images")
                    }
                  >
                    View All Images{" "}
                    <Icon
                      name="arrow"
                      size={15}
                    />
                  </button>

                </div>

                {recentImages.length ===
                0 ? (
                  <div className="empty-mini recent-empty">

                    {effectiveCanManage ? (
                      <>
                        No images yet.
                        Use{" "}
                        <button
                          onClick={
                            openUpload
                          }
                        >
                          Upload Images
                        </button>{" "}
                        to start.
                      </>
                    ) : (
                      "No images are available in this project."
                    )}

                  </div>
                ) : (
                  <div className="recent-images">

                    {recentImages.map(
                      (
                        image,
                        index
                      ) => {

                        const imageId =
                          image.id ??
                          image.image_id;

                        const src =
                          imageId
                            ? `/api/files/original/${encodeURIComponent(
                                imageId
                              )}`
                            : null;

                        return (
                          <button
                            key={
                              imageId ??
                              index
                            }
                            className="recent-image-card"
                            onClick={() =>
                              openImage(
                                image
                              )
                            }
                          >

                            <div className="thumb-wrap">

                              {src ? (
                                <img
                                  src={src}
                                  alt={
                                    image.filename ||
                                    `Image ${
                                      index +
                                      1
                                    }`
                                  }
                                />
                              ) : (
                                <div className="thumb-fallback">
                                  <Icon
                                    name="image"
                                    size={22}
                                  />
                                </div>
                              )}

                              <span className="image-object-count">
                                {Number(
                                  image.total_objects ||
                                    0
                                )}{" "}
                                obj
                              </span>

                            </div>

                            <strong>
                              {image.filename ||
                                `img_${String(
                                  index + 1
                                ).padStart(
                                  3,
                                  "0"
                                )}.jpg`}
                            </strong>

                            <small>
                              {timeAgo(
                                image.created_at
                              )}
                            </small>

                          </button>
                        );
                      }
                    )}

                  </div>
                )}

              </section>

            </div>

          </section>
        )}

        {/* ======================================================
            IMAGES
        ====================================================== */}

        {activeTab === "images" && (
          <section className="project-content section-page">

            <div className="page-heading">

              <div>

                <h3>
                  Project Images
                </h3>

                <p>
                  All images currently
                  stored in this project.
                </p>

              </div>

              <span className="count-pill">
                {images.length} images
              </span>

            </div>

            {sectionLoading ? (
              <div className="section-loading">
                Loading images...
              </div>
            ) : images.length === 0 ? (
              <div className="large-empty">

                {effectiveCanManage ? (
                  <>
                    No images in this
                    project. Click{" "}
                    <button
                      onClick={
                        openUpload
                      }
                    >
                      Upload Images
                    </button>{" "}
                    to add images.
                  </>
                ) : (
                  "No images are available in this project."
                )}

              </div>
            ) : (
              <div className="image-grid">

                {images.map(
                  (
                    image,
                    index
                  ) => {

                    const id =
                      image.id ??
                      image.image_id;

                    return (
                      <button
                        className="image-tile"
                        key={
                          id ?? index
                        }
                        onClick={() =>
                          openImage(
                            image
                          )
                        }
                      >

                        <div className="image-tile-thumb">

                          <img
                            src={`/api/files/original/${encodeURIComponent(
                              id
                            )}`}
                            alt={
                              image.filename
                            }
                          />

                          <span>
                            {Number(
                              image.total_objects ||
                                0
                            )}{" "}
                            annotations
                          </span>

                        </div>

                        <strong>
                          {image.filename}
                        </strong>

                        <small>
                          {image.status} ·{" "}
                          {timeAgo(
                            image.created_at
                          )}
                        </small>

                      </button>
                    );
                  }
                )}

              </div>
            )}

          </section>
        )}

        {/* ======================================================
            ANNOTATIONS
        ====================================================== */}

        {activeTab === "annotations" && (
          <section className="project-content section-page">

            <div className="page-heading">

              <div>

                <h3>
                  Project Annotations
                </h3>

                <p>
                  Annotations and detected
                  objects saved for every
                  project image.
                </p>

              </div>

              <span className="count-pill">
                {totalAnnotations} objects
              </span>

            </div>

            {sectionLoading ? (
              <div className="section-loading">
                Loading annotations...
              </div>
            ) : images.length === 0 ? (
              <div className="large-empty">
                No annotations have been
                saved in this project yet.
              </div>
            ) : (
              <div className="annotation-list">

                {images.map(
                  (
                    image,
                    index
                  ) => {

                    const anns =
                      Array.isArray(
                        image.detections
                      )
                        ? image.detections
                        : [];

                    return (
                      <div
                        className="annotation-card"
                        key={
                          image.id ??
                          index
                        }
                      >

                        <button
                          className="annotation-image"
                          onClick={() =>
                            openImage(
                              image
                            )
                          }
                        >

                          <img
                            src={`/api/files/original/${encodeURIComponent(
                              image.id
                            )}`}
                            alt={
                              image.filename
                            }
                          />

                        </button>

                        <div className="annotation-main">

                          <div className="annotation-header">

                            <div>

                              <h4>
                                {image.filename}
                              </h4>

                              <small>
                                {anns.length}{" "}
                                annotation
                                {anns.length ===
                                1
                                  ? ""
                                  : "s"}{" "}
                                ·{" "}
                                {image.status}
                              </small>

                            </div>

                            <button
                              className="text-button"
                              onClick={() =>
                                openImage(
                                  image
                                )
                              }
                            >
                              Open image{" "}
                              <Icon
                                name="arrow"
                                size={14}
                              />
                            </button>

                          </div>

                          {anns.length ===
                          0 ? (
                            <p className="annotation-empty">
                              No active
                              annotations.
                            </p>
                          ) : (
                            <div className="annotation-tags">

                              {anns.map(
                                (
                                  ann,
                                  i
                                ) => (
                                  <span
                                    className="annotation-tag"
                                    key={
                                      ann.id ??
                                      i
                                    }
                                  >

                                    <b>
                                      {
                                        ann.class_name
                                      }
                                    </b>

                                    <small>
                                      {ann.source ||
                                        "ai"}{" "}
                                      ·{" "}
                                      {Math.round(
                                        Number(
                                          ann.confidence ||
                                            0
                                        ) * 100
                                      )}
                                      %
                                    </small>

                                  </span>
                                )
                              )}

                            </div>
                          )}

                        </div>

                      </div>
                    );
                  }
                )}

              </div>
            )}

            {/* ==================================================
                SAVE ALL ANNOTATIONS
            ================================================== */}

            {canEdit && (
              <div className="save-all-annotations-container">

                <div className="save-all-annotations-info">

                  <strong>
                    Ready to calculate statistics?
                  </strong>

                  <span>
                    Save all project annotations first.
                    Statistics will become available after
                    the save is completed successfully.
                  </span>

                </div>

                <button
                  type="button"
                  className="save-all-annotations-button"
                  onClick={saveAnnotations}
                >
                  <Icon
                    name="save"
                    size={18}
                  />

                  Save All Annotations
                </button>

              </div>
            )}

            {saveMessage && (
              <div className="save-message">
                {saveMessage}
              </div>
            )}

          </section>
        )}

        {/* ======================================================
            STATISTICS
        ====================================================== */}

        {activeTab === "statistics" &&
          statisticsUnlocked && (
            <section className="project-content section-page">

              <div className="page-heading">

                <div>

                  <h3>
                    Project Statistics
                  </h3>

                  <p>
                    Annotation progress and
                    class distribution for
                    this project.
                  </p>

                </div>

              </div>

              <div className="statistics-grid">

                {/* IMAGE PROGRESS */}

                <div className="chart-card">

                  <h3>
                    Image Annotation
                    Progress
                  </h3>

                  <p>
                    {annotatedImages} of{" "}
                    {totalImages} images
                    have annotations.
                  </p>

                  <div className="progress-chart">

                    <div className="chart-bar-group">

                      <div className="chart-value">
                        {totalImages}
                      </div>

                      <div
                        className="chart-bar total"
                        style={{
                          height: `${Math.max(
                            8,
                            totalImages
                              ? 180
                              : 8
                          )}px`,
                        }}
                      />

                      <span>
                        Total Images
                      </span>

                    </div>

                    <div className="chart-bar-group">

                      <div className="chart-value">
                        {annotatedImages}
                      </div>

                      <div
                        className="chart-bar annotated"
                        style={{
                          height: `${Math.max(
                            8,
                            totalImages
                              ? (annotatedImages /
                                  totalImages) *
                                  180
                              : 8
                          )}px`,
                        }}
                      />

                      <span>
                        Annotated
                      </span>

                    </div>

                    <div className="chart-bar-group">

                      <div className="chart-value">
                        {pendingImages}
                      </div>

                      <div
                        className="chart-bar pending"
                        style={{
                          height: `${Math.max(
                            8,
                            totalImages
                              ? (pendingImages /
                                  totalImages) *
                                  180
                              : 8
                          )}px`,
                        }}
                      />

                      <span>
                        Pending
                      </span>

                    </div>

                  </div>

                  <div className="progress-summary">

                    <strong>
                      {totalImages
                        ? Math.round(
                            (annotatedImages /
                              totalImages) *
                              100
                          )
                        : 0}
                      %
                    </strong>

                    <span>
                      annotation completion
                    </span>

                    <span>
                      {reviewedImages} reviewed
                      images
                    </span>

                  </div>

                </div>

                {/* OBJECTS BY CLASS */}

                <div className="chart-card">

                  <h3>
                    Objects by Class
                  </h3>

                  <p>
                    Total annotations:{" "}
                    {totalAnnotations}
                  </p>

                  <div className="statistics-class-list">

                    {classCounts.length ===
                    0 ? (
                      <div className="empty-mini">
                        No class data
                        available.
                      </div>
                    ) : (
                      classCounts.map(
                        (
                          item,
                          index
                        ) => {

                          const count =
                            Number(
                              item.count ||
                                0
                            );

                          const pct =
                            totalAnnotations
                              ? Math.round(
                                  (count /
                                    totalAnnotations) *
                                    100
                                )
                              : 0;

                          return (
                            <div
                              className="statistics-class-row"
                              key={
                                item.class_name
                              }
                            >

                              <div>

                                <span
                                  className={`class-dot dot-${
                                    index % 6
                                  }`}
                                />

                                <b>
                                  {
                                    item.class_name
                                  }
                                </b>

                                <small>
                                  {count}
                                </small>

                              </div>

                              <div className="statistics-track">

                                <i
                                  style={{
                                    width: `${pct}%`,
                                  }}
                                />

                              </div>

                              <strong>
                                {pct}%
                              </strong>

                            </div>
                          );
                        }
                      )
                    )}

                  </div>

                </div>

              </div>

            </section>
          )}

        {/* ======================================================
            SETTINGS
            ONLY ANNOTATOR / TEAM LEAD / ADMIN
        ====================================================== */}

        {activeTab === "settings" &&
          effectiveCanManage && (
            <section className="project-content section-page">

              <div className="page-heading">

                <div>

                  <h3>
                    Project Settings
                  </h3>

                  <p>
                    Edit the project
                    information, save
                    annotation data, or
                    delete the project.
                  </p>

                </div>

              </div>

              {saveMessage && (
                <div className="save-message">
                  {saveMessage}
                </div>
              )}

              {/* PROJECT INFORMATION */}

              <div className="settings-card">

                <h3>
                  Project Information
                </h3>

                <label>

                  Project Name

                  <input
                    value={name}
                    onChange={(e) =>
                      canEdit &&
                      setName(
                        e.target.value
                      )
                    }
                    readOnly={!canEdit}
                    maxLength={200}
                  />

                </label>

                <label>

                  Description

                  <textarea
                    value={description}
                    onChange={(e) =>
                      canEdit &&
                      setDescription(
                        e.target.value
                      )
                    }
                    readOnly={!canEdit}
                    rows={5}
                    maxLength={2000}
                  />

                </label>

                <div className="settings-actions">

                  {canEdit && (
                    <button
                      className="primary-action"
                      onClick={
                        saveProject
                      }
                    >
                      <Icon
                        name="save"
                        size={16}
                      />

                      Save Project
                      Changes
                    </button>
                  )}

                </div>

              </div>

              {/* ANNOTATIONS */}

              <div className="settings-card">

                <h3>
                  Annotations
                </h3>

                <p className="settings-help">
                  Annotations are stored
                  in the database when
                  you save them from the
                  image review screen.
                  Use this button to
                  regenerate the
                  project's YOLO
                  annotation files from
                  the saved annotation
                  data.
                </p>

                {canEdit && (
                  <button
                    className="secondary-action"
                    onClick={
                      saveAnnotations
                    }
                  >
                    <Icon
                      name="save"
                      size={16}
                    />

                    Save Annotations
                  </button>
                )}

              </div>

              {/* DELETE PROJECT */}

              <div className="settings-card danger-card">

                <h3>
                  Delete Project
                </h3>

                <p>
                  This permanently
                  deletes the project,
                  its images, and its
                  annotation records.
                </p>

                {canEdit && (
                  <button
                    className="danger-action"
                    onClick={
                      handleDelete
                    }
                  >
                    <Icon
                      name="trash"
                      size={16}
                    />

                    Delete Project
                  </button>
                )}

              </div>

            </section>
          )}

      </main>
    </div>
  );
}