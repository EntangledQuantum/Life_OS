import { useEffect, useState } from "react";

/**
 * Agent art, kept on the device after the first look.
 *
 * A habit's background or a tier's medallion is set once and then shown on
 * every dashboard poll for months. Left to the ordinary flow that is a
 * conditional request per image per reload, and on a laptop that has wandered
 * off the network it is a row of broken pictures — in an app whose whole claim
 * is that it works without anything remote.
 *
 * So a remote image is fetched once and put in the Cache Storage API, which is
 * persistent, origin-scoped, and does not need a service worker to use. After
 * that it is served from disk and the network is never asked again.
 *
 * Three things it deliberately does not do:
 *
 * - **`data:` URIs pass straight through.** They are already local; copying
 *   them into a cache would double the storage to save nothing.
 * - **It never blocks the render.** The raw URL is returned immediately and
 *   swapped for the cached copy when there is one, so a cold cache draws the
 *   picture at exactly the speed it would have anyway.
 * - **It never throws.** Cache Storage is unavailable in some privacy modes and
 *   quota-limited in all of them. Every failure falls back to the plain URL,
 *   which is what the browser would have done unaided.
 */
const CACHE_NAME = "lifeos-art-v1";

/** Object URLs live as long as the document; one per source, reused. */
const objectUrls = new Map<string, string>();
const inFlight = new Map<string, Promise<string | null>>();

function isRemote(src: string): boolean {
  return /^https?:\/\//i.test(src);
}

async function fromCache(src: string): Promise<string | null> {
  if (typeof caches === "undefined") return null;
  const existing = objectUrls.get(src);
  if (existing) return existing;

  const pending = inFlight.get(src);
  if (pending) return pending;

  const work = (async () => {
    try {
      const cache = await caches.open(CACHE_NAME);
      let response = await cache.match(src);
      if (!response) {
        /*
         * `no-cors` so a picture on a host with no CORS headers still caches —
         * the response is opaque, which is fine: it is only ever going into an
         * <img>, never read as bytes.
         */
        const fetched = await fetch(src, { mode: "no-cors" });
        await cache.put(src, fetched.clone());
        response = fetched;
      }
      const blob = await response.blob();
      // An opaque response has a zero-length body we cannot turn into a blob.
      if (blob.size === 0) return null;
      const url = URL.createObjectURL(blob);
      objectUrls.set(src, url);
      return url;
    } catch {
      return null; // offline, blocked, or over quota — the plain URL still works
    } finally {
      inFlight.delete(src);
    }
  })();

  inFlight.set(src, work);
  return work;
}

/**
 * The best source available right now for one image.
 *
 * Returns the input immediately and upgrades to the cached copy when it lands,
 * so nothing waits on the cache and nothing breaks without it.
 */
export function useCachedImage(src: string | null | undefined): string | null {
  const [resolved, setResolved] = useState<string | null>(src ?? null);

  useEffect(() => {
    if (!src) {
      setResolved(null);
      return;
    }
    setResolved(src);
    if (!isRemote(src)) return;

    let alive = true;
    void fromCache(src).then((url) => {
      if (alive && url) setResolved(url);
    });
    return () => {
      alive = false;
    };
  }, [src]);

  return resolved;
}

/**
 * Warm the cache for art we know is coming.
 *
 * Called with the whole dashboard's images once it loads, so a goal's tier
 * medallion is already on disk before the condition comes true and the
 * celebration needs it full-screen. Fire and forget.
 */
export function prefetchImages(sources: (string | null | undefined)[]): void {
  for (const src of sources) {
    if (src && isRemote(src)) void fromCache(src);
  }
}
