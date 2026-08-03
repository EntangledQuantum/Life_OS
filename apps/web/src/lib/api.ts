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
    ...(options.headers as Record<string, string>),
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers,
    credentials: "include",
  });

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
  login: (username: string, password: string) =>
    request<{ token: string; username: string }>("/api/v1/auth/login", {
      method: "POST",
      body: JSON.stringify({ username, password }),
    }),
  logout: () => request("/api/v1/auth/logout", { method: "POST" }),
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
  studyBlocks: () =>
    request<import("@life-os/shared").ScheduleBlock[]>("/api/v1/blocks/study"),
  blocks: () =>
    request<import("@life-os/shared").ScheduleBlock[]>("/api/v1/blocks"),
  startBlock: (id: string) =>
    request<any>(`/api/v1/blocks/${id}/start`, { method: "POST" }),
  completeBlock: (id: string) =>
    request<any>(`/api/v1/blocks/${id}/complete`, { method: "POST" }),
  events: () =>
    request<import("@life-os/shared").AgentEvent[]>("/api/v1/events"),
  completeEvent: (id: string) =>
    request(`/api/v1/events/${id}/complete`, { method: "POST" }),
  dismissEvent: (id: string) =>
    request(`/api/v1/events/${id}/dismiss`, { method: "POST" }),
  cards: () =>
    request<import("@life-os/shared").DashboardCard[]>("/api/v1/cards"),
  completeCard: (id: string) =>
    request<{ xpAwarded: number }>(`/api/v1/cards/${id}/complete`, {
      method: "POST",
      body: JSON.stringify({ source: "user" }),
    }),
  /** Start a scheduled card — it takes over the timeline under its activity tag. */
  startCard: (id: string) =>
    request<any>(`/api/v1/cards/${id}/start`, { method: "POST" }),
  /** Confirm the chime actually played, so the reminder fires exactly once. */
  markCardNotified: (id: string) =>
    request<any>(`/api/v1/cards/${id}/notified`, { method: "POST" }),
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
