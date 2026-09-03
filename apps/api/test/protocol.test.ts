import { strict as assert } from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { PROTOCOL_HEADER, PROTOCOL_VERSION } from "@life-os/shared";

/**
 * The other half of the growth-meter bug.
 *
 * A client that omits `X-LifeOS-Protocol` gets 426, on every `/api/v1` route
 * and not just the ones anyone happened to try. That is deliberate — the
 * payload shape changed and an old client would render an empty day rather
 * than an error — but it means the rule has to hold uniformly. When it holds
 * everywhere, a request that skips the client fails immediately and loudly. A
 * route that quietly exempted itself would let a hand-built request work in
 * development and break later, which is the harder bug by far.
 *
 * `apps/web/test/api-client.test.ts` covers the client side.
 */

let dir: string;
let app: { fetch: (req: Request) => Response | Promise<Response> };

const TOKEN = "lifeos_test_token_for_protocol_checks_00001";

before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "lifeos-protocol-"));
  process.env.DATABASE_PATH = path.join(dir, "protocol.db");
  // Before the env module loads, or it treats the token as missing and writes
  // a fresh one into the developer's real .env.
  process.env.API_TOKEN = TOKEN;
  process.env.TUNNEL = "off";

  const dbmod = await import("@life-os/db");
  dbmod.bootstrapDatabase(process.env.DATABASE_PATH);

  const { createApp } = await import("../src/app.js");
  app = createApp();
});

after(() => {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    /* Windows keeps the SQLite file open; the OS will reap the temp dir */
  }
});

async function call(
  path_: string,
  { method = "GET", body = undefined as unknown, protocol = true } = {},
) {
  const res = await app.fetch(
    new Request(`http://localhost${path_}`, {
      method,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${TOKEN}`,
        ...(protocol ? { [PROTOCOL_HEADER]: String(PROTOCOL_VERSION) } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  );
  return { status: res.status, body: await res.json().catch(() => null) };
}

describe("the growth meter, which is where this was found", () => {
  it("refuses a PATCH with no protocol header", async () => {
    const res = await call("/api/v1/gamification/config", {
      method: "PATCH",
      body: { growthStyle: "bloom" },
      protocol: false,
    });
    assert.equal(res.status, 426);
  });

  it("accepts the same PATCH through the client's headers", async () => {
    const res = await call("/api/v1/gamification/config", {
      method: "PATCH",
      body: { growthStyle: "bloom" },
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.growthStyle, "bloom");
  });

  it("really changed it, rather than answering 200 and doing nothing", async () => {
    await call("/api/v1/gamification/config", {
      method: "PATCH",
      body: { growthStyle: "constellation" },
    });
    const read = await call("/api/v1/gamification/config");
    assert.equal(read.body.growthStyle, "constellation");
  });
});

describe("the rule holds across the surface", () => {
  /*
   * A representative read and write from each area. If one of these ever
   * answers something other than 426 without the header, the surface has grown
   * an exemption — and an exemption is what lets a hand-built request pass
   * review and fail in production.
   */
  const routes: [string, string][] = [
    ["GET", "/api/v1/dashboard/today"],
    ["GET", "/api/v1/habits"],
    ["GET", "/api/v1/tasks"],
    ["GET", "/api/v1/settings"],
    ["GET", "/api/v1/goals"],
    ["GET", "/api/v1/analytics"],
    ["GET", "/api/v1/gamification/config"],
    ["PATCH", "/api/v1/settings"],
    ["PATCH", "/api/v1/gamification/config"],
    ["POST", "/api/v1/session/active"],
  ];

  for (const [method, path_] of routes) {
    it(`${method} ${path_} is 426 without the header`, async () => {
      const res = await call(path_, {
        method,
        body: method === "GET" ? undefined : {},
        protocol: false,
      });
      assert.equal(res.status, 426, `${method} ${path_} let it through`);
    });
  }

  it("says what to do about it instead of just refusing", async () => {
    const res = await call("/api/v1/habits", { protocol: false });
    assert.equal(res.status, 426);
    assert.equal(typeof res.body.error, "string");
    assert.ok(res.body.hint, "a 426 with no hint is a dead end");
  });
});

describe("what is deliberately outside the rule", () => {
  it("/health answers without any headers at all", async () => {
    // A reachability check has to work before a client knows anything.
    const res = await app.fetch(new Request("http://localhost/health"));
    assert.equal(res.status, 200);
  });

  it("/mcp does not require it — MCP negotiates its own version", async () => {
    /*
     * An MCP client has never heard of X-LifeOS-Protocol. Putting /mcp behind
     * this rule would 426 every agent on every call, which is why it is mounted
     * outside /api/v1.
     */
    const res = await app.fetch(
      new Request("http://localhost/mcp", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json, text/event-stream",
          Authorization: `Bearer ${TOKEN}`,
        },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
      }),
    );
    assert.equal(res.status, 200);
  });
});
