/**
 * Production entry: the API *and* the built dashboard on one port.
 *
 * Identical to `index.ts` except that `SERVE_WEB` defaults on, so the API
 * serves `apps/web/dist` with an SPA fallback (see `static.ts`). Run it through
 * `pnpm serve` from the repo root, which builds the dashboard first.
 *
 * The flag is set here rather than in the package script because
 * `SERVE_WEB=1 tsx …` is not valid in Windows' cmd, which is what pnpm runs
 * scripts with there. `env.ts` reads it at import time, hence the dynamic
 * import after setting it.
 */
process.env.SERVE_WEB ??= "1";
await import("./index.js");

export {};
