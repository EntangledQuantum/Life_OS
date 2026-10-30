import { useEffect, useState } from "react";
import { fetchAsset, isAssetUrl } from "./api";

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
 *
 * ## Two kinds of URL
 *
 * Since protocol 4 the artwork is not inline base64 any more: the server holds
 * each picture content-addressed and sends a URL for it. Those URLs are *ours*
 * and they need the bearer token, because the art is the user's own and the
 * instance may be on a public tunnel. An `<img src>` cannot carry a header, so
 * they are fetched here and handed to the browser as an object URL.
 *
 * An `*ImageUrl` an agent set to some other host is untouched and must stay
 * that way: sending our `Authorization` to a stranger's image host would leak
 * the token. `isAssetUrl` decides which is which, and it lives in `api.ts`
 * rather than here so that no path of a Life OS endpoint is written outside
 * that module — see the rule in `test/api-client.test.ts`.
 *
 * The cache earns more than it did, too. These URLs are immutable for a year
 * and a hash cannot describe different bytes, so a picture crosses the network
 * exactly once per device, ever. Nothing here may add a cache-buster to one.
 */
const CACHE_NAME = "lifeos-art-v2";

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
         * One of ours gets the token and a readable response. Anyone else's
         * gets `no-cors` so a picture on a host with no CORS headers still
         * caches — that response is opaque, which was fine while it only ever
         * went into an `<img>` with the raw URL as its fallback.
         */
        const fetched = isAssetUrl(src)
          ? await fetchAsset(src)
          : await fetch(src, { mode: "no-cors" });
        if (isAssetUrl(src) && !fetched.ok) return null;
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
 * For a `data:` URI or a third-party link it returns the input immediately and
 * upgrades to the cached copy when it lands, so nothing waits on the cache and
 * nothing breaks without it.
 *
 * One of our own asset URLs is the exception, and it has to be: it needs the
 * bearer token, and an `<img src>` cannot send one — handing the raw URL to the
 * browser would draw a broken-image icon rather than a picture. So it returns
 * `null` until the object URL exists, which renders as no picture for a moment
 * on the very first view of a given image on a given device. After that the
 * module map answers without a fetch, and Cache Storage answers across reloads.
 *
 * That first moment is the honest cost of taking 2.21 MB of base64 out of every
 * poll, and it is paid once per picture, ever.
 */
export function useCachedImage(src: string | null | undefined): string | null {
  const [resolved, setResolved] = useState<string | null>(() => initial(src));

  useEffect(() => {
    if (!src) {
      setResolved(null);
      return;
    }
    setResolved(initial(src));
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
 * What to draw before the cache has answered.
 *
 * An already-resolved object URL if we have one — which is the common case
 * after the first look, and the reason this is checked synchronously rather
 * than waiting a frame for the effect. Otherwise the URL itself, unless it is
 * one of ours, which would 401 in an `<img>`.
 */
function initial(src: string | null | undefined): string | null {
  if (!src) return null;
  const cached = objectUrls.get(src);
  if (cached) return cached;
  return isAssetUrl(src) ? null : src;
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
