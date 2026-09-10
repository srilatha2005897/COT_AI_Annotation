// Thin wrapper around fetch for talking to the FastAPI backend.
// Every call goes through request()/requestFile() so auth and error
// handling live in one place.

const API = "/api";

function getToken() {
  try {
    const saved = localStorage.getItem("annotateai_user");
    return saved ? JSON.parse(saved)?.access_token || null : null;
  } catch {
    return null;
  }
}

function authHeaders() {
  const token = getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

// Pull a readable message out of an error response.
async function errorMessage(response) {
  const fallback = response.statusText || `Request failed (${response.status})`;
  try {
    const data = await response.json();
    if (typeof data?.detail === "string") return data.detail;
    // FastAPI validation errors come back as a list of {msg, loc, ...}
    if (Array.isArray(data?.detail)) {
      return data.detail.map((item) => item?.msg || String(item)).join(", ");
    }
    return data?.message || fallback;
  } catch {
    return fallback;
  }
}

// Called when a request comes back 401. For the login/register calls a 401 just
// means "wrong credentials" and the form handles it, so skip those.
function onUnauthorized(path) {
  if (path.startsWith("/auth/")) return;
  localStorage.removeItem("annotateai_user");
  localStorage.removeItem("annotateai_project_id");
  // Let App reset its user state and send the person to the login page.
  window.dispatchEvent(new Event("annotateai:unauthorized"));
}

// Does the fetch and throws a readable Error on anything that isn't a 2xx.
async function send(path, options) {
  let response;
  try {
    response = await fetch(`${API}${path}`, {
      ...options,
      credentials: "include",
      headers: { ...authHeaders(), ...(options.headers || {}) },
    });
  } catch (err) {
    // fetch only rejects on network problems, not on 4xx/5xx.
    console.error("API error:", err);
    throw new Error("Cannot reach the backend. Is it running on port 8000?");
  }

  if (!response.ok) {
    if (response.status === 401) onUnauthorized(path);
    throw new Error(await errorMessage(response));
  }
  return response;
}

async function request(path, options = {}) {
  const response = await send(path, options);
  if (response.status === 204) return null;

  const contentType = response.headers.get("content-type") || "";
  return contentType.includes("application/json") ? response.json() : response.text();
}

// Same as request() but returns the raw blob + filename (used for downloads).
async function requestFile(path, options = {}) {
  const response = await send(path, options);
  const disposition = response.headers.get("content-disposition") || "";
  const match = disposition.match(/filename="?([^"]+)"?/i);
  return { blob: await response.blob(), filename: match?.[1] || "download.zip" };
}

function json(method, body) {
  return {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}

function requireId(value, label) {
  if (value === null || value === undefined || value === "") {
    throw new Error(`${label} is required.`);
  }
  return encodeURIComponent(value);
}

// --- Auth ---

export const register = (data) => request("/auth/register", json("POST", data));
export const login = (data) => request("/auth/login", json("POST", data));
export const logout = () => request("/auth/logout", { method: "POST" }).catch(() => null);
export const resetPassword = (data) => request("/auth/reset-password", json("POST", data));

// --- Admin ---

export const getAdminDashboard = () => request("/admin/dashboard");

// --- Projects ---

export const createProject = (data) => request("/projects", json("POST", data));
export const listProjects = () => request("/projects");

export function updateProject(projectId, data) {
  const id = requireId(projectId, "Project ID");
  return request(
    `/projects/${id}`,
    json("PUT", {
      name: String(data?.name || "").trim(),
      description: data?.description ?? "",
    })
  );
}

export function deleteProject(projectId) {
  const id = requireId(projectId, "Project ID");
  return request(`/projects/${id}`, { method: "DELETE" });
}

export function saveProjectAnnotations(projectId) {
  const id = requireId(projectId, "Project ID");
  return request(`/projects/${id}/save-annotations`, { method: "POST" });
}

// --- Dashboards ---

export const getDashboard = () => request("/dashboard");

export function getProjectDashboard(projectId) {
  const id = requireId(projectId, "Project ID");
  return request(`/project-dashboard/${id}`);
}

// --- Detection ---

function detectForm(projectId, confidence) {
  const form = new FormData();
  if (projectId !== null && projectId !== undefined && projectId !== "") {
    form.append("project_id", String(projectId));
  }
  if (confidence !== null && confidence !== undefined) {
    form.append("confidence_threshold", String(confidence));
  }
  return form;
}

export function detectImage(file, projectId = null, confidence = null) {
  if (!file) throw new Error("Image file is required.");
  const form = detectForm(projectId, confidence);
  form.append("file", file);
  return request("/detect", { method: "POST", body: form });
}

export function detectBatch(files, projectId = null, confidence = null) {
  if (!Array.isArray(files) || !files.length) {
    throw new Error("At least one image file is required.");
  }
  const form = detectForm(projectId, confidence);
  files.forEach((file) => form.append("files", file));
  return request("/detect/batch", { method: "POST", body: form });
}

// How many images go in one request. Detection is slow, so a whole folder in a
// single POST would sit there long enough for a proxy to time it out. Sending
// it in chunks means there's no ceiling on how many images you can add at once.
export const UPLOAD_CHUNK_SIZE = 20;

export async function detectBatchChunked(
  files,
  projectId = null,
  confidence = null,
  { chunkSize = UPLOAD_CHUNK_SIZE, onProgress } = {}
) {
  const all = Array.from(files || []);
  if (!all.length) throw new Error("At least one image file is required.");

  const results = [];
  const skipped = [];
  let done = 0;

  for (let start = 0; start < all.length; start += chunkSize) {
    const chunk = all.slice(start, start + chunkSize);
    try {
      const data = await detectBatch(chunk, projectId, confidence);
      results.push(...(data?.results || []));
      skipped.push(...(data?.skipped || []));
    } catch (err) {
      // One bad chunk shouldn't throw away the rest of the folder. Record it
      // and carry on, so the person keeps the images that did work.
      chunk.forEach((file) =>
        skipped.push({ filename: file.name, reason: err.message || "upload failed" })
      );
    }
    done += chunk.length;
    onProgress?.({ done, total: all.length });
  }

  return { results, skipped };
}

// --- Images & annotations ---

export function listImages(projectId = null) {
  if (projectId === null || projectId === undefined || projectId === "") {
    return request("/images");
  }
  return request(`/images?project_id=${encodeURIComponent(projectId)}`);
}

export function getImage(imageId) {
  const id = requireId(imageId, "Image ID");
  return request(`/images/${id}`);
}

export function saveAnnotations(imageId, annotations) {
  const id = requireId(imageId, "Image ID");
  return request(
    `/images/${id}/annotations`,
    json("PUT", { annotations: Array.isArray(annotations) ? annotations : [] })
  );
}

// --- Dataset export ---

export const EXPORT_FORMATS = [
  // `primary` decides what the export page shows without being asked. The rest
  // sit behind "More formats" - they matter when another tool demands them, not
  // day to day.
  {
    id: "simple",
    short: "Simple",
    label: "Simple (images + JSON)",
    note: "Done and not-done images in separate folders, one JSON of pixel coordinates. Not for training.",
    splitless: true,
    primary: true,
  },
  {
    id: "yolo",
    short: "YOLO",
    label: "YOLO (Ultralytics)",
    note: "images/ + labels/ + data.yaml — train straight away with `yolo detect train`",
    primary: true,
  },
  {
    id: "coco",
    short: "COCO",
    label: "COCO JSON",
    note: "instances_train.json / instances_val.json — Detectron2, MMDetection, torchvision",
  },
  {
    id: "voc",
    short: "Pascal VOC",
    label: "Pascal VOC",
    note: "one XML per image, plus ImageSets/Main — older detectors and labelImg",
  },
  {
    id: "csv",
    short: "CSV",
    label: "CSV",
    note: "one row per box — open in a spreadsheet or read with pandas",
  },
];

export function exportDataset(projectId, options = {}) {
  const id = requireId(projectId, "Project ID");
  const params = new URLSearchParams({ project_id: id });
  if (options.format) params.set("format", options.format);
  if (options.valRatio !== undefined) params.set("val_ratio", String(options.valRatio));
  if (options.testRatio !== undefined)
    params.set("test_ratio", String(options.testRatio));
  if (options.onlyReviewed) params.set("only_reviewed", "true");
  return requestFile(`/export?${params.toString()}`);
}

export function exportYolo(projectId) {
  return exportDataset(projectId, { format: "yolo" });
}
