import { strict as assert } from "node:assert";
import { createHmac } from "node:crypto";
import { createServer, type Server } from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { eq } from "drizzle-orm";

/**
 * Delivery end to end, against a real HTTP server.
 *
 * The point is the things a unit test of `buildRequest` cannot show: that the
 * signature a receiver computes from the bytes on the wire matches the one we
 * sent, that a failure is recorded rather than swallowed, and that a target
 * which did not subscribe to an event hears nothing.
 */

interface Received {
  headers: Record<string, string | string[] | undefined>;
  raw: string;
  body: unknown;
}

let sink: Server;
let port: number;
let received: Received[] = [];
/** Status the sink returns next, so a failure can be simulated. */
let nextStatus = 200;

let dir: string;
let db: import("@life-os/db").LifeOsDb;
let schema: typeof import("@life-os/db");
let webhook: typeof import("../src/services/webhook.js");

before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "lifeos-webhook-"));
  process.env.DATABASE_PATH = path.join(dir, "wh.db");

  const dbmod = await import("@life-os/db");
  dbmod.bootstrapDatabase(process.env.DATABASE_PATH);
  db = dbmod.getDb();
  schema = dbmod;
  webhook = await import("../src/services/webhook.js");

  sink = createServer((req, res) => {
    let raw = "";
    req.on("data", (chunk) => (raw += chunk));
    req.on("end", () => {
      let body: unknown;
      try {
        body = JSON.parse(raw);
      } catch {
        body = raw;
      }
      received.push({ headers: req.headers, raw, body });
      res.writeHead(nextStatus, { "Content-Type": "application/json" });
      res.end("{}");
    });
  });

  await new Promise<void>((resolve) => {
    sink.listen(0, "127.0.0.1", () => {
      port = (sink.address() as { port: number }).port;
      resolve();
    });
  });
});

after(async () => {
  await new Promise<void>((resolve) => sink.close(() => resolve()));
  // Windows will not unlink a file SQLite still has open, and the temp dir is
  // the OS's to reap anyway — a cleanup failure must not fail the suite.
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    /* the OS will get it */
  }
});

function reset() {
  received = [];
  nextStatus = 200;
  for (const t of webhook.listWebhookTargets(db)) {
    webhook.deleteWebhookTarget(db, t.id);
  }
}

/*
 * Read the secret straight out of the row. The service deliberately offers no
 * way to get it back, so proving a refused patch left it alone means going
 * around the service rather than through it.
 */
function storedSecret(id: string): string | null {
  const row = db
    .select({ secret: schema.webhookTargets.secret })
    .from(schema.webhookTargets)
    .where(eq(schema.webhookTargets.id, id))
    .get();
  return row?.secret ?? null;
}

/** Create a target the tests expect to succeed, and hand back its id. */
function makeTarget(input: Parameters<typeof webhook.createWebhookTarget>[1]): string {
  const out = webhook.createWebhookTarget(db, input);
  assert.ok(!("error" in out), `setup target was refused: ${JSON.stringify(out)}`);
  return (out as { id: string }).id;
}

describe("hermes delivery", () => {
  it("arrives with a signature the receiver can independently verify", async () => {
    reset();
    const target = webhook.createWebhookTarget(db, {
      name: "Hermes",
      preset: "hermes",
      url: `http://127.0.0.1:${port}/webhooks/lifeos`,
      secret: "route-secret",
    });
    assert.ok(!("error" in target));

    const result = await webhook.fireAgentWebhook(db, "habit.complete", {
      name: "Wake window",
    });
    assert.equal(result.delivered, 1);
    assert.equal(received.length, 1);

    // Verify exactly the way Hermes does: recompute from the received bytes.
    const got = received[0]!;
    const ts = got.headers["x-webhook-timestamp"] as string;
    const sig = got.headers["x-webhook-signature-v2"] as string;
    const expected = createHmac("sha256", "route-secret")
      .update(`${ts}.${got.raw}`)
      .digest("hex");
    assert.equal(sig, expected, "signature must verify against the raw body");
  });

  it("sends a timestamp inside the ±300s replay window", async () => {
    const ts = Number(received[0]!.headers["x-webhook-timestamp"]);
    const skew = Math.abs(Math.floor(Date.now() / 1000) - ts);
    assert.ok(skew < 300, `timestamp skew ${skew}s would be rejected`);
  });
});

describe("openclaw delivery", () => {
  it("arrives with a bearer token and a /hooks/wake body", async () => {
    reset();
    webhook.createWebhookTarget(db, {
      name: "OpenClaw",
      preset: "openclaw",
      url: `http://127.0.0.1:${port}/hooks/wake`,
      secret: "hooks-token",
    });

    await webhook.fireAgentWebhook(db, "card.complete", { title: "Read a chapter" });

    const got = received[0]!;
    assert.equal(got.headers.authorization, "Bearer hooks-token");
    const body = got.body as { text: string; mode: string; lifeos: unknown };
    assert.equal(body.mode, "now");
    assert.match(body.text, /Read a chapter/);
    assert.ok(body.lifeos, "the structured payload must ride along");
  });
});

describe("subscriptions", () => {
  it("only sends the events a target asked for", async () => {
    reset();
    webhook.createWebhookTarget(db, {
      name: "Goals only",
      preset: "generic",
      url: `http://127.0.0.1:${port}/hook`,
      events: ["goal.achieved"],
    });

    await webhook.fireAgentWebhook(db, "habit.complete", { name: "Read" });
    assert.equal(received.length, 0, "an unsubscribed event must not be sent");

    await webhook.fireAgentWebhook(db, "goal.achieved", { title: "Read 12 books" });
    assert.equal(received.length, 1);
  });

  it("an empty subscription list means everything", async () => {
    reset();
    webhook.createWebhookTarget(db, {
      name: "All",
      preset: "generic",
      url: `http://127.0.0.1:${port}/hook`,
    });
    await webhook.fireAgentWebhook(db, "habit.complete", { name: "Read" });
    await webhook.fireAgentWebhook(db, "goal.achieved", { title: "x" });
    assert.equal(received.length, 2);
  });

  it("skips an inactive target without deleting it", async () => {
    reset();
    const t = webhook.createWebhookTarget(db, {
      name: "Paused",
      preset: "generic",
      url: `http://127.0.0.1:${port}/hook`,
    });
    assert.ok(!("error" in t));
    webhook.updateWebhookTarget(db, (t as { id: string }).id, { active: false });

    await webhook.fireAgentWebhook(db, "habit.complete", { name: "Read" });
    assert.equal(received.length, 0);
    assert.equal(webhook.listWebhookTargets(db).length, 1);
  });
});

describe("failures", () => {
  it("records a rejection instead of swallowing it", async () => {
    reset();
    webhook.createWebhookTarget(db, {
      name: "Grumpy",
      preset: "generic",
      url: `http://127.0.0.1:${port}/hook`,
    });
    nextStatus = 500;

    const result = await webhook.fireAgentWebhook(db, "habit.complete", { name: "x" });
    assert.equal(result.delivered, 0);

    const deliveries = webhook.listWebhookDeliveries(db, 5);
    const failed = deliveries.find((d) => d.status === "failed");
    assert.ok(failed, "a failed delivery must be recorded");
    assert.equal(failed.responseStatus, 500);
    nextStatus = 200;
  });

  it("a completion still succeeds when the agent is unreachable", async () => {
    reset();
    webhook.createWebhookTarget(db, {
      name: "Offline",
      preset: "generic",
      // Port 1 is reserved and refuses instantly — no waiting on a timeout.
      url: "http://127.0.0.1:1/hook",
    });

    const result = await webhook.fireAgentWebhook(db, "habit.complete", { name: "x" });
    assert.equal(result.sent, false);
    assert.equal(result.attempted, 1);
    assert.ok(result.results[0]?.error, "the error must be reported, not thrown");
  });
});

describe("target validation", () => {
  it("refuses a signed preset with no secret, rather than 401ing forever", async () => {
    reset();
    const out = webhook.createWebhookTarget(db, {
      name: "Hermes",
      preset: "hermes",
      url: `http://127.0.0.1:${port}/webhooks/x`,
    });
    assert.ok("error" in out);
    assert.match((out as { error: string }).error, /secret/i);
  });

  it("refuses a non-http url", async () => {
    reset();
    const out = webhook.createWebhookTarget(db, {
      name: "Bad",
      preset: "generic",
      url: "file:///etc/passwd",
    });
    assert.ok("error" in out);
  });

  it("never returns the secret", async () => {
    reset();
    webhook.createWebhookTarget(db, {
      name: "Secretive",
      preset: "generic",
      url: `http://127.0.0.1:${port}/hook`,
      secret: "do-not-leak",
    });
    const listed = JSON.stringify(webhook.listWebhookTargets(db));
    assert.ok(!listed.includes("do-not-leak"), "secrets must not leave the server");
    assert.match(listed, /"secretSet":true/);
  });
});

/*
 * The same rule on the way in through a patch.
 *
 * Create refuses a signed preset with no secret because every delivery to it
 * would 401. A patch could reach that state by a different door — clearing the
 * secret, moving onto a signed preset, or both at once — and a 200 for a target
 * that can never deliver is the failure this whole module exists to prevent.
 */
describe("patch validation", () => {
  /** Create's own refusal for the preset, so the tests cannot drift from it. */
  function createRefusal(preset: "hermes" | "openclaw"): string {
    const out = webhook.createWebhookTarget(db, {
      name: preset,
      preset,
      url: `http://127.0.0.1:${port}/hook`,
    });
    assert.ok("error" in out, "create must refuse a signed preset with no secret");
    return (out as { error: string }).error;
  }

  it("refuses to clear the secret on a signed preset", () => {
    reset();
    const id = makeTarget({
      name: "Hermes",
      preset: "hermes",
      url: `http://127.0.0.1:${port}/webhooks/lifeos`,
      secret: "route-secret",
    });

    const out = webhook.updateWebhookTarget(db, id, { secret: "" });
    assert.ok("error" in out, "clearing a hermes secret must be refused");
    assert.equal(storedSecret(id), "route-secret", "the stored secret must survive");
    assert.equal(webhook.getWebhookTarget(db, id)?.secretSet, true);
  });

  it("treats a null secret as clearing it, and refuses that too", () => {
    reset();
    const id = makeTarget({
      name: "OpenClaw",
      preset: "openclaw",
      url: `http://127.0.0.1:${port}/hooks/wake`,
      secret: "hooks-token",
    });

    const out = webhook.updateWebhookTarget(db, id, { secret: null });
    assert.ok("error" in out, "a null secret is still a cleared secret");
    assert.equal(storedSecret(id), "hooks-token");
  });

  it("refuses to move a secretless target onto a signed preset", () => {
    reset();
    const id = makeTarget({
      name: "Plain",
      preset: "generic",
      url: `http://127.0.0.1:${port}/hook`,
    });

    const out = webhook.updateWebhookTarget(db, id, { preset: "hermes" });
    assert.ok("error" in out, "a secretless generic must not become hermes");
    assert.equal(
      webhook.getWebhookTarget(db, id)?.preset,
      "generic",
      "the refused preset must not be written",
    );
  });

  it("refuses a preset switch and a secret clear in the same patch", () => {
    reset();
    const id = makeTarget({
      name: "Plain",
      preset: "generic",
      url: `http://127.0.0.1:${port}/hook`,
      secret: "generic-secret",
    });

    // Neither half is broken on its own: the target has a secret, and a signed
    // preset is fine with one. Only the two together leave it unable to deliver.
    const out = webhook.updateWebhookTarget(db, id, { preset: "hermes", secret: "" });
    assert.ok("error" in out, "the pair must be judged together, not one at a time");
    assert.equal(storedSecret(id), "generic-secret");
    assert.equal(webhook.getWebhookTarget(db, id)?.preset, "generic");
  });

  it("gives the refusal create gives, word for word", () => {
    reset();
    const hermesId = makeTarget({
      name: "Hermes",
      preset: "hermes",
      url: `http://127.0.0.1:${port}/webhooks/lifeos`,
      secret: "route-secret",
    });
    const openclawId = makeTarget({
      name: "OpenClaw",
      preset: "openclaw",
      url: `http://127.0.0.1:${port}/hooks/wake`,
      secret: "hooks-token",
    });

    const hermes = webhook.updateWebhookTarget(db, hermesId, { secret: "" });
    const openclaw = webhook.updateWebhookTarget(db, openclawId, { secret: "" });
    assert.ok("error" in hermes);
    assert.ok("error" in openclaw);
    assert.equal((hermes as { error: string }).error, createRefusal("hermes"));
    assert.equal((openclaw as { error: string }).error, createRefusal("openclaw"));
  });

  it("leaves every other field of a refused patch unapplied", () => {
    reset();
    const id = makeTarget({
      name: "Hermes",
      preset: "hermes",
      url: `http://127.0.0.1:${port}/webhooks/lifeos`,
      secret: "route-secret",
      events: ["goal.achieved"],
    });

    const out = webhook.updateWebhookTarget(db, id, {
      name: "Renamed",
      url: "http://127.0.0.1:9/elsewhere",
      events: ["habit.complete"],
      active: false,
      secret: "",
    });
    assert.ok("error" in out);

    const after = webhook.getWebhookTarget(db, id)!;
    assert.equal(after.name, "Hermes", "a refused patch must not rename");
    assert.match(after.url, /webhooks\/lifeos$/, "a refused patch must not re-point");
    assert.deepEqual(after.events, ["goal.achieved"]);
    assert.equal(after.active, true);
    assert.equal(storedSecret(id), "route-secret");
  });

  it("leaves hermes signing with the original secret after a refusal", async () => {
    reset();
    const id = makeTarget({
      name: "Hermes",
      preset: "hermes",
      url: `http://127.0.0.1:${port}/webhooks/lifeos`,
      secret: "route-secret",
    });

    assert.ok("error" in webhook.updateWebhookTarget(db, id, { secret: "" }));

    // The strongest proof the secret is intact: a real delivery still verifies.
    const result = await webhook.fireAgentWebhook(db, "habit.complete", {
      name: "Wake window",
    });
    assert.equal(result.delivered, 1);
    const got = received[0]!;
    const ts = got.headers["x-webhook-timestamp"] as string;
    const expected = createHmac("sha256", "route-secret")
      .update(`${ts}.${got.raw}`)
      .digest("hex");
    assert.equal(got.headers["x-webhook-signature-v2"], expected);
  });

  it("allows dropping to generic and clearing the secret at once", () => {
    reset();
    const id = makeTarget({
      name: "Hermes",
      preset: "hermes",
      url: `http://127.0.0.1:${port}/webhooks/lifeos`,
      secret: "route-secret",
    });

    // Generic needs no secret, so this is a legitimate target, not a broken one.
    const out = webhook.updateWebhookTarget(db, id, { preset: "generic", secret: "" });
    assert.ok(!("error" in out), `a generic target needs no secret: ${JSON.stringify(out)}`);
    assert.equal((out as { preset: string }).preset, "generic");
    assert.equal(storedSecret(id), null);
  });

  it("allows replacing one secret with another", () => {
    reset();
    const id = makeTarget({
      name: "Hermes",
      preset: "hermes",
      url: `http://127.0.0.1:${port}/webhooks/lifeos`,
      secret: "old-secret",
    });

    const out = webhook.updateWebhookTarget(db, id, { secret: "new-secret" });
    assert.ok(!("error" in out));
    assert.equal(storedSecret(id), "new-secret");
  });

  it("allows a signed preset and its secret arriving together", () => {
    reset();
    const id = makeTarget({
      name: "Plain",
      preset: "generic",
      url: `http://127.0.0.1:${port}/hook`,
    });

    const out = webhook.updateWebhookTarget(db, id, {
      preset: "openclaw",
      secret: "hooks-token",
    });
    assert.ok(!("error" in out), "the patch supplies the secret it needs");
    assert.equal((out as { preset: string }).preset, "openclaw");
  });

  it("still leaves an untouched secret alone on an unrelated patch", () => {
    reset();
    const id = makeTarget({
      name: "Hermes",
      preset: "hermes",
      url: `http://127.0.0.1:${port}/webhooks/lifeos`,
      secret: "route-secret",
    });

    const out = webhook.updateWebhookTarget(db, id, { active: false });
    assert.ok(!("error" in out), "an unrelated patch must not trip the secret check");
    assert.equal(storedSecret(id), "route-secret");
  });
});
