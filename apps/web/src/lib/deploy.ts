/**
 * Build target.
 *
 * The same source builds two things:
 *   - the local app (default) — landing page + dashboard, talking to the API
 *   - the public site (VITE_DEPLOY_TARGET=pages) — landing page only
 *
 * The GitHub Pages build is static: there is no API and no database behind it,
 * so every "open the dashboard" affordance is hidden rather than dangled in
 * front of someone who has nothing to open.
 */
export const IS_PAGES = import.meta.env.VITE_DEPLOY_TARGET === "pages";

/**
 * Resolve a file in `public/` against the deploy base path.
 * Pages serves the site from `/<repo>/`, so a bare `/icon.png` would 404.
 */
export function asset(file: string): string {
  const base = import.meta.env.BASE_URL || "/";
  return `${base.replace(/\/$/, "")}/${file.replace(/^\//, "")}`;
}

export const REPO_URL = "https://github.com/EntangledQuantum/Life_OS";
