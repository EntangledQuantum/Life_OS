/**
 * The path prefix the dashboard is served under, decided at **runtime**.
 *
 * One build has to work at `http://127.0.0.1:8787/` and behind the gateway at
 * `https://<host>/lifeos/`. So the prefix is not baked in: when the API serves
 * `index.html` it injects `<meta name="lifeos-base" content="/lifeos">` from
 * the gateway's `X-Forwarded-Prefix` (empty for direct access). Everything that
 * builds a URL — the router basename, API calls, `public/` assets — goes
 * through here.
 *
 * Without the meta (Vite dev, the GitHub Pages build) it falls back to the
 * build-time base: `/` in dev, `/Life_OS/` on Pages.
 *
 * Returned without a trailing slash: "" at the root, "/lifeos" under a prefix.
 */
export function basePath(): string {
  if (typeof document !== "undefined") {
    const meta = document
      .querySelector('meta[name="lifeos-base"]')
      ?.getAttribute("content");
    if (meta != null) return clean(meta);
  }
  // `?.` because this is also imported by tests under plain Node.
  const built = import.meta.env?.BASE_URL ?? "/";
  // A relative build base ("./") carries no prefix information.
  return built.startsWith("/") ? clean(built) : "";
}

/** `path` ("/api/v1/x" or "icon.png") under the base: "/lifeos/api/v1/x". */
export function withBase(path: string): string {
  return `${basePath()}/${path.replace(/^\/+/, "")}`;
}

function clean(value: string): string {
  const trimmed = value.trim().replace(/^\/+|\/+$/g, "");
  return trimmed ? `/${trimmed}` : "";
}
