// Starts a throwaway backend + frontend for the e2e test.
//
// The whole point is that the test gets its own empty database and its own
// upload folders, so running `npm run test:e2e` can never delete or change the
// projects you're working on in the normal dev database.
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const API_PORT = 8001;
const WEB_PORT = 5174;

// Everything the test writes goes in here and gets deleted afterwards.
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "annotateai-e2e-"));

function waitFor(url, name, timeoutMs = 60000) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const tick = async () => {
      try {
        await fetch(url);
        resolve();
      } catch {
        if (Date.now() > deadline) reject(new Error(`${name} did not start in time`));
        else setTimeout(tick, 300);
      }
    };
    tick();
  });
}

export async function startServers() {
  const python = "../backend/.venv/bin/python";
  if (!fs.existsSync(python)) {
    throw new Error("backend/.venv not found — run ./start.sh once to set it up");
  }

  const api = spawn(
    python,
    ["-m", "uvicorn", "app.main:app", "--host", "127.0.0.1", "--port", String(API_PORT)],
    {
      cwd: "../backend",
      stdio: "ignore",
      env: {
        ...process.env,
        DATABASE_URL: `sqlite:///${path.join(scratch, "e2e.db")}`,
        UPLOAD_DIR: path.join(scratch, "uploads"),
        ANNOTATED_DIR: path.join(scratch, "annotated"),
        LOG_LEVEL: "WARNING",
      },
    }
  );

  // --host 127.0.0.1 so it listens on IPv4; by default vite only binds the
  // IPv6 localhost and the checks below can't reach it.
  const web = spawn(
    "npx",
    ["vite", "--host", "127.0.0.1", "--port", String(WEB_PORT), "--strictPort"],
    {
      stdio: "ignore",
      env: { ...process.env, VITE_API_TARGET: `http://127.0.0.1:${API_PORT}` },
    }
  );

  const stop = () => {
    api.kill();
    web.kill();
    fs.rmSync(scratch, { recursive: true, force: true });
  };
  // Don't leave stray servers behind if the test crashes or is interrupted.
  process.on("exit", stop);
  process.on("SIGINT", () => {
    stop();
    process.exit(130);
  });

  try {
    await waitFor(`http://127.0.0.1:${API_PORT}/api/health`, "backend");
    await waitFor(`http://127.0.0.1:${WEB_PORT}`, "frontend");
  } catch (err) {
    stop();
    throw err;
  }

  return { base: `http://127.0.0.1:${WEB_PORT}`, stop };
}
