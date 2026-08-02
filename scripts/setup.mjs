#!/usr/bin/env node
/**
 * Life OS one-command setup.
 *
 *   pnpm setup
 *
 * Idempotent: safe to re-run. Creates .env, installs dependencies, provisions
 * the local SQLite database, applies migrations, and seeds starter data.
 * Never overwrites an existing .env or an existing database.
 */
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import readline from "node:readline";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const c = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
  cyan: "\x1b[36m",
};

const say = (msg) => console.log(msg);
const step = (n, total, msg) =>
  say(`\n${c.cyan}${c.bold}[${n}/${total}]${c.reset} ${c.bold}${msg}${c.reset}`);
const ok = (msg) => say(`  ${c.green}✓${c.reset} ${msg}`);
const warn = (msg) => say(`  ${c.yellow}!${c.reset} ${msg}`);
const fail = (msg) => say(`  ${c.red}✗${c.reset} ${msg}`);

const args = new Set(process.argv.slice(2));
const skipSeed = args.has("--no-seed");
const force = args.has("--force");

const TOTAL = 5;

function run(cmd, label) {
  say(`  ${c.dim}$ ${cmd}${c.reset}`);
  execSync(cmd, { cwd: root, stdio: "inherit" });
  if (label) ok(label);
}

function readEnvValue(key, fallback) {
  const envPath = path.join(root, ".env");
  if (!fs.existsSync(envPath)) return fallback;
  const line = fs
    .readFileSync(envPath, "utf8")
    .split(/\r?\n/)
    .find((l) => l.trim().startsWith(`${key}=`));
  return line ? line.slice(line.indexOf("=") + 1).trim() : fallback;
}

function confirm(question) {
  // Non-interactive shells (CI, agents) must not hang waiting on stdin.
  if (!process.stdin.isTTY) return Promise.resolve(false);
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return new Promise((resolve) => {
    rl.question(`  ${question} [y/N] `, (answer) => {
      rl.close();
      resolve(/^y(es)?$/i.test(answer.trim()));
    });
  });
}

async function main() {
  say(`\n${c.bold}Life OS setup${c.reset} ${c.dim}${root}${c.reset}`);

  // ---------------------------------------------------------------- 1. Node
  step(1, TOTAL, "Checking Node.js");
  const [major, minor] = process.versions.node.split(".").map(Number);
  const hasNodeSqlite = major > 22 || (major === 22 && minor >= 5);
  if (!hasNodeSqlite) {
    fail(
      `Node ${process.versions.node} is too old. Life OS uses the built-in ` +
        `node:sqlite module, which needs Node 22.5 or newer (24 LTS recommended).`,
    );
    process.exit(1);
  }
  ok(`Node ${process.versions.node}`);

  // ----------------------------------------------------------------- 2. .env
  step(2, TOTAL, "Preparing environment");
  const envPath = path.join(root, ".env");
  const examplePath = path.join(root, ".env.example");
  if (fs.existsSync(envPath) && !force) {
    ok(".env already exists — left untouched");
  } else if (fs.existsSync(examplePath)) {
    fs.copyFileSync(examplePath, envPath);
    ok("Created .env from .env.example");
    warn("Change ADMIN_PASS and API_TOKEN before exposing this beyond localhost");
  } else {
    fail(".env.example is missing — cannot create .env");
    process.exit(1);
  }

  // ------------------------------------------------------------ 3. Install
  step(3, TOTAL, "Installing dependencies");
  try {
    run("pnpm install", "Dependencies installed");
  } catch {
    fail("pnpm install failed. Is pnpm installed? (npm i -g pnpm)");
    process.exit(1);
  }

  // ----------------------------------------------------------- 4. Database
  step(4, TOTAL, "Provisioning the database");
  const dbRelative = readEnvValue("DATABASE_PATH", "./data/lifeos.db");
  const dbPath = path.isAbsolute(dbRelative)
    ? dbRelative
    : path.resolve(root, dbRelative);
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });

  const dbExisted = fs.existsSync(dbPath);
  if (dbExisted) {
    ok(`Existing database found at ${dbPath}`);
  } else {
    ok(`Database will be created at ${dbPath}`);
  }

  run("pnpm db:migrate", "Schema up to date");

  // ---------------------------------------------------------------- 5. Seed
  step(5, TOTAL, "Seeding starter data");
  if (skipSeed) {
    warn("Skipped (--no-seed)");
  } else if (!dbExisted) {
    run("pnpm db:seed", "Starter habits, blocks, and cards created");
  } else {
    // Seeding is insert-if-empty, so this is non-destructive — but a user with
    // real history deserves to be asked rather than surprised.
    const yes = await confirm(
      "Database already existed. Run the seed too? (only fills empty tables)",
    );
    if (yes) {
      run("pnpm db:seed", "Seed complete");
    } else {
      ok("Seed skipped — your existing data is untouched");
    }
  }

  const user = readEnvValue("ADMIN_USER", "admin");
  const pass = readEnvValue("ADMIN_PASS", "lifeos");
  const token = readEnvValue("API_TOKEN", "lifeos-local-agent-token");
  const port = readEnvValue("API_PORT", "8787");

  say(`\n${c.green}${c.bold}Setup complete.${c.reset}\n`);
  say(`  ${c.bold}Start it:${c.reset}   pnpm dev`);
  say(`  ${c.bold}Web:${c.reset}        http://127.0.0.1:5173`);
  say(`  ${c.bold}API:${c.reset}        http://127.0.0.1:${port}`);
  say(`  ${c.bold}Login:${c.reset}      ${user} / ${pass}`);
  say(`  ${c.bold}Database:${c.reset}   ${dbPath}`);
  say(`  ${c.bold}Agent token:${c.reset} ${token}`);
  say(
    `\n  ${c.dim}Hand your agent docs/skills/life-os/SKILL.md — it can drive everything from there.${c.reset}\n`,
  );
}

main().catch((err) => {
  fail(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
