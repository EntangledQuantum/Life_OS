/**
 * Telling an agent that something happened.
 *
 * Two agents are supported directly — Hermes and OpenClaw — and they want
 * genuinely different things on the wire, so the difference lives here as a
 * *preset* rather than being smeared across the delivery code:
 *
 * | preset     | endpoint                    | auth                                              |
 * |------------|-----------------------------|---------------------------------------------------|
 * | `hermes`   | `POST <base>/webhooks/<route>` | HMAC-SHA256 of `<ts>.<body>`, `X-Webhook-Signature-V2` |
 * | `openclaw` | `POST <base>/hooks/wake`    | `Authorization: Bearer <hooks.token>`             |
 * | `generic`  | anything                    | `X-LifeOS-Secret`                                 |
 *
 * Both real agents deduplicate on a delivery id, which is what makes retrying
 * safe: a request that timed out after the agent already accepted it is
 * recognised as a repeat rather than acted on twice.
 */

export const WEBHOOK_PRESETS = ["hermes", "openclaw", "generic"] as const;
export type WebhookPreset = (typeof WEBHOOK_PRESETS)[number];

export const WEBHOOK_EVENTS = [
  "card.complete",
  "card.interaction",
  "habit.complete",
  "habit.undo",
  "study.complete",
  "block.complete",
  "review.complete",
  "event.complete",
  "goal.achieved",
  /**
   * One rung of a rarity ladder was reached and witnessed.
   *
   * Separate from `goal.achieved`, which stays what it always was: the whole
   * goal is finished. A five-tier goal fires this four times on the way up and
   * both on the last rung, so an agent can react to "they hit Gold" without
   * having to treat it as the end of the story.
   */
  "goal.tier",
  "property.changed",
] as const;
export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number];

export function isWebhookEvent(value: unknown): value is WebhookEvent {
  return (
    typeof value === "string" && (WEBHOOK_EVENTS as readonly string[]).includes(value)
  );
}

export function isWebhookPreset(value: unknown): value is WebhookPreset {
  return (
    typeof value === "string" && (WEBHOOK_PRESETS as readonly string[]).includes(value)
  );
}

export interface WebhookTarget {
  id: string;
  name: string;
  preset: WebhookPreset;
  url: string;
  /** Never returned by the API — only whether one is set. */
  secretSet: boolean;
  /** Empty means every event. */
  events: WebhookEvent[];
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface WebhookDelivery {
  id: string;
  targetId: string;
  event: WebhookEvent | string;
  attempt: number;
  status: "pending" | "delivered" | "failed";
  responseStatus: number | null;
  error: string | null;
  createdAt: string;
  deliveredAt: string | null;
}

/**
 * The body Life OS sends. Stable across presets — only the envelope and the
 * headers differ — so an agent that learns one shape can read all of them.
 */
export interface WebhookPayload {
  source: "life-os";
  event: WebhookEvent | string;
  /** Unique per delivery; both supported agents dedupe on it. */
  deliveryId: string;
  ts: string;
  data: Record<string, unknown>;
}

/**
 * An interactive control on an agent card.
 *
 * A slider so the agent can ask "how did that feel, 1–10" without inventing a
 * card kind, and a button for anything that is just an acknowledgement. The
 * agent hears about changes only if it asked to (`webhookOnInteract`).
 */
export type CardControl =
  | {
      kind: "slider";
      label: string;
      min: number;
      max: number;
      step?: number;
      value: number;
      /** Shown next to the number — "hours", "/10". */
      unit?: string;
    }
  | {
      kind: "button";
      label: string;
      /** Set once pressed, so the UI can show it has been dealt with. */
      pressedAt?: string | null;
    };

/**
 * Validate an agent-supplied control. Returns the normalized control or an
 * error string — a slider whose value sits outside its own range, or whose
 * range is inverted, would render as a broken widget.
 */
export function validateCardControl(
  input: unknown,
): { ok: true; control: CardControl } | { ok: false; error: string } {
  if (input === null || input === undefined) {
    return { ok: false, error: "control is empty" };
  }
  if (typeof input !== "object") return { ok: false, error: "control must be an object" };
  const c = input as Record<string, unknown>;

  if (c.kind === "button") {
    const label = typeof c.label === "string" ? c.label.trim() : "";
    if (!label) return { ok: false, error: "a button control needs a label" };
    return {
      ok: true,
      control: {
        kind: "button",
        label,
        pressedAt: typeof c.pressedAt === "string" ? c.pressedAt : null,
      },
    };
  }

  if (c.kind === "slider") {
    const label = typeof c.label === "string" ? c.label.trim() : "";
    if (!label) return { ok: false, error: "a slider control needs a label" };

    const min = Number(c.min);
    const max = Number(c.max);
    if (!Number.isFinite(min) || !Number.isFinite(max)) {
      return { ok: false, error: "slider min and max must be numbers" };
    }
    if (max <= min) {
      return { ok: false, error: "slider max must be greater than min" };
    }

    const step = c.step === undefined ? 1 : Number(c.step);
    if (!Number.isFinite(step) || step <= 0) {
      return { ok: false, error: "slider step must be a positive number" };
    }

    const raw = c.value === undefined ? min : Number(c.value);
    if (!Number.isFinite(raw)) {
      return { ok: false, error: "slider value must be a number" };
    }

    return {
      ok: true,
      control: {
        kind: "slider",
        label,
        min,
        max,
        step,
        value: clampToStep(raw, min, max, step),
        ...(typeof c.unit === "string" && c.unit ? { unit: c.unit } : {}),
      },
    };
  }

  return { ok: false, error: 'control.kind must be "slider" or "button"' };
}

/** Snap a value into `[min, max]` and onto the step grid. */
export function clampToStep(
  value: number,
  min: number,
  max: number,
  step: number,
): number {
  const bounded = Math.min(max, Math.max(min, value));
  const snapped = min + Math.round((bounded - min) / step) * step;
  // Floating-point steps (0.1) accumulate error; round to the step's precision.
  const decimals = (String(step).split(".")[1] ?? "").length;
  return Number(Math.min(max, Math.max(min, snapped)).toFixed(decimals));
}
