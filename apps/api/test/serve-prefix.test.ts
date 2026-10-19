import { strict as assert } from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { Hono } from "hono";
import {
  forwardedBaseUrl,
  normalizePublicPath,
  readForwardedPrefix,
  stripPathPrefix,
} from "../src/prefix.js";
import { renderIndexHtml, webAppHandler } from "../src/static.js";

/**
 * One build, served at the root locally and at `/lifeos/` behind the gateway.
 * The prefix only ever comes from `X-Forwarded-Prefix`, per request.
 */

const INDEX = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <link rel="icon" type="image/png" href="./icon.png?v=3" />
    <script type="module" crossorigin src="./assets/index-abc.js"></script>
    <link rel="stylesheet" crossorigin href="./assets/index-abc.css">
    <link rel="preconnect" href="https://fonts.example.com">
  </head>
  <body><div id="root"></div></body>
</html>`;

describe("prefix helpers", () => {
  it("normalizes a public path", () => {
    assert.equal(normalizePublicPath("lifeos"), "/lifeos");
    assert.equal(normalizePublicPath(" /lifeos/ "), "/lifeos");
    assert.equal(normalizePublicPath("/"), "");
    assert.equal(normalizePublicPath(undefined), "");
  });

  it("accepts a plain forwarded prefix and rejects anything else", () => {
    assert.equal(readForwardedPrefix("/lifeos"), "/lifeos");
    assert.equal(readForwardedPrefix("/lifeos/"), "/lifeos");
    assert.equal(readForwardedPrefix("/lifeos, /outer"), "/lifeos");
    assert.equal(readForwardedPrefix(null), "");
    assert.equal(readForwardedPrefix('/x"><script>'), "");
    assert.equal(readForwardedPrefix("/.."), "");
  });

  it("strips the prefix only on a segment boundary", () => {
    assert.equal(stripPathPrefix("/lifeos/api/v1/x", "/lifeos"), "/api/v1/x");
    assert.equal(stripPathPrefix("/lifeos", "/lifeos"), "/");
    assert.equal(stripPathPrefix("/lifeosx/a", "/lifeos"), "/lifeosx/a");
    assert.equal(stripPathPrefix("/api/v1/x", "/lifeos"), "/api/v1/x");
    assert.equal(stripPathPrefix("/api/v1/x", ""), "/api/v1/x");
  });

  it("rebuilds the public base URL from the gateway's headers", () => {
    const headers = new Headers({
      "x-forwarded-host": "sunny.tailf9037f.ts.net",
      "x-forwarded-proto": "https",
      "x-forwarded-prefix": "/lifeos",
    });
    assert.equal(forwardedBaseUrl(headers), "https://sunny.tailf9037f.ts.net/lifeos");
    assert.equal(forwardedBaseUrl(new Headers()), null);
    assert.equal(
      forwardedBaseUrl(new Headers({ "x-forwarded-host": "evil/<x>" })),
      null,
    );
  });
});

describe("renderIndexHtml", () => {
  it("points relative references at the prefix and announces it", () => {
    const html = renderIndexHtml(INDEX, "/lifeos");
    assert.match(html, /src="\/lifeos\/assets\/index-abc\.js"/);
    assert.match(html, /href="\/lifeos\/assets\/index-abc\.css"/);
    assert.match(html, /href="\/lifeos\/icon\.png\?v=3"/);
    assert.match(html, /<meta name="lifeos-base" content="\/lifeos" \/>/);
    assert.match(html, /href="https:\/\/fonts\.example\.com"/);
  });

  it("makes them root-absolute with no prefix", () => {
    const html = renderIndexHtml(INDEX, "");
    assert.match(html, /src="\/assets\/index-abc\.js"/);
    assert.match(html, /<meta name="lifeos-base" content="" \/>/);
  });
});

describe("webAppHandler", () => {
  let dir: string;
  let app: Hono;

  before(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "lifeos-dist-"));
    fs.mkdirSync(path.join(dir, "assets"));
    fs.writeFileSync(path.join(dir, "index.html"), INDEX);
    fs.writeFileSync(path.join(dir, "assets", "index-abc.js"), "export {};");
    fs.writeFileSync(path.join(dir, "icon.png"), Buffer.from([0x89, 0x50]));
    app = new Hono();
    app.get("/api/v1/real", (c) => c.json({ ok: true }));
    app.get("*", webAppHandler(dir));
  });

  after(() => fs.rmSync(dir, { recursive: true, force: true }));

  it("serves hashed assets with a long cache", async () => {
    const res = await app.request("/assets/index-abc.js");
    assert.equal(res.status, 200);
    assert.match(res.headers.get("content-type") ?? "", /javascript/);
    assert.match(res.headers.get("cache-control") ?? "", /immutable/);
  });

  it("falls back to index.html for app routes, under the forwarded prefix", async () => {
    const res = await app.request("/app/goals", {
      headers: { "X-Forwarded-Prefix": "/lifeos" },
    });
    assert.equal(res.status, 200);
    const body = await res.text();
    assert.match(body, /content="\/lifeos"/);
    assert.match(body, /src="\/lifeos\/assets\/index-abc\.js"/);
    assert.equal(res.headers.get("cache-control"), "no-cache");
  });

  it("never answers an API path with the SPA", async () => {
    for (const p of ["/api/v1/nope", "/api", "/mcp", "/health"]) {
      const res = await app.request(p);
      assert.equal(res.status, 404, p);
      assert.match(res.headers.get("content-type") ?? "", /json/, p);
    }
    assert.equal((await app.request("/api/v1/real")).status, 200);
  });

  it("404s a missing file instead of serving HTML as script", async () => {
    const res = await app.request("/assets/gone-123.js");
    assert.equal(res.status, 404);
  });

  it("does not escape the dist directory", async () => {
    const res = await app.request("/..%2f..%2fpackage.json");
    assert.notEqual(res.status, 200);
  });
});
