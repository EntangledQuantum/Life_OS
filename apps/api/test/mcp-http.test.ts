import { strict as assert } from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";

/**
 * MCP over HTTP.
 *
 * The tools were stdio-only, which silently required the agent to share a
 * filesystem with the database. An agent in a container or on another host had
 * no way in and fell back to REST — the apps' surface, shaped for a screen.
 *
 * What these cover is the wiring rather than the tools themselves: that the
 * endpoint is behind the same token, that it speaks the handshake, that the
 * tools are all there, and that a call reaches a real service. The tools have
 * their own tests.
 */

let dir: string;
let app: { fetch: (req: Request) => Response | Promise<Response> };

const TOKEN = "lifeos_test_token_for_the_mcp_endpoint_000001";
const URL_ = "http://localhost/mcp";

before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "lifeos-mcp-"));
  process.env.DATABASE_PATH = path.join(dir, "mcp.db");
  /*
   * Set before the API's env module is imported. It captures whether the token
   * came from the environment, and only writes one back to `.env` when it did
   * not — so a test that forgets this rewrites the developer's real token.
   */
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

/** One JSON-RPC round trip, the way a remote agent would make it. */
async function rpc(
  body: unknown,
  opts: { token?: string | null; method?: string } = {},
) {
  const token = opts.token === undefined ? TOKEN : opts.token;
  const res = await app.fetch(
    new Request(URL_, {
      method: opts.method ?? "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: opts.method === "GET" ? undefined : JSON.stringify(body),
    }),
  );
  const text = await res.text();
  return {
    status: res.status,
    body: text ? (JSON.parse(text) as Record<string, any>) : null,
  };
}

const INITIALIZE = {
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "test", version: "0" },
  },
};

describe("the endpoint", () => {
  it("needs the same token as everything else", async () => {
    const anon = await rpc(INITIALIZE, { token: null });
    assert.equal(anon.status, 401);
  });

  it("refuses a wrong token", async () => {
    const wrong = await rpc(INITIALIZE, { token: "lifeos_not_it" });
    assert.equal(wrong.status, 401);
  });

  it("answers GET with 405 rather than holding a stream open", async () => {
    /*
     * GET is how a client asks for a server-initiated SSE stream. Life OS never
     * pushes anything, so accepting it would mean keeping an open connection
     * and a keep-alive timer per agent to carry messages that do not exist. The
     * spec allows 405, and clients fall back to POST.
     */
    const got = await rpc(null, { method: "GET" });
    assert.equal(got.status, 405);
  });

  it("is not behind the dashboard's protocol negotiation", async () => {
    /*
     * `/api/v1` rejects a client that does not send X-LifeOS-Protocol, because
     * the dashboard payload changed shape. An MCP client has never heard of
     * that header and would get a 426 for every call, so `/mcp` is mounted
     * outside it — this request deliberately sends no such header.
     */
    const hello = await rpc(INITIALIZE);
    assert.equal(hello.status, 200);
    assert.equal(hello.body?.result?.serverInfo?.name, "life-os");
  });
});

describe("the tools", () => {
  it("are all reachable over HTTP, not a subset", async () => {
    const list = await rpc({ jsonrpc: "2.0", id: 2, method: "tools/list" });
    const names: string[] = (list.body?.result?.tools ?? []).map(
      (t: { name: string }) => t.name,
    );
    assert.ok(names.length > 40, `expected the full table, got ${names.length}`);
    // The agent-shaped ones are the reason this transport exists.
    for (const name of [
      "lifeos_get_day",
      "lifeos_get_range",
      "lifeos_search_history",
      "lifeos_bulk_create_tasks",
    ]) {
      assert.ok(names.includes(name), `missing ${name}`);
    }
  });

  it("actually run — a call reaches the service and comes back summarised", async () => {
    const call = await rpc({
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: { name: "lifeos_get_day", arguments: {} },
    });
    assert.equal(call.status, 200);
    const text = call.body?.result?.content?.[0]?.text as string;
    const day = JSON.parse(text);
    assert.match(day.date, /^\d{4}-\d{2}-\d{2}$/);
    assert.equal(typeof day.story, "string");
  });

  it("reports a bad tool name as an error, not a crash", async () => {
    const call = await rpc({
      jsonrpc: "2.0",
      id: 4,
      method: "tools/call",
      params: { name: "lifeos_no_such_tool", arguments: {} },
    });
    assert.equal(call.status, 200);
    assert.equal(call.body?.result?.isError, true);
  });
});
