import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

/**
 * The API token is the *only* credential in Life OS. Shipping a known default
 * meant every fresh clone had the same password — and once `API_HOST=0.0.0.0`
 * existed, that default was a key everyone on the network already had.
 *
 * So there is no default any more. If `.env` has no usable token, we mint a
 * strong one, write it back, and say so loudly.
 */

/** Values that were once shipped or suggested. Treated as "no token at all". */
const KNOWN_WEAK = new Set([
  "",
  "lifeos-local-agent-token",
  "changeme",
  "change-me",
  "secret",
  "token",
  "lifeos",
]);

export function isWeakToken(token: string | undefined | null): boolean {
  if (!token) return true;
  const t = token.trim();
  return KNOWN_WEAK.has(t.toLowerCase()) || t.length < 24;
}

/** 32 bytes of CSPRNG, base64url — 256 bits, no shell-hostile characters. */
export function generateToken(): string {
  return `lifeos_${randomBytes(32).toString("base64url")}`;
}

/**
 * Set `key=value` in a .env file, preserving comments, ordering and every other
 * line. Appends the key if it is not already there.
 */
export function upsertEnvValue(envPath: string, key: string, value: string): void {
  const line = `${key}=${value}`;
  if (!existsSync(envPath)) {
    writeFileSync(envPath, `${line}\n`, "utf8");
    return;
  }

  const original = readFileSync(envPath, "utf8");
  const eol = original.includes("\r\n") ? "\r\n" : "\n";
  const lines = original.split(/\r?\n/);
  const pattern = new RegExp(`^\\s*(?:export\\s+)?${key}\\s*=`);

  let replaced = false;
  const next = lines.map((l) => {
    if (replaced || !pattern.test(l)) return l;
    replaced = true;
    return line;
  });

  if (!replaced) {
    // Keep a trailing blank line from turning into a gap in the middle.
    while (next.length && next[next.length - 1].trim() === "") next.pop();
    next.push(line);
  }

  writeFileSync(envPath, `${next.join(eol)}${eol}`, "utf8");
}

/**
 * Returns a usable token, generating and persisting one if `.env` does not have
 * a real one yet. Called once at boot, before anything can serve a request.
 */
export function ensureApiToken(root: string, current: string | undefined): {
  token: string;
  generated: boolean;
  reason: "missing" | "weak" | null;
} {
  if (!isWeakToken(current)) {
    return { token: current!.trim(), generated: false, reason: null };
  }

  const reason = current && current.trim() ? "weak" : "missing";
  const token = generateToken();

  try {
    upsertEnvValue(path.join(root, ".env"), "API_TOKEN", token);
  } catch (err) {
    // A read-only checkout should still boot — it just will not remember.
    console.warn(
      `  ! could not write API_TOKEN to .env (${(err as Error).message}).`,
      "\n    The generated token below only lasts until this process exits.",
    );
  }

  return { token, generated: true, reason };
}

/** Boot banner. Deliberately hard to scroll past. */
export function announceGeneratedToken(
  token: string,
  reason: "missing" | "weak" | null,
): void {
  const rule = "─".repeat(72);
  console.log(`\n${rule}`);
  console.log(
    reason === "weak"
      ? "  API_TOKEN was still the shared default — replaced with a strong one."
      : "  No API_TOKEN found — generated one for you.",
  );
  console.log(`\n    ${token}\n`);
  console.log("  Saved to .env. Paste it into the web app and any other client.");
  console.log("  This is the only credential Life OS has. Do not commit it.");
  console.log(`${rule}\n`);
}
