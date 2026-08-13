import type { DashboardToday } from "./types";

/** Snapshot pushed to the Android home-screen widget. */
export type WidgetSnapshot = {
  updatedAt: string;
  date: string;
  pulse: string;
  efficiencyPct: number;
  dailyXp: number;
  dailyXpTarget: number;
  improvementPct: number;
  activity: string | null;
  habitsDone: number;
  habitsTotal: number;
  upcomingTitle: string | null;
  upcomingWhen: string | null;
  timeline: {
    category: string;
    label: string;
    startHour: number;
    endHour: number;
    color: string;
    status: string;
  }[];
  offline: boolean;
};

export function dashboardToWidget(
  d: DashboardToday,
  offline = false,
): WidgetSnapshot {
  const habits = d.habits ?? [];
  /*
   * The next thing landing. `current` is already filtered and ordered by the
   * server — inside the lead window, not past its own end — so the widget shows
   * the same "next" the app does rather than computing a second opinion.
   */
  const upcoming = d.current?.[0] ?? null;
  return {
    updatedAt: new Date().toISOString(),
    date: d.date,
    pulse: d.pulse,
    efficiencyPct: d.progress.efficiencyPct,
    dailyXp: d.progress.dailyXp,
    dailyXpTarget: d.progress.dailyXpTarget,
    improvementPct: d.progress.improvementPct,
    activity: d.activeSession?.activity ?? null,
    habitsDone: habits.filter((h) => h.completedToday).length,
    habitsTotal: habits.length,
    upcomingTitle: upcoming
      ? `${upcoming.emoji ? `${upcoming.emoji} ` : ""}${upcoming.title}`
      : null,
    upcomingWhen: upcoming?.eventAt ?? upcoming?.remindAt ?? null,
    timeline: (d.timeline ?? []).map((t) => ({
      category: t.category,
      label: t.label,
      startHour: t.startHour,
      endHour: t.endHour,
      color: t.color,
      status: t.status,
    })),
    offline,
  };
}
