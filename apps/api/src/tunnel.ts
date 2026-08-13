/**
 * Reaching Life OS from outside the house.
 *
 * The problem, stated plainly: **this machine's own address cannot be a public
 * URL.** It is an RFC1918 address behind NAT, and the router's WAN address is
 * usually dynamic and usually firewalled. Printing `192.168.1.x` and calling it
 * "your URL" would be a lie that only works on the sofa.
 *
 * A stable public URL needs one of:
 *
 * | option | stable across restarts? | needs |
 * |--------|------------------------|-------|
 * | **Tailscale Funnel** | **yes** — `https://<machine>.<tailnet>.ts.net` | a free Tailscale account |
 * | Cloudflare *named* tunnel | yes | your own domain on Cloudflare |
 * | Cloudflare *quick* tunnel | **no** — the hostname rotates every restart | nothing |
 *
 * Tailscale is the default because it is the only free option whose URL does
 * not change, and a URL that changes is a phone that stops working every time
 * the machine reboots. It also gives real HTTPS, which retires the Android
 * cleartext workaround.
 *
 * Nothing here starts a tunnel process. Detecting one that is already running
 * and reporting it honestly is reliable; owning a long-lived child process,
 * restarting it, and parsing its log output is not — and a half-managed tunnel
 * that dies silently is worse than no tunnel.
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);

export type TunnelMode = "off" | "tailscale" | "cloudflare";

export function readTunnelMode(raw: string | undefined): TunnelMode {
  const value = (raw ?? "tailscale").trim().toLowerCase();
  if (value === "off" || value === "none" || value === "") return "off";
  if (value === "cloudflare" || value === "cloudflared") return "cloudflare";
  return "tailscale";
}

export interface PublicUrlResult {
  /** The URL a phone should use, or null if there is not one. */
  url: string | null;
  mode: TunnelMode;
  /** Why there is no URL, in a sentence the user can act on. */
  hint: string | null;
}

/**
 * Ask Tailscale for this machine's Funnel hostname.
 *
 * `tailscale status --json` carries `Self.DNSName`, which is the stable name.
 * Funnel then has to actually be serving the port — `tailscale funnel status`
 * says whether it is, and the check matters: the DNS name exists whether or not
 * anything outside the tailnet can reach it, and reporting a URL that only
 * works from your own devices would be the same lie in a different costume.
 */
async function tailscaleUrl(port: number): Promise<PublicUrlResult> {
  let dnsName: string;
  try {
    const { stdout } = await run("tailscale", ["status", "--json"], {
      timeout: 4000,
      windowsHide: true,
    });
    const status = JSON.parse(stdout) as { Self?: { DNSName?: string } };
    dnsName = (status.Self?.DNSName ?? "").replace(/\.$/, "");
    if (!dnsName) throw new Error("no DNSName");
  } catch {
    return {
      url: null,
      mode: "tailscale",
      hint:
        "Tailscale is not installed or not logged in. Install it and run " +
        "`tailscale up`, then `tailscale funnel " +
        port +
        "` to publish this port. Set TUNNEL=off to stop looking.",
    };
  }

  try {
    const { stdout } = await run("tailscale", ["funnel", "status"], {
      timeout: 4000,
      windowsHide: true,
    });
    /*
     * Funnel prints the ports it is serving. If this one is not among them, the
     * hostname resolves but nothing outside the tailnet answers on it.
     */
    if (!stdout.includes(String(port))) {
      return {
        url: null,
        mode: "tailscale",
        hint: `Tailscale is up, but Funnel is not serving port ${port}. Run \`tailscale funnel ${port}\`.`,
      };
    }
  } catch {
    return {
      url: null,
      mode: "tailscale",
      hint: `Could not read Funnel status. Run \`tailscale funnel ${port}\` to publish this port.`,
    };
  }

  // Funnel always terminates TLS on 443, whatever port it forwards to.
  return { url: `https://${dnsName}`, mode: "tailscale", hint: null };
}

/**
 * Resolve the public URL.
 *
 * `PUBLIC_URL` wins over everything. That is the escape hatch for a named
 * Cloudflare tunnel, a reverse proxy, or anything else this cannot detect —
 * and it is the only supported way to use a quick tunnel, whose hostname
 * changes on every restart and so cannot be discovered once at boot.
 */
export async function resolvePublicUrl(opts: {
  explicit: string | null;
  mode: TunnelMode;
  port: number;
}): Promise<PublicUrlResult> {
  if (opts.explicit) {
    return {
      url: opts.explicit.replace(/\/+$/, ""),
      mode: opts.mode,
      hint: null,
    };
  }

  if (opts.mode === "off") {
    return { url: null, mode: "off", hint: null };
  }

  if (opts.mode === "cloudflare") {
    return {
      url: null,
      mode: "cloudflare",
      hint:
        "Cloudflare tunnels are not started for you — a quick tunnel's hostname " +
        "changes every restart, so it cannot be discovered once at boot. Run " +
        `\`cloudflared tunnel --url http://127.0.0.1:${opts.port}\` and put the ` +
        "hostname it prints in PUBLIC_URL.",
    };
  }

  return tailscaleUrl(opts.port);
}
