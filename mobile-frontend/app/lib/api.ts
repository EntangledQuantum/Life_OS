import type {
  AppSettings,
  DashboardToday,
  GamificationConfig,
  HealthResponse,
  HabitWithToday,
  Goal,
  DashboardCard,
} from "./types";
import { getBaseUrl, getToken, normalizeBaseUrl } from "./storage";

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
    this.name = "ApiError";
  }
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
    ...(options.headers as Record<string, string>),
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  // Strip custom fields before fetch
  const { baseUrl: _b, token: _t, ...fetchOpts } = options;

  let res: Response;
  try {
    res = await fetch(`${base}${path}`, {
      ...fetchOpts,
      headers,
    });
  } catch {
    throw new ApiError(0, "Life OS isn't running — can't reach the server");
  }

  if (res.status === 401) {
    onUnauthorized?.();
    throw new ApiError(401, "Wrong or expired API token");
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
    res = await fetch(`${base}/health`, {
      headers: { Accept: "application/json" },
    });
  } catch {
    throw new ApiError(0, "Life OS isn't running — can't reach the server");
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
    res = await fetch(`${base}/api/v1/auth/me`, {
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${token.trim()}`,
      },
    });
  } catch {
    throw new ApiError(0, "Life OS isn't running — can't reach the server");
  }
  if (res.status === 401) return { ok: false, status: 401 };
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

  completeCard: (id: string) =>
    request<{ xpAwarded?: number; nextOccurrence?: unknown }>(
      `/api/v1/cards/${id}/complete`,
      {
        method: "POST",
        body: JSON.stringify({ source: "user" }),
      },
    ),

  /*
   * No `startCard` / `startBlock`. Scheduled things are completed, never
   * started, and completing one does not touch the running activity — that is
   * `setActiveSession` and nothing else.
   */

  markCardNotified: (id: string) =>
    request(`/api/v1/cards/${id}/notified`, { method: "POST" }),

  /** Move a card's slider or press its button. Not a completion. */
  interactWithCard: (id: string, body: { value?: number; pressed?: boolean }) =>
    request(`/api/v1/cards/${id}/interact`, {
      method: "POST",
      body: JSON.stringify(body),
    }),

  completeEvent: (id: string) =>
    request(`/api/v1/events/${id}/complete`, { method: "POST" }),

  dismissEvent: (id: string) =>
    request(`/api/v1/events/${id}/dismiss`, { method: "POST" }),

  completeReview: (id: string) =>
    request(`/api/v1/reviews/${id}/complete`, { method: "POST" }),

  markCelebrationSeen: (id: string) =>
    request<Goal>(`/api/v1/goals/${id}/celebration-seen`, { method: "POST" }),

  setActiveSession: (activity: string, blockId?: string | null) =>
    request("/api/v1/session/active", {
      method: "POST",
      body: JSON.stringify({ activity, blockId }),
    }),

  clearActiveSession: () =>
    request("/api/v1/session/active", { method: "DELETE" }),

  completeBlock: (id: string) =>
    request(`/api/v1/blocks/${id}/complete`, { method: "POST" }),

  logStudy: (body: {
    title: string;
    durationMinutes: number;
    qualityFlag: string;
  }) =>
    request("/api/v1/study", {
      method: "POST",
      body: JSON.stringify({ ...body, source: "user" }),
    }),

  cards: () => request<DashboardCard[]>("/api/v1/cards"),

  analytics: () => request<unknown>("/api/v1/analytics"),
};
