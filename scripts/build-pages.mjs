#!/usr/bin/env node
/**
 * Build the public marketing site for GitHub Pages.
 *
 *   pnpm build:pages
 *
 * This is the landing page only — no dashboard routes are shipped, because a
 * static host has no API and no database behind it. Output goes to
 * apps/web/dist-pages.
 *
 * Env vars are set here rather than inline in the npm script so the command
 * works identically on Windows and on CI.
 */
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const webDir = path.join(root, "apps", "web");
const outDir = path.join(webDir, "dist-pages");

// Repo name → base path. Override for a user/org page or a custom domain,
// where the site is served from the root instead of /<repo>/.
const base = process.env.VITE_BASE ?? "/Life_OS/";

console.log(`Building GitHub Pages site with base "${base}"…`);

execSync("vite build --outDir dist-pages --emptyOutDir", {
  cwd: webDir,
  stdio: "inherit",
  env: {
    ...process.env,
    VITE_DEPLOY_TARGET: "pages",
    VITE_BASE: base,
  },
});

// Pages runs Jekyll by default, which drops files and folders beginning with
// an underscore. Vite does not emit any today, but this is one byte of insurance.
fs.writeFileSync(path.join(outDir, ".nojekyll"), "");

// Serve index.html for unknown paths so a deep link does not hard 404.
fs.copyFileSync(path.join(outDir, "index.html"), path.join(outDir, "404.html"));

console.log(`\nPages site built → ${outDir}`);
console.log(`Preview it with:  pnpm preview:pages   (serves it at ${base})`);
