import type {
  AppSettings,
  DashboardToday,
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

type RequestOpts = RequestInit & { skipAuth?: boolean };

async function resolveBase(): Promise<string> {
  const base = await getBaseUrl();
  if (!base) throw new ApiError(0, "No server configured");
  return base;
}

async function request<T>(path: string, options: RequestOpts = {}): Promise<T> {
  const base = await resolveBase();
  const token = options.skipAuth ? null : await getToken();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json",
    ...(options.headers as Record<string, string>),
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  let res: Response;
  try {
    res = await fetch(`${base}${path}`, {
      ...options,
      headers,
    });
  } catch {
    throw new ApiError(0, "Life OS isn't running — can't reach the server");
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

/** Health check against an explicit base URL (setup screen). */
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

export const api = {
  health: async () => {
    const base = await resolveBase();
    return checkHealth(base);
  },

  login: (username: string, password: string) =>
    request<{ token: string; username: string; user?: unknown }>(
      "/api/v1/auth/login",
      {
        method: "POST",
        body: JSON.stringify({ username, password }),
        skipAuth: true,
      },
    ),

  me: () =>
    request<{ username: string; role: string }>("/api/v1/auth/me"),

  dashboard: () =>
    request<DashboardToday>("/api/v1/dashboard/today"),

  settings: () => request<AppSettings>("/api/v1/settings"),

  updateSettings: (body: Partial<AppSettings>) =>
    request<AppSettings>("/api/v1/settings", {
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
      // 409 = already completed today — success-with-no-op
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

  startCard: (id: string) =>
    request<{ block?: { category?: string } }>(`/api/v1/cards/${id}/start`, {
      method: "POST",
    }),

  markCardNotified: (id: string) =>
    request(`/api/v1/cards/${id}/notified`, { method: "POST" }),

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

  startBlock: (id: string) =>
    request(`/api/v1/blocks/${id}/start`, { method: "POST" }),

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
