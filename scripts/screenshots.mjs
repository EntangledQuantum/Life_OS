#!/usr/bin/env node
/**
 * Capture the README screenshots.
 *
 *   pnpm dev            # in one terminal — the app must be running
 *   pnpm screenshots    # in another
 *
 * Writes PNGs into docs/screenshots/. Playwright is not a project dependency;
 * it is fetched on demand, so this needs network access the first time:
 *
 *   npx playwright install chromium
 *
 * Override the target with WEB_URL if your dev server is on another port.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = path.join(root, "docs", "screenshots");
const baseUrl = (process.env.WEB_URL ?? "http://localhost:5173").replace(/\/$/, "");

let chromium;
try {
  ({ chromium } = await import("playwright"));
} catch {
  console.error(
    "Playwright is not installed.\n" +
      "  npm i -D playwright && npx playwright install chromium\n" +
      "then re-run this script.",
  );
  process.exit(1);
}

fs.mkdirSync(outDir, { recursive: true });

/**
 * Each shot sets its own viewport height and captures the whole of it — clip
 * regions have to sit inside the viewport, so height is how we frame a section.
 */
const shots = [
  {
    file: "landing.png",
    path: "/",
    // Hero only — a full-page shot of a long marketing page is unreadable in a README.
    height: 880,
  },
  {
    file: "dashboard.png",
    path: "/app",
    /*
     * Tall enough for the day's cards *and* the agent's two underneath them —
     * at 940 the Complete buttons were sliced in half, which reads as a broken
     * page rather than as a crop.
     */
    height: 1060,
  },
  {
    file: "goals.png",
    path: "/app/goals",
    /*
     * The goals and the counters they read, whole. Cutting through the counters
     * row makes the page look like it continues into something unfinished; it
     * does not, that is the end of it.
     */
    height: 1090,
  },
  {
    file: "layers.png",
    path: "/",
    scrollTo: "#how",
    height: 900,
  },
  {
    file: "growth-meter.png",
    path: "/",
    scrollTo: "#growth-demo",
    height: 820,
  },
  {
    file: "agents.png",
    path: "/",
    scrollTo: "#agents",
    height: 780,
  },
];

const WIDTH = 1440;

const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width: WIDTH, height: 900 },
  // Scale 1 keeps the PNGs small enough to live in the repo comfortably.
  deviceScaleFactor: 1,
  colorScheme: "dark",
});
// Freeze the aurora drift and reveal transitions so shots are reproducible.
await page.emulateMedia({ reducedMotion: "reduce" });

/*
 * `/app` is behind the API token, so without one every dashboard shot is the
 * connect screen. Passed in rather than read from `.env`: these runs should be
 * pointed at a throwaway instance, and a script that reaches for the real token
 * by default will eventually be run against the real database.
 */
const token = process.env.LIFEOS_TOKEN;
if (token) {
  await page.addInitScript((value) => {
    try {
      localStorage.setItem("lifeos_token", value);
    } catch {
      /* private mode — the shot will show the connect screen, which is honest */
    }
  }, token);
} else {
  console.log("  (no LIFEOS_TOKEN — /app shots will show the connect screen)");
}

for (const shot of shots) {
  const url = `${baseUrl}${shot.path}`;
  process.stdout.write(`  ${shot.file} … `);
  await page.setViewportSize({ width: WIDTH, height: shot.height });
  try {
    // Not networkidle: the dashboard polls on an interval, so it never idles.
    await page.goto(url, { waitUntil: "load", timeout: 30_000 });
  } catch {
    console.log("skipped (could not reach the app — is `pnpm dev` running?)");
    continue;
  }

  if (shot.scrollTo) {
    await page.evaluate((sel) => {
      document.querySelector(sel)?.closest("section")?.scrollIntoView({ block: "start" });
    }, shot.scrollTo);
  }

  // Let scroll-reveal transitions and the growth spring settle.
  await page.waitForTimeout(1600);

  try {
    await page.screenshot({
      path: path.join(outDir, shot.file),
      // Webfonts occasionally never resolve document.fonts.ready here; the text
      // is already painted by this point, so do not block the whole run on it.
      timeout: 15_000,
      animations: "disabled",
      caret: "hide",
    });
    console.log("ok");
  } catch (e) {
    console.log(`failed (${e instanceof Error ? e.message.split("\n")[0] : e})`);
  }
}

await browser.close();
console.log(`\nScreenshots written to ${outDir}`);
