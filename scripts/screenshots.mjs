/* global document -- used inside page.waitForFunction, which runs in the browser */
// Capture key screens at the four target viewports into docs/screenshots/.
// Needs the dev servers running (`npm run dev`) with the demo seed loaded.
// Usage: node --env-file=.env scripts/screenshots.mjs [baseUrl]
import { mkdir } from "node:fs/promises";
import { chromium } from "@playwright/test";

const BASE = process.argv[2] ?? "http://localhost:5173";
const PASSWORD = process.env.SEED_PASSWORD;
if (!PASSWORD) throw new Error("Set SEED_PASSWORD (run with --env-file=.env).");
const OUT = new URL("../docs/screenshots/", import.meta.url);

const VIEWPORTS = {
  desktop: { width: 1440, height: 900 },
  laptop: { width: 1280, height: 800 },
  tablet: { width: 768, height: 1024 },
  mobile: { width: 390, height: 844 },
};

async function signIn(page, email) {
  await page.goto(`${BASE}/login`);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByRole("heading", { name: /Welcome back/ }).waitFor();
}

async function courseUrl(page, name) {
  return page.evaluate(async (n) => {
    const r = await fetch(`/api/v1/courses?q=${encodeURIComponent(n)}&scope=mine`).then((x) => x.json());
    return `/courses/${r.data[0].id}`;
  }, name);
}

async function shot(page, name, vp) {
  // Wait for loading spinners to finish (the dev server keeps an HMR socket open, so "networkidle" never fires).
  await page.waitForFunction(() => !document.querySelector("[role=status] .animate-spin, .animate-spin"), null, { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(400);
  await page.screenshot({ path: new URL(`${name}-${vp}.png`, OUT).pathname.replace(/^\/([A-Za-z]:)/, "$1"), fullPage: false });
  console.log(`saved ${name}-${vp}.png`);
}

await mkdir(OUT, { recursive: true });
const browser = await chromium.launch();
try {
  for (const [vp, viewport] of Object.entries(VIEWPORTS)) {
    const ctx = await browser.newContext({ viewport, reducedMotion: "reduce" });
    const page = await ctx.newPage();
    await page.goto(`${BASE}/login`);
    await shot(page, "01-login", vp);

    await signIn(page, "alex@campus.test");
    await shot(page, "02-student-dashboard", vp);
    const bio = await courseUrl(page, "Introduction to Biology");
    await page.goto(`${BASE}${bio}`);
    await shot(page, "03-course-home", vp);
    await page.goto(`${BASE}${bio}/modules`);
    await shot(page, "04-modules", vp);
    await page.goto(`${BASE}${bio}/assignments`);
    await shot(page, "05-assignments", vp);
    await page.goto(`${BASE}${bio}/grades`);
    await shot(page, "06-student-grades", vp);
    await page.goto(`${BASE}/calendar`);
    await shot(page, "07-calendar", vp);
    await page.goto(`${BASE}/inbox`);
    await shot(page, "08-inbox", vp);
    if (vp === "mobile") {
      await page.getByRole("button", { name: "Open menu" }).click();
      await page.getByRole("dialog", { name: "Menu" }).waitFor();
      await shot(page, "09-navigation-drawer", vp);
      await page.keyboard.press("Escape");
    } else {
      await page.getByRole("navigation", { name: "Main" }).getByRole("button", { name: "Courses", exact: true }).click();
      await page.getByRole("dialog", { name: "Courses" }).getByRole("link", { name: "All courses" }).waitFor();
      await shot(page, "09-courses-tray", vp);
      await page.keyboard.press("Escape");
    }
    await ctx.clearCookies();

    await signIn(page, "morgan@campus.test");
    await shot(page, "10-instructor-dashboard", vp);
    await page.goto(`${BASE}${bio}/grades`);
    await shot(page, "11-gradebook", vp);
    await page.goto(`${BASE}${bio}/modules`);
    await shot(page, "12-instructor-modules", vp);
    await ctx.close();
  }
} finally {
  await browser.close();
}
