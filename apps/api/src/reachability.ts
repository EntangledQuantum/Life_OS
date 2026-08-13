/**
 * Where this instance can be reached from, resolved once at boot.
 *
 * It lives in its own module rather than in `env` because it is *discovered*
 * (Tailscale has to be asked, and asking is async) rather than read from a
 * file. `createApp()` is synchronous and is called from tests that must not
 * shell out to anything, so the app reads whatever has been set here and copes
 * with nothing having been.
 */
import { resolvePublicUrl, type TunnelMode } from "./tunnel.js";
import { env } from "./env.js";

let publicUrl: string | null = null;
let hint: string | null = null;
let mode: TunnelMode = "off";

/**
 * Ask the tunnel where we are. Called once from the server entry point, never
 * from `createApp` — a failure here must not stop the API serving the LAN.
 */
export async function discoverReachability(): Promise<void> {
  try {
    const result = await resolvePublicUrl({
      explicit: env.publicUrl,
      mode: env.tunnel,
      port: env.apiPort,
    });
    publicUrl = result.url;
    hint = result.hint;
    mode = result.mode;
  } catch (error) {
    publicUrl = null;
    hint = error instanceof Error ? error.message : String(error);
    mode = env.tunnel;
  }
}

/** The public URL, or null when there is not one. */
export function getPublicUrl(): string | null {
  return publicUrl;
}

/** Why there is no public URL, in a sentence the user can act on. */
export function getReachabilityHint(): string | null {
  return hint;
}

export function getTunnelMode(): TunnelMode {
  return mode;
}
