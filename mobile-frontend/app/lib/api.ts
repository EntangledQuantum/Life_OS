import type {
  AnalyticsPayload,
  AnalyticsRange,
  AppSettings,
  DashboardToday,
  GamificationConfig,
  HealthResponse,
  HabitWithToday,
  Goal,
  ProtocolMismatch,
  Task,
  TaskKind,
  TaskStatus,
} from "./types";
import { getBaseUrl, getToken, normalizeBaseUrl } from "./storage";

/**
 * Wire-format version this build speaks. Sent on every API call; a server that
 * cannot serve it answers 426 rather than handing back a payload we would
 * misread as an empty day.
 *
 * Bump this only when the app can no longer read an older server — that is the
 * whole meaning of the number.
 */
export const PROTOCOL_VERSION = 3;
const PROTOCOL_HEADER = "x-lifeos-protocol";

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
    this.name = "ApiError";
  }
}

/**
 * The server is newer than this build. Distinct from ApiError because the fix
 * is different in kind: nothing the user does in the app will help, and
 * retrying is pointless. They need a new APK.
 */
export class ProtocolError extends ApiError {
  detail: ProtocolMismatch;
  constructor(detail: ProtocolMismatch) {
    super(426, detail.error);
    this.name = "ProtocolError";
    this.detail = detail;
  }
}

/**
 * Every request gets a deadline, because React Native's `fetch` does not have
 * one. Android's networking stack is configured with all three OkHttp timeouts
 * at zero, so a connection to an address that silently drops packets — the
 * laptop asleep, the wrong LAN IP, a VPN in the way — never rejects and never
 * resolves. The promise simply stays pending, `isError` never becomes true, and
 * every screen sits on its spinner for the rest of the session with nothing to
 * retry and nothing to read. That is not a hypothetical: it is what "it just
 * keeps loading" was.
 *
 * A timeout turns that into an ordinary error the UI can show.
 */
const REQUEST_TIMEOUT_MS = 12_000;
/** Setup and health probes answer instantly or not at all — no reason to wait. */
const PROBE_TIMEOUT_MS = 8_000;

export async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  ms: number = REQUEST_TIMEOUT_MS,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/** An aborted fetch reads as a DOMException named AbortError on this platform. */
function timedOut(e: unknown): boolean {
  return (
    typeof e === "object" &&
    e !== null &&
    "name" in e &&
    (e as { name?: string }).name === "AbortError"
  );
}

/**
 * The two ways a request fails before it ever gets a status, said apart. They
 * need different fixes — "nothing is listening" vs "something is listening and
 * not answering" — and the second one used to be invisible.
 */
function unreachable(e: unknown, base: string, ms: number): ApiError {
  return timedOut(e)
    ? new ApiError(
        0,
        `No answer from ${base} within ${Math.round(ms / 1000)}s. Something is at that address but it is not replying — check the server is awake and on this network.`,
      )
    : new ApiError(0, `Can't reach ${base} — is Life OS running?`);
}

/** Called once on 401 — clear token and return to connect. Never log the token. */
let onUnauthorized: (() => void) | null = null;

export function setUnauthorizedHandler(handler: (() => void) | null) {
  onUnauthorized = handler;
}

type RequestOpts = RequestInit & {
  /** Override base URL (connect flow before storage is set). */
  baseUrl?: string;
  /** Override token for the one-shot /auth/me validation. */
  token?: string | null;
};

async function resolveBase(override?: string): Promise<string> {
  if (override) return normalizeBaseUrl(override);
  const base = await getBaseUrl();
  if (!base) throw new ApiError(0, "No server configured");
  return base;
}

async function request<T>(path: string, options: RequestOpts = {}): Promise<T> {
  const base = await resolveBase(options.baseUrl);
  const token =
    options.token !== undefined ? options.token : await getToken();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json",
    [PROTOCOL_HEADER]: String(PROTOCOL_VERSION),
    ...(options.headers as Record<string, string>),
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  // Strip custom fields before fetch
  const { baseUrl: _b, token: _t, ...fetchOpts } = options;

  let res: Response;
  try {
    res = await fetchWithTimeout(
      `${base}${path}`,
      { ...fetchOpts, headers },
      REQUEST_TIMEOUT_MS,
    );
  } catch (e) {
    throw unreachable(e, base, REQUEST_TIMEOUT_MS);
  }

  if (res.status === 401) {
    onUnauthorized?.();
    throw new ApiError(401, "Wrong or expired API token");
  }

  /*
   * 426 Upgrade Required: the server has moved past what this build can read.
   * Surfaced as its own error type so the UI can say "install the new app"
   * instead of showing a generic failure the user would try to fix by
   * reconnecting.
   */
  if (res.status === 426) {
    let detail: ProtocolMismatch | null = null;
    try {
      detail = (await res.json()) as ProtocolMismatch;
    } catch {
      /* fall through to the generic shape below */
    }
    throw new ProtocolError(
      detail ?? {
        error: "This app is too old for this Life OS server",
        hint: "Install the latest Android build.",
        clientProtocol: PROTOCOL_VERSION,
        serverProtocol: 0,
        minProtocol: 0,
        downloadUrl: "https://github.com/EntangledQuantum/Life_OS/releases",
      },
    );
  }

  if (!res.ok) {
    let message = res.statusText || `HTTP ${res.status}`;
    try {
      const body = (await res.json()) as { error?: string };
      if (body.error) message = body.error;
    } catch {
      /* ignore */
    }
    throw new ApiError(res.status, message);
  }

  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

/** Health check against an explicit base URL (setup screen). No auth required. */
export async function checkHealth(baseUrl: string): Promise<HealthResponse> {
  const base = normalizeBaseUrl(baseUrl);
  let res: Response;
  try {
    res = await fetchWithTimeout(
      `${base}/health`,
      { headers: { Accept: "application/json" } },
      PROBE_TIMEOUT_MS,
    );
  } catch (e) {
    throw unreachable(e, base, PROBE_TIMEOUT_MS);
  }
  if (!res.ok) {
    throw new ApiError(
      res.status,
      res.status === 404
        ? "No /health endpoint — is this the API on port 8787 (not the web UI on 5173)?"
        : "Health check failed",
    );
  }
  const ct = res.headers.get("content-type") ?? "";
  if (!ct.includes("application/json")) {
    throw new ApiError(
      0,
      "Server did not return JSON — use the API port 8787, not the Vite web UI (5173)",
    );
  }
  const body = (await res.json()) as HealthResponse;
  if (!body?.ok || body.service !== "life-os-api") {
    throw new ApiError(0, "Not a Life OS API — expected service: life-os-api");
  }
  return body;
}

/**
 * Validate token against the server. 200 = good, 401 = wrong token.
 * Does not use the unauthorized handler (caller decides).
 */
export async function validateToken(
  baseUrl: string,
  token: string,
): Promise<{ ok: true; username?: string } | { ok: false; status: number }> {
  const base = normalizeBaseUrl(baseUrl);
  let res: Response;
  try {
    res = await fetchWithTimeout(
      `${base}/api/v1/auth/me`,
      {
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${token.trim()}`,
          [PROTOCOL_HEADER]: String(PROTOCOL_VERSION),
        },
      },
      PROBE_TIMEOUT_MS,
    );
  } catch (e) {
    throw unreachable(e, base, PROBE_TIMEOUT_MS);
  }
  if (res.status === 401) return { ok: false, status: 401 };
  /*
   * Catch the version gap here, at the point of connecting, rather than letting
   * someone finish setup and then meet a broken app. This is the first
   * authenticated call the app ever makes.
   */
  if (res.status === 426) {
    const detail = (await res.json().catch(() => null)) as ProtocolMismatch | null;
    throw new ProtocolError(
      detail ?? {
        error: "This app is too old for this Life OS server",
        hint: "Install the latest Android build.",
        clientProtocol: PROTOCOL_VERSION,
        serverProtocol: 0,
        minProtocol: 0,
        downloadUrl: "https://github.com/EntangledQuantum/Life_OS/releases",
      },
    );
  }
  if (!res.ok) {
    throw new ApiError(res.status, "Token check failed");
  }
  try {
    const body = (await res.json()) as { username?: string };
    return { ok: true, username: body.username };
  } catch {
    return { ok: true };
  }
}

/**
 * Trade a pairing code for the real token.
 *
 * Unauthenticated by necessity — a phone that already had the token would not
 * be pairing. The code is high-entropy, expires in five minutes, and burns on
 * first use, which is what makes an open endpoint acceptable here.
 */
export async function claimPairingCode(
  baseUrl: string,
  code: string,
): Promise<{ baseUrl: string; token: string }> {
  const base = normalizeBaseUrl(baseUrl);
  let res: Response;
  try {
    res = await fetchWithTimeout(
      `${base}/api/v1/pair/claim`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          [PROTOCOL_HEADER]: String(PROTOCOL_VERSION),
        },
        body: JSON.stringify({ code: code.trim() }),
      },
      PROBE_TIMEOUT_MS,
    );
  } catch (e) {
    throw timedOut(e)
      ? new ApiError(0, "That server did not answer — are you on the same Wi-Fi?")
      : new ApiError(0, "Could not reach that server — are you on the same Wi-Fi?");
  }

  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new ApiError(res.status, body.error ?? "That code did not work");
  }

  const body = (await res.json()) as { baseUrl?: string; token?: string };
  if (!body.token) throw new ApiError(0, "The server sent no token back");
  return { baseUrl: body.baseUrl ?? base, token: body.token };
}

export const api = {
  health: async () => {
    const base = await resolveBase();
    return checkHealth(base);
  },

  me: () =>
    request<{ username?: string; role?: string }>("/api/v1/auth/me"),

  dashboard: () => request<DashboardToday>("/api/v1/dashboard/today"),

  settings: () => request<AppSettings>("/api/v1/settings"),

  updateSettings: (body: Partial<AppSettings>) =>
    request<AppSettings>("/api/v1/settings", {
      method: "PATCH",
      body: JSON.stringify(body),
    }),

  /**
   * The growth meter style lives in the gamification config, not in settings —
   * it is part of the XP model rather than a display preference. Read it from
   * `dashboard.progress.growthStyle`; write it here.
   */
  gamificationConfig: () =>
    request<GamificationConfig>("/api/v1/gamification/config"),

  updateGamificationConfig: (body: Partial<GamificationConfig>) =>
    request<GamificationConfig>("/api/v1/gamification/config", {
      method: "PATCH",
      body: JSON.stringify(body),
    }),

  habits: () => request<HabitWithToday[]>("/api/v1/habits"),

  completeHabit: async (id: string) => {
    try {
      return await request<{ xpAwarded?: number; streakRecovered?: boolean }>(
        `/api/v1/habits/${id}/complete`,
        {
          method: "POST",
          body: JSON.stringify({ source: "user" }),
        },
      );
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        return { xpAwarded: 0, alreadyDone: true as const };
      }
      throw e;
    }
  },

  undoHabit: (id: string) =>
    request(`/api/v1/habits/${id}/undo`, { method: "POST" }),

  /**
   * Every task, optionally filtered. `/cards`, `/events`, `/reviews` and
   * `/blocks` are gone — they were four views of one object, and this is it.
   */
  tasks: (filter: { status?: TaskStatus; kind?: TaskKind } = {}) => {
    const q = new URLSearchParams();
    if (filter.status) q.set("status", filter.status);
    if (filter.kind) q.set("kind", filter.kind);
    const qs = q.toString();
    return request<Task[]>(`/api/v1/tasks${qs ? `?${qs}` : ""}`);
  },

  /*
   * No `startTask`. Scheduled things are completed, never started, and
   * completing one does not touch the running activity — that is
   * `setActiveSession` and nothing else.
   */
  completeTask: (id: string) =>
    request<{ xpAwarded?: number; nextOccurrence?: Task | null }>(
      `/api/v1/tasks/${id}/complete`,
      {
        method: "POST",
        body: JSON.stringify({ source: "user" }),
      },
    ),

  dismissTask: (id: string) =>
    request(`/api/v1/tasks/${id}/dismiss`, { method: "POST" }),

  markTaskNotified: (id: string) =>
    request(`/api/v1/tasks/${id}/notified`, { method: "POST" }),

  /** Move a task's slider or press its button. Not a completion. */
  interactWithTask: (id: string, body: { value?: number; pressed?: boolean }) =>
    request(`/api/v1/tasks/${id}/interact`, {
      method: "POST",
      body: JSON.stringify(body),
    }),

  /**
   * Witness a celebration. `tierId` names one rung of a rarity ladder; omitting
   * it claims the lowest rung still owed, which is what a build that predates
   * tiers does — so an old APK still walks the ladder one rung per tap.
   */
  markCelebrationSeen: (id: string, tierId?: string) =>
    request<Goal>(
      `/api/v1/goals/${id}/celebration-seen${
        tierId ? `?tier=${encodeURIComponent(tierId)}` : ""
      }`,
      { method: "POST" },
    ),

  setActiveSession: (activity: string, blockId?: string | null) =>
    request("/api/v1/session/active", {
      method: "POST",
      body: JSON.stringify({ activity, blockId }),
    }),

  clearActiveSession: () =>
    request("/api/v1/session/active", { method: "DELETE" }),

  logStudy: (body: {
    title: string;
    durationMinutes: number;
    qualityFlag: string;
  }) =>
    request("/api/v1/study", {
      method: "POST",
      body: JSON.stringify({ ...body, source: "user" }),
    }),

  /** Range is `7d` | `30d` | `90d` | `all`. */
  analytics: (range: AnalyticsRange = "30d") =>
    request<AnalyticsPayload>(`/api/v1/analytics?range=${range}`),
};
