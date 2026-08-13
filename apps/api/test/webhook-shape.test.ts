import { strict as assert } from "node:assert";
import { createHmac } from "node:crypto";
import { describe, it } from "node:test";
import type { WebhookPayload } from "@life-os/shared";
import { buildRequest, describe as describeEvent, hermesSignature } from "../src/services/webhook.js";

/**
 * The wire format each agent actually accepts.
 *
 * These are transcriptions of the two vendors' documented contracts, so if
 * someone "simplifies" the delivery code the break shows up here rather than as
 * a silent 401 nobody reads.
 */

const payload: WebhookPayload = {
  source: "life-os",
  event: "habit.complete",
  deliveryId: "abc123",
  ts: "2026-08-14T19:00:00.000Z",
  data: { name: "Wake window", xpAwarded: 12 },
};

describe("hermes preset", () => {
  it("signs <timestamp>.<body>, not the body alone", () => {
    // Signing the body alone is Hermes' V1 scheme and has no replay protection:
    // a captured request stays valid forever. V2 folds the timestamp in and the
    // receiver rejects anything outside ±300s.
    const { body, headers } = buildRequest("hermes", "s3cret", payload);
    const ts = headers["X-Webhook-Timestamp"];
    assert.ok(ts, "timestamp header must be present");

    const expected = createHmac("sha256", "s3cret").update(`${ts}.${body}`).digest("hex");
    assert.equal(headers["X-Webhook-Signature-V2"], expected);

    const bodyOnly = createHmac("sha256", "s3cret").update(body).digest("hex");
    assert.notEqual(headers["X-Webhook-Signature-V2"], bodyOnly);
  });

  it("sends the timestamp in seconds, which is what the ±300s window compares", () => {
    const { headers } = buildRequest("hermes", "s3cret", payload);
    const ts = Number(headers["X-Webhook-Timestamp"]);
    assert.equal(ts, Math.floor(Date.parse(payload.ts) / 1000));
    // Milliseconds here would be ~1.7e12 and always outside the window.
    assert.ok(ts < 1e11, "timestamp must be seconds, not milliseconds");
  });

  it("sends the payload itself as the body", () => {
    const { body } = buildRequest("hermes", "s3cret", payload);
    assert.deepEqual(JSON.parse(body), payload);
  });

  it("omits the signature when there is no secret rather than sending a bogus one", () => {
    const { headers } = buildRequest("hermes", null, payload);
    assert.equal(headers["X-Webhook-Signature-V2"], undefined);
  });
});

describe("openclaw preset", () => {
  it("authenticates with a bearer token", () => {
    const { headers } = buildRequest("openclaw", "hooks-token", payload);
    assert.equal(headers.Authorization, "Bearer hooks-token");
  });

  it("shapes the body for /hooks/wake and keeps the structured payload", () => {
    const { body } = buildRequest("openclaw", "hooks-token", payload);
    const parsed = JSON.parse(body);
    assert.equal(typeof parsed.text, "string");
    assert.equal(parsed.mode, "now");
    assert.deepEqual(parsed.lifeos, payload);
  });

  it("never puts the token in the body or the URL", () => {
    const { body } = buildRequest("openclaw", "hooks-token", payload);
    assert.ok(!body.includes("hooks-token"));
  });
});

describe("generic preset", () => {
  it("uses the shared-secret header", () => {
    const { headers } = buildRequest("generic", "shh", payload);
    assert.equal(headers["X-LifeOS-Secret"], "shh");
  });
});

describe("every preset", () => {
  for (const preset of ["hermes", "openclaw", "generic"] as const) {
    it(`${preset} carries the delivery id, which is what makes retrying safe`, () => {
      const { headers } = buildRequest(preset, "k", payload);
      assert.equal(headers["X-Request-ID"], "abc123");
      assert.equal(headers["X-LifeOS-Event"], "habit.complete");
    });
  }
});

describe("describe()", () => {
  it("says what happened in one readable line", () => {
    assert.match(describeEvent(payload), /Wake window/);
    assert.match(
      describeEvent({ ...payload, event: "goal.achieved", data: { title: "Read 12 books" } }),
      /goal "Read 12 books" achieved/,
    );
  });

  it("degrades gracefully on an event it has no wording for", () => {
    const out = describeEvent({ ...payload, event: "future.thing", data: {} });
    assert.match(out, /future\.thing/);
  });
});

describe("hermesSignature", () => {
  it("is stable and hex", () => {
    const sig = hermesSignature("key", "1755196800", "{}");
    assert.match(sig, /^[0-9a-f]{64}$/);
    assert.equal(sig, hermesSignature("key", "1755196800", "{}"));
  });

  it("changes when any part changes", () => {
    const base = hermesSignature("key", "1755196800", "{}");
    assert.notEqual(base, hermesSignature("key2", "1755196800", "{}"));
    assert.notEqual(base, hermesSignature("key", "1755196801", "{}"));
    assert.notEqual(base, hermesSignature("key", "1755196800", "{ }"));
  });
});
