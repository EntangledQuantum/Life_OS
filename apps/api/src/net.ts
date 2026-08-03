/**
 * Network helpers for running Life OS on a LAN.
 *
 * The API binds to loopback by default. When it is deliberately exposed
 * (`API_HOST=0.0.0.0`) a phone or tablet on the same Wi-Fi needs its origin
 * allowed by CORS — but "allow everything" would also let any web page the user
 * happens to be browsing talk to their instance. So the rule is: **loopback and
 * private-network origins are allowed on any port; everything else has to be
 * named explicitly** via `CORS_ORIGINS`.
 */
import os from "node:os";

/** RFC 1918 / loopback / link-local — the addresses a home network actually uses. */
function isPrivateHostname(hostname: string): boolean {
  const host = hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost")) return true;
  // mDNS names, e.g. macbook.local
  if (host.endsWith(".local")) return true;
  if (host === "::1" || host === "[::1]") return true;
  // IPv6 link-local (fe80::/10) and unique-local (fc00::/7)
  if (/^\[?(fe80|fc|fd)[0-9a-f:]*\]?$/i.test(host)) return true;

  const v4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!v4) return false;
  const [a, b] = [Number(v4[1]), Number(v4[2])];
  if (a === 127 || a === 10) return true;
  if (a === 192 && b === 168) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 169 && b === 254) return true; // link-local
  return false;
}

export function isAllowedOrigin(origin: string, extra: string[] = []): boolean {
  if (extra.includes(origin) || extra.includes("*")) return true;
  try {
    const url = new URL(origin);
    if (url.protocol !== "http:" && url.protocol !== "https:") return false;
    return isPrivateHostname(url.hostname);
  } catch {
    return false;
  }
}

/** Every LAN IPv4 address this machine answers on, for the boot banner. */
export function lanAddresses(): string[] {
  const out: string[] = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const iface of list ?? []) {
      if (iface.family !== "IPv4" || iface.internal) continue;
      if (isPrivateHostname(iface.address)) out.push(iface.address);
    }
  }
  return out;
}

/** Is this bind address reachable from other machines? */
export function isExposed(host: string): boolean {
  return host === "0.0.0.0" || host === "::" || host === "";
}
