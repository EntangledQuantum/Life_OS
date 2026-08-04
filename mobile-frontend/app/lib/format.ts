export function formatDelta(n: number, unit = ""): string {
  const sign = n > 0 ? "+" : "";
  return `${sign}${Number.isInteger(n) ? n : n.toFixed(1)}${unit}`;
}

export function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) {
    return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export function formatClock(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export function formatRelative(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return "";
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "";
  const diffMin = Math.round((t - now) / 60_000);
  if (diffMin <= -60) return `${Math.abs(Math.round(diffMin / 60))}h late`;
  if (diffMin < 0) return `${Math.abs(diffMin)}m late`;
  if (diffMin === 0) return "now";
  if (diffMin < 60) return `in ${diffMin}m`;
  if (diffMin < 24 * 60) return `in ${Math.round(diffMin / 60)}h`;
  return formatClock(iso);
}

export function dayKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function labelDay(key: string, now = new Date()): string {
  if (key === "unscheduled") return "Anytime";
  const today = dayKey(now);
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  if (key === today) return "Today";
  if (key === dayKey(tomorrow)) return "Tomorrow";
  const d = new Date(`${key}T12:00:00`);
  return d.toLocaleDateString([], { weekday: "long", month: "short", day: "numeric" });
}

export function hourLabel(h: number): string {
  const hour = Math.floor(h);
  const min = Math.round((h - hour) * 60);
  const ampm = hour >= 12 ? "pm" : "am";
  const h12 = hour % 12 || 12;
  if (min === 0) return `${h12}${ampm}`;
  return `${h12}:${String(min).padStart(2, "0")}${ampm}`;
}
