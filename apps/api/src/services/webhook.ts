import { createHmac } from "node:crypto";
import { desc, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import type { LifeOsDb } from "@life-os/db";
import * as schema from "@life-os/db";
import {
  isWebhookPreset,
  type WebhookDelivery,
  type WebhookEvent,
  type WebhookPayload,
  type WebhookPreset,
  type WebhookTarget,
} from "@life-os/shared";
import { nowIso } from "./helpers.js";

/**
 * Delivering completions to whichever agent asked for them.
 *
 * Three things the previous version got wrong, all of which made a broken
 * webhook indistinguishable from an absent one:
 *
 * 1. One global URL, so there was no way to run Hermes and OpenClaw at once, or
 *    to say which agent cared about which event.
 * 2. No signature. Hermes rejects unsigned requests outright (401), so the old
 *    delivery could never have worked against it.
 * 3. Fire-and-forget with a `console.error`. A webhook that had been failing all
 *    week looked exactly like one that was never configured.
 *
 * Retries are safe because every delivery carries a stable id and both
 * supported agents deduplicate on it — Hermes on `X-Request-ID` for an hour,
 * OpenClaw through its own hook queue.
 */

/** 1s, 8s, 60s. Enough to ride out a restarting gateway, not enough to queue up. */
const RETRY_DELAYS_MS = [1_000, 8_000, 60_000];
const REQUEST_TIMEOUT_MS = 8_000;
/** Deliveries older than this are pruned on write, so the table stays small. */
const KEEP_DELIVERIES = 500;

export type WebhookEventType = WebhookEvent;

interface TargetRow {
  id: string;
  name: string;
  preset: string;
  url: string;
  secret: string | null;
  eventsJson: string | null;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

function mapTarget(row: TargetRow): WebhookTarget {
  let events: WebhookEvent[] = [];
  if (row.eventsJson) {
    try {
      const parsed = JSON.parse(row.eventsJson);
      if (Array.isArray(parsed)) events = parsed as WebhookEvent[];
    } catch {
      /* a malformed list means "everything", not a crash */
    }
  }
  return {
    id: row.id,
    name: row.name,
    preset: isWebhookPreset(row.preset) ? row.preset : "generic",
    url: row.url,
    secretSet: Boolean(row.secret),
    events,
    active: row.active,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/* ------------------------------------------------------------ targets */

export function listWebhookTargets(db: LifeOsDb): WebhookTarget[] {
  return db.select().from(schema.webhookTargets).all().map(mapTarget);
}

export function createWebhookTarget(
  db: LifeOsDb,
  input: {
    name: string;
    url: string;
    preset?: WebhookPreset;
    secret?: string | null;
    events?: string[] | null;
    active?: boolean;
  },
): WebhookTarget | { error: string } {
  const url = input.url?.trim();
  if (!url) return { error: "A webhook target needs a url" };
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return { error: "Webhook url must be http or https" };
    }
  } catch {
    return { error: "Webhook url is not a valid URL" };
  }

  const preset = isWebhookPreset(input.preset) ? input.preset : "generic";
  // Hermes rejects unsigned requests and OpenClaw rejects unauthenticated ones,
  // so a target without a secret would fail on every single delivery. Say so now.
  if (preset !== "generic" && !input.secret) {
    return {
      error:
        preset === "hermes"
          ? "Hermes verifies an HMAC signature — set the route's secret"
          : "OpenClaw requires a bearer token — set hooks.token as the secret",
    };
  }

  const now = nowIso();
  const id = nanoid();
  db.insert(schema.webhookTargets)
    .values({
      id,
      name: input.name?.trim() || preset,
      preset,
      url,
      secret: input.secret ?? null,
      eventsJson: input.events?.length ? JSON.stringify(input.events) : null,
      active: input.active ?? true,
      createdAt: now,
      updatedAt: now,
    })
    .run();

  return getWebhookTarget(db, id)!;
}

export function getWebhookTarget(db: LifeOsDb, id: string): WebhookTarget | null {
  const row = db
    .select()
    .from(schema.webhookTargets)
    .where(eq(schema.webhookTargets.id, id))
    .get();
  return row ? mapTarget(row) : null;
}

export function updateWebhookTarget(
  db: LifeOsDb,
  id: string,
  patch: {
    name?: string;
    url?: string;
    preset?: WebhookPreset;
    secret?: string | null;
    events?: string[] | null;
    active?: boolean;
  },
): WebhookTarget | { error: string } {
  const existing = getWebhookTarget(db, id);
  if (!existing) return { error: "Webhook target not found" };

  db.update(schema.webhookTargets)
    .set({
      ...(patch.name !== undefined ? { name: patch.name } : {}),
      ...(patch.url !== undefined ? { url: patch.url } : {}),
      ...(patch.preset !== undefined && isWebhookPreset(patch.preset)
        ? { preset: patch.preset }
        : {}),
      // An empty string clears the secret; undefined leaves it alone.
      ...(patch.secret !== undefined ? { secret: patch.secret || null } : {}),
      ...(patch.events !== undefined
        ? { eventsJson: patch.events?.length ? JSON.stringify(patch.events) : null }
        : {}),
      ...(patch.active !== undefined ? { active: patch.active } : {}),
      updatedAt: nowIso(),
    })
    .where(eq(schema.webhookTargets.id, id))
    .run();

  return getWebhookTarget(db, id)!;
}

export function deleteWebhookTarget(db: LifeOsDb, id: string) {
  db.delete(schema.webhookTargets).where(eq(schema.webhookTargets.id, id)).run();
  return { ok: true as const };
}

/* --------------------------------------------------------- deliveries */

export function listWebhookDeliveries(db: LifeOsDb, limit = 50): WebhookDelivery[] {
  return db
    .select()
    .from(schema.webhookDeliveries)
    .orderBy(desc(schema.webhookDeliveries.createdAt))
    .limit(limit)
    .all()
    .map((r) => ({
      id: r.id,
      targetId: r.targetId,
      event: r.event,
      attempt: r.attempt,
      status: r.status as WebhookDelivery["status"],
      responseStatus: r.responseStatus ?? null,
      error: r.error ?? null,
      createdAt: r.createdAt,
      deliveredAt: r.deliveredAt ?? null,
    }));
}

function pruneDeliveries(db: LifeOsDb): void {
  const rows = db
    .select({ id: schema.webhookDeliveries.id })
    .from(schema.webhookDeliveries)
    .orderBy(desc(schema.webhookDeliveries.createdAt))
    .all();
  for (const row of rows.slice(KEEP_DELIVERIES)) {
    db.delete(schema.webhookDeliveries)
      .where(eq(schema.webhookDeliveries.id, row.id))
      .run();
  }
}

/* ------------------------------------------------------------ signing */

/**
 * Hermes generic-V2: HMAC-SHA256 over `<timestamp>.<body>`, hex, with the
 * timestamp sent alongside so the receiver can reject replays outside ±300s.
 * The timestamp is *inside* the signed string — signing the body alone (their
 * V1) lets a captured request be replayed forever.
 */
export function hermesSignature(
  secret: string,
  timestamp: string,
  body: string,
): string {
  return createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
}

/** The exact headers and body a preset expects. Pure, so it can be tested. */
export function buildRequest(
  preset: WebhookPreset,
  secret: string | null,
  payload: WebhookPayload,
): { body: string; headers: Record<string, string> } {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "User-Agent": "LifeOS-Webhook/1.0",
    "X-LifeOS-Event": String(payload.event),
    // Both supported agents dedupe on a request id, which is what makes the
    // retry loop safe rather than a way to double-count a habit.
    "X-Request-ID": payload.deliveryId,
  };

  if (preset === "openclaw") {
    /*
     * OpenClaw's `/hooks/wake` takes a human-readable `text` and enqueues it as
     * a system event. The structured payload rides along so a hook mapping can
     * still read the fields.
     */
    const body = JSON.stringify({
      text: describe(payload),
      mode: "now",
      lifeos: payload,
    });
    if (secret) headers.Authorization = `Bearer ${secret}`;
    return { body, headers };
  }

  const body = JSON.stringify(payload);

  if (preset === "hermes") {
    const timestamp = String(Math.floor(Date.parse(payload.ts) / 1000));
    headers["X-Webhook-Timestamp"] = timestamp;
    if (secret) {
      headers["X-Webhook-Signature-V2"] = hermesSignature(secret, timestamp, body);
    }
    return { body, headers };
  }

  if (secret) headers["X-LifeOS-Secret"] = secret;
  return { body, headers };
}

/** One line an agent can act on without parsing anything. */
export function describe(payload: WebhookPayload): string {
  const d = payload.data as { title?: string; name?: string; label?: string };
  const what = d.title ?? d.name ?? d.label ?? "something";
  switch (payload.event) {
    case "card.complete":
      return `Life OS: completed "${what}"`;
    case "habit.complete":
      return `Life OS: habit "${what}" done`;
    case "habit.undo":
      return `Life OS: habit "${what}" un-done`;
    case "study.complete":
    case "block.complete":
      return `Life OS: finished study block "${what}"`;
    case "goal.achieved":
      return `Life OS: goal "${what}" achieved`;
    case "property.changed":
      return `Life OS: counter "${what}" changed`;
    case "card.interaction":
      return `Life OS: interacted with "${what}"`;
    default:
      return `Life OS: ${payload.event} — ${what}`;
  }
}

/* ----------------------------------------------------------- delivery */

function wants(target: WebhookTarget, event: string): boolean {
  return target.active && (target.events.length === 0 || target.events.includes(event as WebhookEvent));
}

export interface FireResult {
  sent: boolean;
  attempted: number;
  delivered: number;
  results: { targetId: string; ok: boolean; status?: number; error?: string }[];
}

/**
 * Send `event` to every target that asked for it.
 *
 * Awaited by callers but never allowed to throw: a completion must succeed even
 * if every agent in the world is offline. What failed is recorded in
 * `webhook_deliveries` and retried in the background.
 */
export async function fireAgentWebhook(
  db: LifeOsDb,
  event: WebhookEvent | string,
  data: Record<string, unknown>,
): Promise<FireResult> {
  const targets = listWebhookTargets(db).filter((t) => wants(t, event));
  const result: FireResult = {
    sent: false,
    attempted: targets.length,
    delivered: 0,
    results: [],
  };
  if (targets.length === 0) return result;

  for (const target of targets) {
    const deliveryId = nanoid();
    const payload: WebhookPayload = {
      source: "life-os",
      event,
      deliveryId,
      ts: nowIso(),
      data,
    };

    db.insert(schema.webhookDeliveries)
      .values({
        id: deliveryId,
        targetId: target.id,
        event: String(event),
        payloadJson: JSON.stringify(payload),
        attempt: 1,
        status: "pending",
        createdAt: nowIso(),
      })
      .run();

    const secret = readSecret(db, target.id);
    const attempt = await send(target, secret, payload);

    if (attempt.ok) {
      result.delivered += 1;
      result.sent = true;
      markDelivered(db, deliveryId, attempt.status);
    } else {
      markFailed(db, deliveryId, 1, attempt.status, attempt.error);
      // Retry out of band so a slow agent never slows down a tap.
      void retryLater(db, target, secret, payload, deliveryId, 1);
    }
    result.results.push({
      targetId: target.id,
      ok: attempt.ok,
      status: attempt.status,
      error: attempt.error,
    });
  }

  pruneDeliveries(db);
  return result;
}

/** Secrets never leave the server, so they are read separately from `mapTarget`. */
function readSecret(db: LifeOsDb, id: string): string | null {
  const row = db
    .select({ secret: schema.webhookTargets.secret })
    .from(schema.webhookTargets)
    .where(eq(schema.webhookTargets.id, id))
    .get();
  return row?.secret ?? null;
}

async function send(
  target: WebhookTarget,
  secret: string | null,
  payload: WebhookPayload,
): Promise<{ ok: boolean; status?: number; error?: string }> {
  const { body, headers } = buildRequest(target.preset, secret, payload);
  try {
    const res = await fetch(target.url, {
      method: "POST",
      headers,
      body,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (res.ok) return { ok: true, status: res.status };
    return { ok: false, status: res.status, error: `HTTP ${res.status}` };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

async function retryLater(
  db: LifeOsDb,
  target: WebhookTarget,
  secret: string | null,
  payload: WebhookPayload,
  deliveryId: string,
  attempt: number,
): Promise<void> {
  const delay = RETRY_DELAYS_MS[attempt];
  if (delay === undefined) return; // retries exhausted; the row stays `failed`

  /*
   * `unref` so a pending retry never holds the process open. Without it a
   * single failed delivery keeps Node alive for the full backoff — which turns
   * a clean shutdown into a minute-long hang, and made the test suite take 70
   * seconds waiting on retries nobody was watching.
   */
  await new Promise((resolve) => {
    const timer = setTimeout(resolve, delay);
    timer.unref?.();
  });
  const next = attempt + 1;
  const res = await send(target, secret, payload);
  if (res.ok) {
    markDelivered(db, deliveryId, res.status, next);
    return;
  }
  markFailed(db, deliveryId, next, res.status, res.error);
  await retryLater(db, target, secret, payload, deliveryId, next);
}

function markDelivered(
  db: LifeOsDb,
  id: string,
  status?: number,
  attempt?: number,
): void {
  db.update(schema.webhookDeliveries)
    .set({
      status: "delivered",
      responseStatus: status ?? null,
      error: null,
      deliveredAt: nowIso(),
      ...(attempt !== undefined ? { attempt } : {}),
    })
    .where(eq(schema.webhookDeliveries.id, id))
    .run();
}

function markFailed(
  db: LifeOsDb,
  id: string,
  attempt: number,
  status?: number,
  error?: string,
): void {
  db.update(schema.webhookDeliveries)
    .set({
      status: "failed",
      attempt,
      responseStatus: status ?? null,
      error: error ?? "unknown error",
    })
    .where(eq(schema.webhookDeliveries.id, id))
    .run();
}

/**
 * Send a throwaway event so the user can find out whether a target works
 * *before* relying on it for a real completion.
 */
export async function testWebhookTarget(db: LifeOsDb, id: string) {
  const target = getWebhookTarget(db, id);
  if (!target) return { error: "Webhook target not found" as const };

  const payload: WebhookPayload = {
    source: "life-os",
    event: "test",
    deliveryId: nanoid(),
    ts: nowIso(),
    data: { title: "Test delivery", message: "If you can read this, it works." },
  };
  const res = await send(target, readSecret(db, id), payload);
  return { ok: res.ok, status: res.status ?? null, error: res.error ?? null };
}
