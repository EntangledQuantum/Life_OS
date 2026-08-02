import type { LifeOsDb } from "@life-os/db";
import { getSettingsRow } from "./helpers.js";

export type WebhookEventType =
  | "card.complete"
  | "card.update"
  | "habit.complete"
  | "habit.undo"
  | "review.complete"
  | "event.complete"
  | "block.complete";

/**
 * Fire-and-forget POST to agent webhook if configured.
 * Never throws to callers — logs failures only.
 */
export async function fireAgentWebhook(
  db: LifeOsDb,
  event: WebhookEventType,
  payload: Record<string, unknown>,
): Promise<{ sent: boolean; status?: number; error?: string }> {
  const row = getSettingsRow(db) as {
    agentWebhookUrl?: string | null;
    agentWebhookSecret?: string | null;
  };
  const url = row.agentWebhookUrl?.trim();
  if (!url) return { sent: false, error: "no_webhook_url" };

  const body = {
    source: "life-os",
    event,
    ts: new Date().toISOString(),
    ...payload,
  };

  try {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "User-Agent": "LifeOS-Webhook/0.1",
      "X-LifeOS-Event": event,
    };
    if (row.agentWebhookSecret) {
      headers["X-LifeOS-Secret"] = row.agentWebhookSecret;
    }

    const res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(8000),
    });
    return { sent: true, status: res.status };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("[webhook]", event, message);
    return { sent: false, error: message };
  }
}
