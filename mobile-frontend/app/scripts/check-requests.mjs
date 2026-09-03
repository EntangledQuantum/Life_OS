#!/usr/bin/env node
/**
 * Every network call in this app must carry a timeout.
 *
 * React Native configures OkHttp with connect, read and write timeouts all at
 * zero, so a bare `fetch` to a host that drops packets neither resolves nor
 * rejects — the promise stays pending, the query never errors, and the screen
 * shows a spinner for the rest of the session. It is invisible in review, it
 * typechecks, and it only appears when someone's laptop is asleep.
 *
 * So: `fetch` is allowed in exactly one file, `lib/api.ts`, where
 * `fetchWithTimeout` wraps it. Everywhere else, call through that.
 *
 * Run: `node scripts/check-requests.mjs` (CI runs it on every push).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ALLOWED = path.join(root, "lib", "api.ts");
const SKIP = new Set(["node_modules", ".expo", "dist", "android", "ios", "scripts"]);

/** Bare `fetch(`, but not `fetchWithTimeout(` and not `.fetch(` on some object. */
const BARE_FETCH = /(?<![.\w])fetch\s*\(/;

function sourceFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".") || SKIP.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...sourceFiles(full));
    else if (/\.(ts|tsx)$/.test(entry.name)) out.push(full);
  }
  return out;
}

const offenders = [];
for (const file of sourceFiles(root)) {
  if (path.resolve(file) === ALLOWED) continue;
  const lines = fs.readFileSync(file, "utf8").split("\n");
  lines.forEach((line, i) => {
    if (BARE_FETCH.test(line)) {
      offenders.push(`${path.relative(root, file)}:${i + 1}  ${line.trim()}`);
    }
  });
}

if (offenders.length > 0) {
  console.error(
    "A network call without a timeout will hang this app forever.\n" +
      "Use fetchWithTimeout from lib/api.ts (or an api.* method) instead:\n\n" +
      offenders.map((o) => `  ${o}`).join("\n") +
      "\n",
  );
  process.exit(1);
}

console.log("Every request goes through lib/api.ts — all timed.");
