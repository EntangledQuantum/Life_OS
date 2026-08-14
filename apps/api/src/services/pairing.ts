/**
 * Pairing a phone without typing a token.
 *
 * The token is 43 characters of base64url. Typing it into a phone keyboard is
 * miserable and people get it wrong, so the setup that actually happens is
 * "email it to myself" — which puts the only credential this app has into a
 * mailbox forever.
 *
 * So: the dashboard mints a **short-lived, single-use code**, shows it as a QR,
 * and the phone trades the code for the real token over one request.
 *
 * The token is never in the QR. A code that expires in five minutes and burns
 * on first use is strictly better than an "encrypted" token whose key has to
 * travel alongside it — and rescanning takes two seconds, so nothing is lost by
 * being strict.
 *
 * Codes live in memory on purpose. They are valid for five minutes; a restart
 * invalidating them is correct, not a limitation, and it keeps the only thing
 * that can be traded for the token out of the database and out of backups.
 */
import { randomBytes, timingSafeEqual } from "node:crypto";

/** How long a code is good for. Long enough to walk to the other room. */
const TTL_MS = 5 * 60 * 1000;

/**
 * How many unclaimed codes can exist at once. Minting is authenticated, so this
 * is a bound on a stuck client rather than on an attacker.
 */
const MAX_OUTSTANDING = 20;

interface PairingCode {
  code: string;
  /** What the phone should point at. */
  baseUrl: string;
  expiresAt: number;
}

const outstanding = new Map<string, PairingCode>();

/** Drop anything expired. Called on every mint and every claim. */
function sweep(now = Date.now()): void {
  for (const [code, entry] of outstanding) {
    if (entry.expiresAt <= now) outstanding.delete(code);
  }
}

/**
 * A code with roughly 62 bits of entropy, in an alphabet without the characters
 * people misread when a QR fails and they fall back to typing it: no O/0, no
 * I/l/1.
 */
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

function generateCode(length = 12): string {
  const bytes = randomBytes(length);
  let out = "";
  for (let i = 0; i < length; i++) {
    out += ALPHABET[bytes[i]! % ALPHABET.length];
  }
  return out;
}

export interface MintedPairing {
  code: string;
  /**
   * **What the QR encodes.** A `lifeos://` deep link, so the phone's own camera
   * offers to open the app — no browser in the middle.
   */
  deepLink: string;
  /** The same pairing as a web page, for a phone with no app installed yet. */
  webUrl: string;
  baseUrl: string;
  expiresAt: string;
  expiresInSeconds: number;
}

/**
 * The app's custom URL scheme, from `mobile-frontend/app/app.json`.
 *
 * It has to be the scheme and cannot be an `https://` link. Android App Links
 * and iOS Universal Links both require a **verified web domain** — a file
 * served from a domain you have proven you control. This instance answers on
 * `192.168.x.x`, and an IP address can never be verified, so an http(s) URL in
 * the QR could not open the app on any device, ever. The scheme can.
 */
const APP_SCHEME = "lifeos";

/**
 * Mint a pairing code for a base URL.
 *
 * `baseUrl` is where the *phone* should talk to this instance — the public
 * tunnel URL when there is one, the LAN address otherwise. It is carried inside
 * the link rather than assumed, because the address the dashboard uses and the
 * address a phone can reach are not always the same one.
 */
export function mintPairingCode(baseUrl: string, now = Date.now()): MintedPairing {
  sweep(now);

  if (outstanding.size >= MAX_OUTSTANDING) {
    // Drop the oldest rather than refusing: a user clicking "show QR" a lot is
    // the likely cause, and refusing them is the wrong answer.
    const oldest = [...outstanding.values()].sort(
      (a, b) => a.expiresAt - b.expiresAt,
    )[0];
    if (oldest) outstanding.delete(oldest.code);
  }

  const trimmed = baseUrl.replace(/\/+$/, "");
  const code = generateCode();
  const expiresAt = now + TTL_MS;
  outstanding.set(code, { code, baseUrl: trimmed, expiresAt });

  const query = `code=${encodeURIComponent(code)}&url=${encodeURIComponent(trimmed)}`;

  return {
    code,
    deepLink: `${APP_SCHEME}://pair?${query}`,
    /*
     * The web fallback keeps the code in the **fragment**, which is never sent
     * to a server — so it stays out of access logs and Referer headers. The
     * deep link cannot do that (a scheme URL has no server to hide it from, and
     * the app needs to read it), which is fine: it goes straight from the QR
     * into the app on the same device.
     */
    webUrl: `${trimmed}/pair#c=${code}`,
    baseUrl: trimmed,
    expiresAt: new Date(expiresAt).toISOString(),
    expiresInSeconds: Math.round(TTL_MS / 1000),
  };
}

export type ClaimResult =
  | { ok: true; baseUrl: string; token: string }
  | { ok: false; error: string };

/**
 * Trade a code for the real token. **Single use** — the code is deleted before
 * the token is returned, so a replayed request finds nothing.
 *
 * Compared in constant time. The window is small and the entropy is high, but
 * an endpoint that answers "wrong code" faster than "right code" is a free hint
 * and there is no reason to give one.
 */
export function claimPairingCode(
  submitted: string,
  token: string,
  now = Date.now(),
): ClaimResult {
  sweep(now);

  const cleaned = submitted.trim().toUpperCase();
  if (!cleaned) return { ok: false, error: "No code given" };

  let found: PairingCode | null = null;
  for (const entry of outstanding.values()) {
    if (constantTimeEqual(entry.code, cleaned)) found = entry;
  }

  if (!found) {
    return {
      ok: false,
      error: "That code is expired or has already been used. Show a new QR.",
    };
  }

  outstanding.delete(found.code);
  return { ok: true, baseUrl: found.baseUrl, token };
}

function constantTimeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

/** For tests and for the boot banner. */
export function outstandingCount(now = Date.now()): number {
  sweep(now);
  return outstanding.size;
}

/** Drop every code. Used when the token is rotated. */
export function revokeAllPairingCodes(): void {
  outstanding.clear();
}
