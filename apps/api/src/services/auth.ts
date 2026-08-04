/**
 * Token-only auth.
 *
 * There used to be a username/password login backed by a sessions table. It was
 * removed because it was worse than nothing: the credentials defaulted to
 * `admin` / `lifeos`, they were printed in the README, and the web client
 * signed in with them automatically. Anyone who could reach the port was in —
 * and once the API started binding `0.0.0.0` for the phone, "anyone who could
 * reach the port" meant everyone on the network.
 *
 * Now there is exactly one credential: `API_TOKEN` from `.env`. It is a real
 * secret, the user chooses it, and every client — browser, agent, phone —
 * presents the same thing.
 */
import { env } from "../env.js";

/** Constant-time-ish compare so a wrong token cannot be probed byte by byte. */
function tokensMatch(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

export function validateToken(
  token: string | undefined | null,
): { valid: true; username: string } | { valid: false } {
  if (!token || !env.apiToken) return { valid: false };
  return tokensMatch(token, env.apiToken)
    ? { valid: true, username: "owner" }
    : { valid: false };
}

export function me(username: string) {
  return {
    username,
    role: "owner",
    auth: "token",
  };
}
