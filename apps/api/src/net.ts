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

/**
 * Interfaces that exist for a hypervisor or a container runtime, not for a
 * network a phone is on. Matched on the adapter *name*, which is the only
 * place the distinction is visible — their addresses are ordinary private
 * ones.
 */
const VIRTUAL_ADAPTER =
  /\b(vethernet|hyper-?v|wsl|docker|virtualbox|vmware|vmnet|veth\d*|br-|tailscale|zerotier|tunnel|loopback)\b/i;

/**
 * Rank an address by how likely a phone on the same Wi-Fi is to reach it.
 * Lower sorts first.
 *
 * `172.16–31` is a legitimate private range, but on Windows it is also where
 * Hyper-V and WSL put their virtual switches, so it loses to the ranges a home
 * router actually hands out.
 */
function reachabilityRank(name: string, address: string): number {
  const virtual = VIRTUAL_ADAPTER.test(name) ? 10 : 0;
  if (/^192\.168\./.test(address)) return virtual + 0;
  if (/^10\./.test(address)) return virtual + 1;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(address)) return virtual + 2;
  return virtual + 3;
}

/**
 * Every LAN IPv4 address this machine answers on, **best first**.
 *
 * The order is the whole point, because callers take `[0]` — the pairing QR
 * does, and so does the boot banner. Unsorted, `os.networkInterfaces()` on a
 * Windows box with Hyper-V or WSL installed reports `vEthernet (Default
 * Switch)` at `172.23.x.x` *before* the real `Ethernet` at `192.168.x.x`, so
 * the QR encoded an address that exists only inside the host. The phone's
 * request went nowhere and the failure said "can't reach Life OS", which is
 * true and useless.
 */
export function lanAddresses(): string[] {
  const found: { address: string; rank: number }[] = [];
  for (const [name, list] of Object.entries(os.networkInterfaces())) {
    for (const iface of list ?? []) {
      if (iface.family !== "IPv4" || iface.internal) continue;
      if (!isPrivateHostname(iface.address)) continue;
      found.push({ address: iface.address, rank: reachabilityRank(name, iface.address) });
    }
  }
  // Stable within a rank, so identical hardware keeps a predictable order.
  return found.sort((a, b) => a.rank - b.rank).map((f) => f.address);
}

/** Exported for the test; the ranking is the part worth pinning down. */
export const __rankForTest = reachabilityRank;

/** Is this bind address reachable from other machines? */
export function isExposed(host: string): boolean {
  return host === "0.0.0.0" || host === "::" || host === "";
}
