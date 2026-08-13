import { PROTOCOL_HEADER, PROTOCOL_VERSION } from "@life-os/shared";
const API_BASE = import.meta.env.VITE_API_URL ?? "";

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
  const res = await fetch(`${API_BASE}${path}`, { ...options, headers });

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

export const api = {
  /** Validates whatever token is currently stored. There is no login call. */
  me: () => request<{ username: string; role: string }>("/api/v1/auth/me"),
  dashboard: () =>
    request<import("@life-os/shared").DashboardToday>("/api/v1/dashboard/today"),
  analytics: () => request<any>("/api/v1/analytics"),
  habits: () =>
    request<import("@life-os/shared").HabitWithToday[]>("/api/v1/habits"),
  completeHabit: (id: string) =>
    request<any>(`/api/v1/habits/${id}/complete`, {
      method: "POST",
      body: JSON.stringify({ source: "user" }),
    }),
  undoHabit: (id: string) =>
    request<any>(`/api/v1/habits/${id}/undo`, { method: "POST" }),
  tasks: (query = "") =>
    request<import("@life-os/shared").Task[]>(`/api/v1/tasks${query}`),
  completeTask: (id: string) =>
    request<{ xpAwarded: number }>(`/api/v1/tasks/${id}/complete`, {
      method: "POST",
      body: JSON.stringify({ source: "user" }),
    }),
  dismissTask: (id: string) =>
    request<any>(`/api/v1/tasks/${id}/dismiss`, { method: "POST" }),
  /*
   * There is no `startTask`. Scheduled things are completed, not started — what
   * activity you are in is set by hand through `setActiveSession` and nothing
   * else touches it.
   */
  /** Move a task's slider or press its button. Not a completion. */
  interactWithTask: (id: string, body: { value?: number; pressed?: boolean }) =>
    request<any>(`/api/v1/tasks/${id}/interact`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
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
  /** Confirm the notification actually fired, so it fires exactly once. */
  markTaskNotified: (id: string) =>
    request<any>(`/api/v1/tasks/${id}/notified`, { method: "POST" }),
  goals: () => request<import("@life-os/shared").Goal[]>("/api/v1/goals"),
  createGoal: (body: unknown) =>
    request("/api/v1/goals", { method: "POST", body: JSON.stringify(body) }),
  /**
   * Mark a goal's celebration as watched. This is the only path to `achieved` —
   * a goal whose condition is met but whose animation nobody saw stays open.
   */
  markCelebrationSeen: (id: string) =>
    request<import("@life-os/shared").Goal>(
      `/api/v1/goals/${id}/celebration-seen`,
      { method: "POST" },
    ),
  properties: () =>
    request<import("@life-os/shared").AgentProperty[]>("/api/v1/properties"),
  settings: () =>
    request<import("@life-os/shared").AppSettings>("/api/v1/settings"),
  updateSettings: (body: unknown) =>
    request("/api/v1/settings", {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
  setActiveSession: (activity: string, blockId?: string | null) =>
    request("/api/v1/session/active", {
      method: "POST",
      body: JSON.stringify({ activity, blockId }),
    }),
  clearActiveSession: () =>
    request("/api/v1/session/active", { method: "DELETE" }),
  exportJson: () => request("/api/v1/export/json"),
  gamificationConfig: () => request("/api/v1/gamification/config"),
};
