import path from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";
import { announceGeneratedToken, ensureApiToken } from "./token.js";
import { readTunnelMode } from "./tunnel.js";
import { normalizePublicPath } from "./prefix.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

/*
 * Whether the token came from the real environment rather than from `.env`.
 * Captured *before* dotenv runs, because after that the two are the same
 * variable and there is no way to tell them apart.
 *
 * This matters: `API_TOKEN=... DATABASE_PATH=/tmp/x.db pnpm dev` is how you run
 * a throwaway instance, and it must not rewrite the `.env` your real instance —
 * and your phone, and your agent — are authenticating against.
 */
const tokenFromEnvironment = process.env.API_TOKEN !== undefined;
config({ path: path.join(root, ".env") });

// There is no default token. If .env has none — or still has the old shared
// one — mint a strong one now and write it back, before anything can serve a
// request with it.
const token = ensureApiToken(root, process.env.API_TOKEN, {
  persist: !tokenFromEnvironment,
});
if (token.generated) {
  announceGeneratedToken(token.token, token.reason, !tokenFromEnvironment);
}

export const env = {
  root,
  apiPort: Number(process.env.API_PORT ?? 8787),
  /**
   * Bind address.
   *
   * Defaults to **all interfaces**, because the phone is the point. Life OS on
   * loopback is a dashboard you can only see from the chair you installed it
   * from, and every single user hit the same wall — the connect screen saying
   * "Life OS isn't running" while the same URL loaded fine in the desktop
   * browser two feet away.
   *
   * The exposure is not open: CORS allows loopback and private-LAN origins
   * only, and every request needs the token. Set `API_HOST=127.0.0.1` to go
   * back to loopback-only — see `docs/NETWORK.md`.
   */
  apiHost: process.env.API_HOST ?? "0.0.0.0",
  /**
   * How the outside world reaches this instance. `tailscale` (default) looks
   * for a Funnel hostname; `off` does not look. See `src/tunnel.ts`.
   */
  tunnel: readTunnelMode(process.env.TUNNEL),
  /**
   * Overrides tunnel detection entirely. The escape hatch for a reverse proxy,
   * a named Cloudflare tunnel, or a quick tunnel whose hostname changed.
   */
  publicUrl: (process.env.PUBLIC_URL ?? "").trim() || null,
  /**
   * The path this instance is published under on the public host, e.g.
   * `/lifeos` behind a gateway that serves several apps from one Funnel
   * hostname. Appended to the *detected* Tailscale URL (an explicit
   * `PUBLIC_URL` is used as-is and should already include it). Empty = root.
   */
  publicPath: normalizePublicPath(process.env.PUBLIC_PATH),
  /**
   * Production serve mode: the API also serves the built dashboard
   * (`apps/web/dist`) on its own port, so one process on one port is the whole
   * app. Off for `pnpm dev`, where Vite serves the dashboard. `pnpm serve`
   * turns it on — see `src/serve.ts`.
   */
  serveWeb: /^(1|true|yes|on)$/i.test((process.env.SERVE_WEB ?? "").trim()),
  webDist: path.resolve(
    root,
    (process.env.WEB_DIST ?? "").trim() || "apps/web/dist",
  ),
  /**
   * Extra CORS origins beyond localhost and private-LAN addresses, comma
   * separated. Only needed for a tunnel or a real hostname.
   */
  corsOrigins: (process.env.CORS_ORIGINS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
  /** The only credential. Never has a fallback value — see `token.ts`. */
  apiToken: token.token,
  databasePath: process.env.DATABASE_PATH ?? "./data/lifeos.db",
  storageMode: (process.env.STORAGE_MODE ?? "local") as "local" | "supabase",
  supabaseUrl: process.env.SUPABASE_URL ?? null,
  supabaseKey: process.env.SUPABASE_KEY ?? null,
};
