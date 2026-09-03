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
  it("puts the protocol header on a read", async () => {
    const { api } = await import("../src/lib/api.js");
    seen = [];
    await api.dashboard();
    assert.equal(lastHeaders()[PROTOCOL_HEADER], String(PROTOCOL_VERSION));
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
 * Exactly one, and it is not talking to Life OS: `image-cache.ts` fetches
 * agent-supplied pictures from whatever host they live on, to put them in Cache
 * Storage. Sending our `Authorization` and `X-LifeOS-Protocol` headers to a
 * stranger's image host would leak the token and trip CORS, so it must not use
 * the client. The rule below still holds it to that.
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
     * this file ever calls a Life OS endpoint it is doing so without the
     * protocol header, which is precisely the bug the rule above exists for.
     */
    for (const rel of FETCH_EXEMPT) {
      const source = fs.readFileSync(path.join(SRC, rel), "utf8");
      assert.ok(
        !source.includes("/api/v1"),
        `${rel} is exempt from the fetch rule but is calling the Life OS API`,
      );
    }
  });
});
