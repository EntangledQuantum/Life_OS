/**
 * Serving Life OS under a path prefix.
 *
 * Behind a gateway that publishes several apps on one hostname, Life OS lives
 * at `https://<host>/lifeos/` rather than at the root. The gateway tells us so
 * with `X-Forwarded-Prefix: /lifeos`, and — depending on how it is configured —
 * either strips the prefix before forwarding (`/lifeos/api/v1/x` arrives as
 * `/api/v1/x`) or forwards the path unchanged. Both are handled:
 *
 *   - the router ignores the prefix if it is still on the path (`stripPrefix`),
 *   - the dashboard's `index.html` is rewritten per request so its assets,
 *     router basename and API calls all carry the prefix (`static.ts`).
 *
 * Nothing here is a security boundary. The header only changes which URLs the
 * HTML a client asked for points at; every API route keeps its own Bearer
 * check. It is still validated, so a stray header cannot inject markup.
 */

/** `lifeos`, `/lifeos/`, ` /lifeos ` → `/lifeos`; empty or `/` → "". */
export function normalizePublicPath(raw: string | null | undefined): string {
  const trimmed = (raw ?? "").trim().replace(/^\/+|\/+$/g, "");
  return trimmed ? `/${trimmed}` : "";
}

/** One or more plain path segments. No dots-only segments, no markup. */
const SAFE_PREFIX = /^(\/[A-Za-z0-9_~-][A-Za-z0-9._~-]*)+$/;

/**
 * The prefix a gateway says this request was published under, or "" when
 * there is none (direct access) or the header is not a plain path.
 */
export function readForwardedPrefix(raw: string | null | undefined): string {
  // A proxy chain may append: "/outer, /lifeos". The first hop is the public one.
  const first = (raw ?? "").split(",")[0] ?? "";
  const value = normalizePublicPath(first);
  return value && SAFE_PREFIX.test(value) ? value : "";
}

/** `/lifeos/api/v1/x` → `/api/v1/x` when the prefix is `/lifeos`; else unchanged. */
export function stripPathPrefix(pathname: string, prefix: string): string {
  if (!prefix) return pathname;
  if (pathname === prefix) return "/";
  if (pathname.startsWith(`${prefix}/`)) return pathname.slice(prefix.length);
  return pathname;
}

/**
 * The public base URL a request arrived on, reconstructed from the gateway's
 * `X-Forwarded-*` headers (`https://host.ts.net/lifeos`). Null for a direct
 * request — the gateway rewrites `Host` to the upstream, so without these the
 * request URL is a loopback address no phone can use.
 */
export function forwardedBaseUrl(headers: {
  get(name: string): string | null | undefined;
}): string | null {
  const host = (headers.get("x-forwarded-host") ?? "").split(",")[0]?.trim();
  if (!host || !/^[A-Za-z0-9.-]+(:\d+)?$|^\[[0-9a-fA-F:]+\](:\d+)?$/.test(host)) {
    return null;
  }
  const protoRaw = (headers.get("x-forwarded-proto") ?? "").split(",")[0]?.trim().toLowerCase();
  const proto = protoRaw === "http" ? "http" : "https";
  const prefix = readForwardedPrefix(headers.get("x-forwarded-prefix"));
  return `${proto}://${host}${prefix}`;
}
