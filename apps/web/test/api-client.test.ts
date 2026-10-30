import { strict as assert } from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { after, before, describe, it } from "node:test";
import { PROTOCOL_HEADER, PROTOCOL_VERSION } from "@life-os/shared";

/**
 * Every request the dashboard makes goes through one client, and it stays that
 * way.
 *
 * Switching the growth meter between orb and sprout failed with 426 Upgrade
 * Required — the server telling a client it is too old to read the response.
 * The client was not too old. Those two buttons had assembled their own
 * `fetch`, with Content-Type and Authorization and nothing else, so when the
 * API began requiring `X-LifeOS-Protocol` everything routed through
 * `request()` picked it up and those two did not.
 *
 * The bug was one line in one component, and nothing about that component
 * looked wrong. What makes it recur is the shape: a hand-built request is
 * indistinguishable from a correct one until a header is added months later.
 * So there are two tests here — one that the client sends what the server
 * demands, and one that nothing goes around the client.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(here, "../src");

/* ------------------------------------------------- what the client sends */

interface Seen {
  url: string;
  init: RequestInit;
}

let seen: Seen[] = [];
let realFetch: typeof globalThis.fetch;

before(async () => {
  realFetch = globalThis.fetch;
  globalThis.fetch = (async (url: string, init: RequestInit = {}) => {
    seen.push({ url: String(url), init });
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as unknown as typeof globalThis.fetch;

  // The client reads the token from localStorage, which Node does not have.
  const store = new Map<string, string>([["lifeos_token", "lifeos_test_token"]]);
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  };
});

after(() => {
  globalThis.fetch = realFetch;
});

/** The headers of the last request the client made. */
function lastHeaders(): Record<string, string> {
  const last = seen.at(-1);
  assert.ok(last, "the client made no request at all");
  return (last.init.headers ?? {}) as Record<string, string>;
}

describe("the API client", () => {
  it("puts the protocol header on the one read", async () => {
    /*
     * `GET /dashboard/today` used to be the read and is gone — it returned the
     * whole day, 2.26 MB of it, on every poll. `GET /sync` replaces it, and it
     * has the same obligation: the server refuses anything below protocol 4 at
     * the gate, before a route is reached.
     */
    const { syncRead } = await import("../src/lib/api.js");
    seen = [];
    await syncRead(null, null);
    assert.equal(lastHeaders()[PROTOCOL_HEADER], String(PROTOCOL_VERSION));
  });

  it("puts it on the one write too", async () => {
    const { syncPush } = await import("../src/lib/api.js");
    seen = [];
    await syncPush({ clientId: "test", since: null, mutations: [] });
    assert.equal(lastHeaders()[PROTOCOL_HEADER], String(PROTOCOL_VERSION));
    assert.equal(seen.at(-1)!.init.method, "POST");
  });

  it("puts it on a write too — this is the one that broke", async () => {
    const { api } = await import("../src/lib/api.js");
    seen = [];
    await api.updateGamificationConfig({ growthStyle: "sprout" });

    const last = seen.at(-1)!;
    assert.equal(last.init.method, "PATCH");
    assert.match(last.url, /\/api\/v1\/gamification\/config$/);
    assert.equal(lastHeaders()[PROTOCOL_HEADER], String(PROTOCOL_VERSION));
  });

  it("sends the bearer token, and never a cookie", async () => {
    const { api } = await import("../src/lib/api.js");
    seen = [];
    await api.habits();
    assert.equal(lastHeaders().Authorization, "Bearer lifeos_test_token");
    // A cookie would ride along automatically cross-site, which is the CSRF hole.
    assert.equal(seen.at(-1)!.init.credentials, undefined);
  });

  it("surfaces the server's own error text rather than a generic one", async () => {
    /*
     * The Overview button replaced the 426 body with "Failed to update growth
     * style", so the console had the real reason and the toast had nothing to
     * connect it to. Whatever the server explains has to reach the user.
     */
    const { api } = await import("../src/lib/api.js");
    const saved = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ error: "This app is too old" }), {
        status: 426,
      })) as unknown as typeof globalThis.fetch;

    await assert.rejects(
      () => api.updateGamificationConfig({ growthStyle: "orb" }),
      /This app is too old/,
    );
    globalThis.fetch = saved;
  });
});

/* --------------------------------------------- and nothing goes around it */

/** Every .ts/.tsx file under src, recursively. */
function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return /\.tsx?$/.test(entry.name) ? [full] : [];
  });
}

/**
 * Files allowed to call `fetch` without going through the API client.
 *
 * Exactly one, and only for the half of its job that is not talking to Life OS:
 * `image-cache.ts` fetches agent-supplied pictures from whatever host they live
 * on, to put them in Cache Storage. Sending our `Authorization` and
 * `X-LifeOS-Protocol` headers to a stranger's image host would leak the token
 * and trip CORS, so that path must not use the client.
 *
 * Since protocol 4 it also loads *our* artwork, which is content-addressed and
 * does need the token. That half goes through `fetchAsset` in `api.ts`, and the
 * second test below is what holds the line: the module may not name a Life OS
 * path itself, so the decision about which URLs are ours stays in one place.
 */
const FETCH_EXEMPT = new Set(["lib/image-cache.ts"]);

describe("nothing bypasses the client", () => {
  it("has no hand-built fetch outside lib/api.ts", () => {
    /*
     * This is the test that would have caught the 426 bug. The behavioural ones
     * above pass whether or not a component quietly calls fetch itself — that
     * request simply never reaches them.
     *
     * If this fails: move the call into `api.ts` as a named method. Do not add
     * the header by hand at the call site; that is how the second one appears.
     */
    const offenders = sourceFiles(SRC)
      .filter((file) => path.resolve(file) !== path.resolve(SRC, "lib/api.ts"))
      .map((file) => ({
        rel: path.relative(SRC, file).replace(/\\/g, "/"),
        source: fs.readFileSync(file, "utf8"),
      }))
      .filter(({ rel }) => !FETCH_EXEMPT.has(rel))
      .filter(({ source }) => /(?<![.\w])fetch\s*\(/.test(source))
      .map(({ rel }) => rel);

    assert.deepEqual(
      offenders,
      [],
      `these build their own request and will miss any header added to api.ts:\n  ${offenders.join("\n  ")}`,
    );
  });

  it("keeps the exempt file out of the API", () => {
    /*
     * The exemption is for third-party images, not a way around the client. If
     * this file ever names a Life OS endpoint it is building a request to one
     * without the protocol header, which is precisely the bug the rule above
     * exists for — and it would also be a second place that knows what one of
     * our asset URLs looks like.
     */
    for (const rel of FETCH_EXEMPT) {
      const source = fs.readFileSync(path.join(SRC, rel), "utf8");
      assert.ok(
        !source.includes("/api/v1"),
        `${rel} is exempt from the fetch rule but is calling the Life OS API`,
      );
    }
  });

  it("loads our own artwork with the token on it", async () => {
    /*
     * The art is not inline base64 any more; it is a content-addressed URL on
     * our own server, and that route is authenticated because the instance may
     * be on a public tunnel. An `<img src>` cannot carry a header, so the only
     * thing that makes a picture appear at all is this fetch having the bearer
     * token on it — and nothing on screen says which of the two paths a given
     * URL took.
     */
    const { fetchAsset, isAssetUrl } = await import("../src/lib/api.js");
    seen = [];

    assert.equal(isAssetUrl("http://127.0.0.1:8787/api/v1/assets/abc123"), true);
    // An agent's link to someone else's host must never see our token.
    assert.equal(isAssetUrl("https://images.example.com/cat.jpg"), false);

    await fetchAsset("http://127.0.0.1:8787/api/v1/assets/abc123");
    assert.equal(lastHeaders().Authorization, "Bearer lifeos_test_token");
  });
});
