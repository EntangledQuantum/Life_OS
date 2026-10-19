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
import { withBase } from "./base";

export const IS_PAGES = import.meta.env.VITE_DEPLOY_TARGET === "pages";

/**
 * Where the landing page lives in each build.
 *
 * On the public site it *is* the site, so it keeps the root. On a self-hosted
 * instance the root opens the product instead — someone who reached their own
 * server is there to use it, not to read the pitch — so the landing page moves
 * to `/home` and is reached from the logo in the app header.
 *
 * A route path, not a URL: the router's basename adds the `/lifeos` prefix.
 */
export const LANDING_PATH = IS_PAGES ? "/" : "/home";

/**
 * Resolve a file in `public/` against the base path. Pages serves the site
 * from `/<repo>/` and the gateway from `/lifeos/`, so a bare `/icon.png` 404s.
 */
export function asset(file: string): string {
  return withBase(file);
}

export const REPO_URL = "https://github.com/EntangledQuantum/Life_OS";

/**
 * Android APK.
 *
 * `releases/latest/download/<asset>` is resolved by GitHub at request time, so
 * this keeps pointing at the newest release without the site being rebuilt.
 * It depends on the asset keeping exactly this filename — rename it in a future
 * release and the button 404s.
 */
export const ANDROID_APK_URL = `${REPO_URL}/releases/latest/download/life-os.apk`;

/** Release notes, for anything that wants context rather than the file. */
export const RELEASES_URL = `${REPO_URL}/releases/latest`;

/**
 * The setup instructions an agent reads, raw from `master`.
 *
 * Deliberately not a link into the repo's HTML view: the sentence below tells
 * an agent to *fetch* this, and the rendered page is full of GitHub chrome.
 */
export const AGENT_SETUP_URL =
  "https://raw.githubusercontent.com/EntangledQuantum/Life_OS/master/docs/AGENT_SETUP.md";

/**
 * The one thing to copy off the landing page.
 *
 * Setting Life OS up is an agent task — install it, run it as a service,
 * interview the user, schedule a nightly check-in — so the page hands over the
 * sentence that starts that rather than a wall of shell commands.
 */
export const AGENT_ONE_LINER = `Fetch ${AGENT_SETUP_URL} and set Life OS up for me`;
