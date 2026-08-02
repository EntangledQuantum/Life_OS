#!/usr/bin/env node
/**
 * Serve the built GitHub Pages site locally, under the same base path that
 * Pages will use.
 *
 *   pnpm preview:pages
 *
 * The base is passed through the environment here rather than on the command
 * line, because a leading-slash argument gets rewritten into a Windows path by
 * Git Bash's MSYS path conversion.
 */
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const webDir = path.join(root, "apps", "web");
const base = process.env.VITE_BASE ?? "/Life_OS/";

if (!fs.existsSync(path.join(webDir, "dist-pages", "index.html"))) {
  console.error("No build found. Run `pnpm build:pages` first.");
  process.exit(1);
}

execSync("vite preview --outDir dist-pages", {
  cwd: webDir,
  stdio: "inherit",
  env: { ...process.env, VITE_BASE: base },
});
