/**
 * End-to-end smoke test — drives a real browser through the core flow:
 * register -> create project -> upload image -> back to dashboard, and checks
 * that the new project and its data are actually visible.
 *
 * It starts its own backend and frontend on ports 8001/5174 with an empty
 * throwaway database, so it never touches your dev data. You don't need
 * ./start.sh running first.
 *
 * Setup (one-time):  npx playwright install chromium
 * Run:               npm run test:e2e
 */
import { execSync } from "node:child_process";
import fs from "node:fs";
import { chromium } from "playwright-core";
import { startServers } from "./servers.mjs";

function findChromium() {
  const cache = `${process.env.HOME}/Library/Caches/ms-playwright`;
  if (fs.existsSync(cache)) {
    for (const dir of fs.readdirSync(cache).filter((d) => d.startsWith("chromium-"))) {
      const hits = execSync(
        `find "${cache}/${dir}" -type f -name 'Google Chrome for Testing' -o -type f -name 'Chromium' 2>/dev/null | head -1`
      )
        .toString()
        .trim();
      if (hits) return hits;
    }
  }
  try {
    return execSync("which chromium || which google-chrome").toString().trim();
  } catch {
    throw new Error("Chromium not found. Run: npx playwright install chromium");
  }
}

const email = `qa_${Date.now()}@test.com`;
const projectName = `QA Proj ${Date.now()}`;
// The landing-page screenshot ships with the repo and has cars/buses in it, so
// YOLO always finds something to detect.
const sampleImage = "src/assets/image.png";

const log = (...a) => console.log("•", ...a);
let failed = false;
const fail = (m) => {
  failed = true;
  console.error("✗ FAIL:", m);
};

log("starting test servers (own database, nothing shared with dev)...");
const { base: BASE, stop } = await startServers();

const browser = await chromium.launch({ executablePath: findChromium(), headless: true });
const page = await browser.newPage();
page.on("pageerror", (e) => fail(`uncaught page error: ${e.message}`));

try {
  await page.goto(`${BASE}/#/register`);
  await page.fill("#register-name", "QA User");
  await page.fill("#register-email", email);
  await page.fill("#register-password", "password123");
  await page.fill("#register-confirm", "password123");
  await page.click('button[type="submit"]');
  await page.waitForFunction(() => location.hash.includes("dashboard"), {
    timeout: 8000,
  });
  log("registered");

  await page.click("text=New project");
  await page.waitForSelector("#project-name");
  await page.fill("#project-name", projectName);
  await page.click('button:has-text("Create Project")');
  await page.waitForFunction(() => /dashboard\/project\//.test(location.hash), {
    timeout: 8000,
  });
  log("project created");

  await page.click('button:has-text("Upload Images")');
  await page.waitForFunction(() => location.hash.includes("/upload"), { timeout: 8000 });
  await page.setInputFiles(
    'input[type="file"][accept="image/*"]:not([webkitdirectory])',
    sampleImage
  );
  await page.waitForSelector("text=/Save annotations/i", { timeout: 60000 });
  log("image uploaded + detected");

  await page.click('.ws-nav-item:has-text("Dashboard")');
  await page.waitForFunction(() => location.hash === "#/dashboard", { timeout: 8000 });
  await page.waitForTimeout(2000);

  const sidebar = await page.$$eval(".ws-project-name", (els) =>
    els.map((e) => e.textContent.trim())
  );
  if (sidebar.includes(projectName)) {
    log("project visible in sidebar");
  } else {
    fail(`project "${projectName}" missing from sidebar`);
  }

  const stat = (label) =>
    page
      .$eval(`.dashboard-stat-card:has-text('${label}') .dashboard-stat-value`, (e) =>
        Number(e.textContent.trim())
      )
      .catch(() => 0);

  if ((await stat("Projects")) < 1) fail("dashboard Projects stat is 0");
  if ((await stat("Images")) < 1) fail("dashboard Images stat is 0");

  const body = await page.textContent("body");
  if (body.includes("No images available for review"))
    fail("dashboard has no images after upload");
  if (body.includes("No detected classes yet"))
    fail("dashboard has no classes after upload");

  // Deleting from the sidebar is part of what we're testing.
  try {
    const row = page.locator(`.ws-project:has-text("${projectName}")`);
    await row.hover();
    page.once("dialog", (d) => d.accept());
    await row.locator(".ws-project-delete").click();
    await page.waitForFunction(
      (name) =>
        ![...document.querySelectorAll(".ws-project-name")].some((e) =>
          e.textContent.includes(name)
        ),
      projectName,
      { timeout: 8000 }
    );
    log("deleted project from sidebar");
  } catch (e) {
    fail(`sidebar delete did not work: ${e.message}`);
  }

  console.log(failed ? "\n✗ SOME CHECKS FAILED" : "\n✓ ALL CHECKS PASSED");
  process.exitCode = failed ? 1 : 0;
} finally {
  await browser.close();
  stop();
}
