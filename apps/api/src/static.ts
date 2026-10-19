/**
 * Production serve mode: the built dashboard, from the API's own port.
 *
 * `pnpm dev` runs Vite on 5173 and proxies `/api` here. In production that is
 * two processes and two ports for one app, and a gateway that publishes one
 * upstream per app cannot front it. So with `SERVE_WEB=1` (what `pnpm serve`
 * sets) the API also serves `apps/web/dist`:
 *
 *   - real files (hashed `assets/*`, `icon.png`, `landing/*`) as files,
 *   - every other GET that is not an API path → `index.html`, so a deep link
 *     like `/app/goals` or `/pair#c=…` loads the SPA and the router takes over.
 *
 * The dashboard is built with a relative base (`./assets/…`), which works at
 * the root and under any prefix — except in `index.html` itself, which is
 * served at arbitrary depths (`/lifeos/app/goals`). So `index.html` is
 * rewritten per request: its `./` references become `<prefix>/`, and a
 * `<meta name="lifeos-base">` tells the client its prefix for the router and
 * the API base. The prefix is the gateway's `X-Forwarded-Prefix`, or "" for
 * direct access — one build serves both.
 */
import fs from "node:fs";
import path from "node:path";
import type { Context } from "hono";
import { readForwardedPrefix } from "./prefix.js";

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json",
  ".txt": "text/plain; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".ogg": "audio/ogg",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
};

/** Paths that belong to the API and must never fall back to the SPA. */
const API_PATH = /^\/(api(\/|$)|mcp(\/|$)|health\/?$)/;

/**
 * Point `index.html` at `prefix` and tell the client what the prefix is.
 *
 * `./x` and root-absolute `/x` attribute values both become `<prefix>/x`;
 * protocol-relative `//x` and absolute URLs are left alone. `prefix` must
 * already be validated (`readForwardedPrefix`) — it is written into markup.
 */
export function renderIndexHtml(html: string, prefix: string): string {
  const rewritten = html.replace(
    /(\s(?:src|href)=["'])(?:\.\/|\/(?!\/))/g,
    `$1${prefix}/`,
  );
  const meta = `<meta name="lifeos-base" content="${prefix}" />`;
  return /<head[^>]*>/i.test(rewritten)
    ? rewritten.replace(/<head[^>]*>/i, (m) => `${m}\n    ${meta}`)
    : `${meta}\n${rewritten}`;
}

export function webAppHandler(distDir: string) {
  const root = path.resolve(distDir);
  const indexPath = path.join(root, "index.html");
  let cache: { mtimeMs: number; html: string } | null = null;

  /** Re-read when a rebuild replaces it, so a running server picks it up. */
  function template(): string | null {
    try {
      const stat = fs.statSync(indexPath);
      if (!cache || cache.mtimeMs !== stat.mtimeMs) {
        cache = { mtimeMs: stat.mtimeMs, html: fs.readFileSync(indexPath, "utf8") };
      }
      return cache.html;
    } catch {
      return null;
    }
  }

  if (!template()) {
    console.warn(
      `  [web] no dashboard build at ${indexPath} — run \`pnpm --filter @life-os/web build\` ` +
        "(or `pnpm serve`, which builds first). Serving the API only.",
    );
  }

  return async (c: Context) => {
    const pathname = c.req.path;
    if (API_PATH.test(pathname)) return c.json({ error: "Not found" }, 404);

    let decoded: string;
    try {
      decoded = decodeURIComponent(pathname);
    } catch {
      return c.json({ error: "Bad path" }, 400);
    }
    if (decoded.includes("\0")) return c.json({ error: "Bad path" }, 400);

    // A real file, never outside dist.
    const file = path.resolve(root, `.${decoded}`);
    if (file.startsWith(root + path.sep) && file !== indexPath) {
      try {
        const stat = await fs.promises.stat(file);
        if (stat.isFile()) {
          const body = await fs.promises.readFile(file);
          const type =
            TYPES[path.extname(file).toLowerCase()] ?? "application/octet-stream";
          // Vite fingerprints everything under assets/, so it can be kept forever.
          const immutable = decoded.startsWith("/assets/");
          return new Response(new Uint8Array(body), {
            headers: {
              "Content-Type": type,
              "Content-Length": String(body.byteLength),
              "Cache-Control": immutable
                ? "public, max-age=31536000, immutable"
                : "no-cache",
              "X-Content-Type-Options": "nosniff",
            },
          });
        }
      } catch {
        /* not a file — fall through */
      }
    }

    /*
     * A missing *file* is a 404, not the SPA. Answering `/assets/old-hash.js`
     * with HTML makes the browser report a MIME-type error that hides the real
     * problem (a stale tab after a rebuild).
     */
    const ext = path.extname(decoded);
    if (ext && ext !== ".html") return c.json({ error: "Not found" }, 404);

    const html = template();
    if (!html) {
      return c.json(
        {
          error: "Dashboard not built",
          hint: "Run `pnpm serve` (builds the web app first) or `pnpm --filter @life-os/web build`.",
        },
        503,
      );
    }

    const prefix = readForwardedPrefix(c.req.header("x-forwarded-prefix"));
    return new Response(renderIndexHtml(html, prefix), {
      headers: {
        "Content-Type": TYPES[".html"]!,
        // The same URL renders differently per prefix, and must pick up rebuilds.
        "Cache-Control": "no-cache",
        Vary: "X-Forwarded-Prefix",
        "X-Content-Type-Options": "nosniff",
      },
    });
  };
}
