import {
  PROTOCOL_HEADER,
  PROTOCOL_VERSION,
  type AnalyticsPayload,
  type SyncEnvelope,
  type SyncPushRequest,
  type SyncPushResponse,
} from "@life-os/shared";
import { basePath } from "./base";
/*
 * `?.` because `import.meta.env` is Vite's, and this module is also imported by
 * a test running under plain Node, where it does not exist. Without the guard
 * the import throws before a single assertion runs — and this is the one module
 * that most needs testing, since every call in the app goes through it.
 */
const API_URL = import.meta.env?.VITE_API_URL || "";

/**
 * Where `/api/...` lives. An explicit `VITE_API_URL` wins; otherwise the API is
 * same-origin, under whatever prefix the page was served from (`/lifeos` behind
 * the gateway, "" at the root) — read per request, see `base.ts`.
 */
function apiBase(): string {
  return API_URL ? API_URL.replace(/\/+$/, "") : basePath();
}

function getToken(): string | null {
  return localStorage.getItem("lifeos_token");
}

export function setToken(token: string | null) {
  if (token) localStorage.setItem("lifeos_token", token);
  else localStorage.removeItem("lifeos_token");
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    [PROTOCOL_HEADER]: String(PROTOCOL_VERSION),
    ...(options.headers as Record<string, string>),
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  // No `credentials: "include"` — auth is the bearer header only. A cookie
  // would ride along automatically on cross-site requests, which is the whole
  // CSRF problem.
  const res = await fetch(`${apiBase()}${path}`, { ...options, headers });

  if (!res.ok) {
    let message = res.statusText;
    try {
      const body = await res.json();
      message = body.error ?? JSON.stringify(body);
    } catch {
      /* ignore */
    }
    throw new Error(message);
  }

  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

/* ---------------------------------------------------------------- sync */

/** Where the content-addressed artwork lives. The one path image loading needs. */
const ASSET_PATH = "/api/v1/assets/";

/**
 * Is this one of our own asset URLs — the kind that needs the bearer token?
 *
 * The art fields can hold either: a URL the server minted for a picture it
 * holds, which is authenticated, or a link an agent set to some other host,
 * which must never see our `Authorization` header. The test in
 * `test/api-client.test.ts` is why this predicate lives here rather than in the
 * image cache: the path of a Life OS endpoint belongs in this module, so that
 * nothing outside it can quietly build a request to one.
 */
export function isAssetUrl(src: string): boolean {
  return src.includes(ASSET_PATH);
}

/**
 * Fetch one art asset with the token on it.
 *
 * An `<img src>` cannot carry a header, so the picture is fetched here and the
 * caller turns it into an object URL. Content-addressed and
 * `max-age=31536000, immutable`, so this happens once per picture per device,
 * ever — there is not even a revalidation round trip, and a cache-buster on one
 * of these URLs would throw that away for nothing, since a hash cannot describe
 * different bytes.
 */
export async function fetchAsset(src: string): Promise<Response> {
  const token = getToken();
  return fetch(src, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
}

export interface SyncRead {
  /** `200` with a body, or `304` with none. */
  status: number;
  etag: string | null;
  envelope: SyncEnvelope | null;
  /** Body size in bytes, for the one place that reports it. */
  bytes: number;
}

/**
 * **The one read.** What changed since the cursor we hold.
 *
 * Does not go through `request`, because the two things that make this cheap
 * are both invisible to a function that only returns parsed JSON: the
 * conditional request, and the `304` that answers it with no body at all. A
 * `304` is not an error here — it is the success case, and the most common one.
 */
export async function syncRead(
  since: string | null,
  etag: string | null,
): Promise<SyncRead> {
  const token = getToken();
  const headers: Record<string, string> = {
    [PROTOCOL_HEADER]: String(PROTOCOL_VERSION),
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  /*
   * Only sent alongside a cursor. With no `since` we are cold-syncing, and a
   * validator from a previous life could match the empty-delta response for a
   * cursor we have already thrown away.
   */
  if (etag && since) headers["If-None-Match"] = etag;

  const query = since ? `?since=${encodeURIComponent(since)}` : "";
  const res = await fetch(`${apiBase()}/api/v1/sync${query}`, {
    method: "GET",
    headers,
  });

  if (res.status === 304) {
    return { status: 304, etag, envelope: null, bytes: 0 };
  }
  if (!res.ok) {
    let message = res.statusText;
    let body: unknown = null;
    try {
      body = await res.json();
      message = (body as { error?: string }).error ?? JSON.stringify(body);
    } catch {
      /* ignore */
    }
    throw new SyncError(message, res.status, body);
  }

  const text = await res.text();
  return {
    status: res.status,
    etag: res.headers.get("etag"),
    envelope: JSON.parse(text) as SyncEnvelope,
    bytes: new TextEncoder().encode(text).length,
  };
}

/**
 * An HTTP failure with its status kept.
 *
 * The status is the whole message on this route: `401` means the token is wrong
 * and we must stop rather than retry in a loop, `426` means this build is too
 * old to read what the server sends. A thrown `Error` with only a sentence in
 * it cannot be told apart from a network blip.
 */
export class SyncError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: unknown = null,
  ) {
    super(message);
    this.name = "SyncError";
  }
}

export interface SyncPushResult {
  status: number;
  response: SyncPushResponse | null;
  /** On a `409`, where the server says to resume from. */
  lastMutationId: number | null;
  error: string | null;
}

/**
 * **The one write.** Mutations up, authoritative results and a delta back.
 *
 * The reply carries the delta the write caused, which is why nothing in this
 * app refetches after writing: a tick used to cost a 2.26 MB re-read of a day
 * the client had just changed one row of.
 *
 * A `409` is returned rather than thrown. It means our mutation numbering has a
 * hole and the whole batch was refused — recoverable, by resuming from the
 * `lastMutationId` the server reports, and not an error anyone needs to see.
 */
export async function syncPush(
  body: SyncPushRequest,
): Promise<SyncPushResult> {
  const token = getToken();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    [PROTOCOL_HEADER]: String(PROTOCOL_VERSION),
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(`${apiBase()}/api/v1/sync/push`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });

  if (res.status === 409) {
    const parsed = (await res.json().catch(() => ({}))) as {
      error?: string;
      lastMutationId?: number;
    };
    return {
      status: 409,
      response: null,
      lastMutationId:
        typeof parsed.lastMutationId === "number" ? parsed.lastMutationId : null,
      error: parsed.error ?? "Mutation numbering has a hole",
    };
  }

  if (!res.ok) {
    let message = res.statusText;
    let parsed: unknown = null;
    try {
      parsed = await res.json();
      message = (parsed as { error?: string }).error ?? JSON.stringify(parsed);
    } catch {
      /* ignore */
    }
    throw new SyncError(message, res.status, parsed);
  }

  return {
    status: res.status,
    response: (await res.json()) as SyncPushResponse,
    lastMutationId: null,
    error: null,
  };
}

export const api = {
  /** Validates whatever token is currently stored. There is no login call. */
  me: () => request<{ username: string; role: string }>("/api/v1/auth/me"),
  /** Range is `7d` | `30d` | `90d` | `all`; anything else falls back to 30d. */
  analytics: (range = "30d") =>
    request<AnalyticsPayload>(`/api/v1/analytics?range=${range}`),
  habits: () =>
    request<import("@life-os/shared").HabitWithToday[]>("/api/v1/habits"),
  tasks: (query = "") =>
    request<import("@life-os/shared").Task[]>(`/api/v1/tasks${query}`),
  /*
   * The writes a person can make are not here any more. Completing a habit or a
   * task, undoing one, dismissing, interacting, claiming a celebration, setting
   * the activity and changing a setting all go through `POST /sync/push`, as
   * named mutations with a persisted counter — see `lib/sync.ts`. The reply
   * carries the delta they caused, so none of them is followed by a refetch.
   *
   * What is left on this surface is what has no mutation name: reads, and the
   * structural writes that belong to the agent. There is no `startTask` either:
   * a scheduled thing is completed, not started.
   */
  webhookTargets: () =>
    request<import("@life-os/shared").WebhookTarget[]>("/api/v1/webhooks/targets"),
  createWebhookTarget: (body: unknown) =>
    request<any>("/api/v1/webhooks/targets", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  deleteWebhookTarget: (id: string) =>
    request<any>(`/api/v1/webhooks/targets/${id}`, { method: "DELETE" }),
  testWebhookTarget: (id: string) =>
    request<{ ok: boolean; status: number | null; error: string | null }>(
      `/api/v1/webhooks/targets/${id}/test`,
      { method: "POST" },
    ),
  webhookDeliveries: () =>
    request<import("@life-os/shared").WebhookDelivery[]>(
      "/api/v1/webhooks/deliveries?limit=20",
    ),
  goals: () => request<import("@life-os/shared").Goal[]>("/api/v1/goals"),
  createGoal: (body: unknown) =>
    request("/api/v1/goals", { method: "POST", body: JSON.stringify(body) }),
  properties: () =>
    request<import("@life-os/shared").AgentProperty[]>("/api/v1/properties"),
  settings: () =>
    request<import("@life-os/shared").AppSettings>("/api/v1/settings"),
  /** Mint a single-use pairing code for the QR. The token is never in it. */
  mintPairing: () =>
    request<{
      code: string;
      deepLink: string;
      webUrl: string;
      baseUrl: string;
      expiresAt: string;
      expiresInSeconds: number;
    }>("/api/v1/pair", { method: "POST" }),
  /** Every address this instance answers on, and why there may be no public one. */
  reachability: () =>
    request<{
      publicUrl: string | null;
      lan: string[];
      tunnel: string;
      hint: string | null;
    }>("/api/v1/pair/reachability"),
  exportJson: () => request("/api/v1/export/json"),
  gamificationConfig: () =>
    request<import("@life-os/shared").GamificationConfig>(
      "/api/v1/gamification/config",
    ),
  /**
   * The XP rules, including which growth meter is drawn.
   *
   * Both callers of this used to build their own `fetch` with their own headers.
   * That worked until the API started requiring `X-LifeOS-Protocol`, at which
   * point every hand-rolled request began failing with 426 while the ones
   * through here kept working — a difference nothing in the calling code hinted
   * at. Anything that talks to the API goes through `request`.
   */
  updateGamificationConfig: (
    patch: Partial<import("@life-os/shared").GamificationConfig>,
  ) =>
    request<import("@life-os/shared").GamificationConfig>(
      "/api/v1/gamification/config",
      { method: "PATCH", body: JSON.stringify(patch) },
    ),
};
