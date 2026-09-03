import { eq } from "drizzle-orm";
import type { LifeOsDb } from "@life-os/db";
import * as schema from "@life-os/db";
import {
  efficiencyPct,
  paceAdjustedImprovementPct,
  type DashboardToday,
} from "@life-os/shared";
import {
  getLocalDayBounds,
  getProgressRow,
  loadGamificationConfig,
  nowIso,
} from "./helpers.js";
import { listHabits } from "./habits.js";
import { listStudySessions } from "./study.js";
import { listGoals, pendingCelebrations } from "./goals.js";
import { listProperties } from "./properties.js";
import { listAchievements } from "./achievements.js";
import { listQuests } from "./quests.js";
import { getActiveSession, listActivityLog } from "./sessions.js";
import { listCurrentTasks, listDueTasks, listOpenTasks } from "./tasks.js";
import { getAgenda, rolloverPastDays } from "./agenda.js";
import {
  getConsistencySeries,
  getPulse,
  getTodayXp,
  getVsYesterday,
  getXpSeries,
  refreshTodaySnapshot,
} from "./snapshots.js";

const CATEGORY_COLORS: Record<string, string> = {
  Sleep: "#6366F1",
  Life: "#5B8CFF",
  "Life Admin": "#5B8CFF",
  "Deep Work": "#A78BFA",
  Study: "#C084FC",
  Health: "#34D399",
  Break: "#94A3B8",
  Startup: "#FBBF24",
  Exercise: "#34D399",
  Exploration: "#F472B6",
};

/** Clock hour (0–24) — the ribbon is drawn against the wall clock, not the life-day. */
function clockHour(d: Date): number {
  return d.getHours() + d.getMinutes() / 60;
}

/**
 * What was actually done, from the start of the day up to `nowHour`.
 * Gaps stay as an explicit "unlogged" segment rather than being papered over
 * with the plan — an hour you did not record is information, not a Deep Work
 * block you can take credit for.
 */
function buildActualSegments(
  db: LifeOsDb,
  dateStr: string,
  nowHour: number,
): {
  id: string;
  category: string;
  label: string;
  startHour: number;
  endHour: number;
  color: string;
  status: string;
  actual: boolean;
}[] {
  const out: ReturnType<typeof buildActualSegments> = [];
  let cursor = 0;

  for (const entry of listActivityLog(db, dateStr)) {
    const from = Math.max(0, Math.min(24, clockHour(new Date(entry.startedAt))));
    const to = Math.max(
      from,
      Math.min(
        nowHour,
        entry.endedAt ? clockHour(new Date(entry.endedAt)) : nowHour,
      ),
    );
    if (to <= from + 1e-6) continue;

    if (from > cursor + 1e-6) {
      out.push({
        id: `unlogged-${cursor.toFixed(3)}`,
        category: "Unlogged",
        label: "Not recorded",
        startHour: cursor,
        endHour: from,
        color: "rgba(255,255,255,0.05)",
        status: "unlogged",
        actual: true,
      });
    }

    out.push({
      id: `did-${entry.id}`,
      category: entry.activity,
      label: entry.activity,
      startHour: from,
      endHour: to,
      color: CATEGORY_COLORS[entry.activity] ?? "#5B8CFF",
      status: "done",
      actual: true,
    });
    cursor = to;
  }

  if (nowHour > cursor + 1e-6) {
    out.push({
      id: `unlogged-${cursor.toFixed(3)}`,
      category: "Unlogged",
      label: "Not recorded",
      startHour: cursor,
      endHour: nowHour,
      color: "rgba(255,255,255,0.05)",
      status: "unlogged",
      actual: true,
    });
  }

  return out;
}

export function getDashboard(db: LifeOsDb): DashboardToday {
  /*
   * Close out anything whose day has ended before reading a thing. Yesterday's
   * leftovers used to sit on today's list and pay today's XP when ticked, which
   * flatters today and hides the fact that yesterday was missed.
   */
  rolloverPastDays(db);
  refreshTodaySnapshot(db);
  const config = loadGamificationConfig(db);
  const progressRow = getProgressRow(db);
  const pulse = getPulse(db);
  const vsYesterday = getVsYesterday(db);
  const { dateStr, resetTime } = getLocalDayBounds(db);
  const dailyXp = getTodayXp(db);
  const dailyXpTarget = config.dailyXpTarget;
  const eff = efficiencyPct(dailyXp, dailyXpTarget);
  const yEff = vsYesterday.efficiency.yesterday;
  const agenda = getAgenda(db);

  /*
   * Against where yesterday had got to by this hour, not against its total.
   * The raw delta compares a day in progress with a day that finished, so it
   * greeted the user with roughly -100% every morning — an artefact of the
   * clock presented as a verdict.
   */
  const nowMs = Date.now();
  const dayStart = Date.parse(agenda.lifeDay.lifeDayStart);
  const dayEnd = Date.parse(agenda.lifeDay.lifeDayEnd);
  const dayFraction =
    dayEnd > dayStart
      ? Math.max(0, Math.min(1, (nowMs - dayStart) / (dayEnd - dayStart)))
      : 1;
  const imp = paceAdjustedImprovementPct(eff, yEff, dayFraction);

  /**
   * The planned shape of the day, from the agenda rather than from tasks alone.
   *
   * A habit with a time is a block like any other — that is the whole point of
   * giving habits a time. Reading only tasks here is what used to force an
   * agent to create a companion task just to make a habit visible on the
   * ribbon, and that companion task was the duplicate.
   */
  const blocks = agenda.items
    .filter((item) => item.startHour !== null && item.endHour !== null)
    .map((item) => ({
      id: item.id,
      category:
        item.activityTag ?? (item.kind === "study" ? "Study" : "Deep Work"),
      label: item.title,
      startHour: item.startHour!,
      endHour: item.endHour!,
      status: item.done ? "done" : "planned",
    }));

  /**
   * Continuous solid color strip for the full 0–24h day.
   * - Keep each block’s category color (do NOT merge categories).
   * - Clip overlaps.
   * - Close gaps by extending each segment to the next start (no black Free holes).
   * - Pin first.start=0 and last.end=24.
   */
  type Seg = {
    id: string;
    category: string;
    label: string;
    startHour: number;
    endHour: number;
    color: string;
    status: string;
    actual: boolean;
  };

  const segs = blocks
    .map((b) => {
      let start = b.startHour;
      let end = b.endHour;
      if (end <= start) end += 24;
      start = Math.max(0, Math.min(24, start));
      end = Math.max(start, Math.min(24, end > 24 ? 24 : end));
      return {
        id: b.id,
        category: b.category,
        label: b.label,
        start,
        end,
        color: CATEGORY_COLORS[b.category] ?? "#5B8CFF",
        status: (b.status as string) ?? "planned",
      };
    })
    .filter((s) => s.end > s.start + 1e-6)
    .sort((a, b) => a.start - b.start || a.end - b.end);

  // Resolve overlaps: later block starts at earlier end
  for (let i = 1; i < segs.length; i++) {
    if (segs[i]!.start < segs[i - 1]!.end) {
      segs[i]!.start = segs[i - 1]!.end;
    }
  }
  const cleaned = segs.filter((s) => s.end > s.start + 1e-6);

  // Close gaps + pin day ends — neighbors share a boundary (solid ribbon)
  if (cleaned.length > 0) {
    cleaned[0]!.start = 0;
    for (let i = 0; i < cleaned.length - 1; i++) {
      cleaned[i]!.end = cleaned[i + 1]!.start;
    }
    cleaned[cleaned.length - 1]!.end = 24;
  }

  const planned: Seg[] =
    cleaned.length > 0
      ? cleaned.map((s) => ({
          id: s.id,
          category: s.category,
          label: s.label,
          startHour: s.start,
          endHour: s.end,
          color: s.color,
          status: s.status,
          actual: false,
        }))
      : [
          {
            id: "empty-day",
            category: "Life",
            label: "Unscheduled",
            startHour: 0,
            endHour: 24,
            color: CATEGORY_COLORS.Life ?? "#5B8CFF",
            status: "planned",
            actual: false,
          },
        ];

  /**
   * The ribbon is two different things either side of the now-marker.
   *
   * Ahead of it, the plan: what the agent laid out. Behind it, what actually
   * happened, from `activity_log` — the day painting itself in as you live it.
   * Drawing the plan across hours that have already passed says nothing about
   * whether you did any of it.
   */
  const nowHour = clockHour(new Date());
  const lived = buildActualSegments(db, dateStr, nowHour);

  const ahead = planned
    .map((seg) => ({ ...seg, startHour: Math.max(seg.startHour, nowHour) }))
    .filter((seg) => seg.endHour > seg.startHour + 1e-6);

  let timeline: Seg[] = [...lived, ...ahead];

  const active = getActiveSession(db);

  return {
    date: dateStr,
    dayResetTime: resetTime,
    lifeDay: agenda.lifeDay,
    agenda: agenda.items,
    anytime: agenda.anytime,

    tasks: listOpenTasks(db),
    // Only what is current; the Timeline tab has the rest.
    current: listCurrentTasks(db),
    dueReminders: listDueTasks(db),
    pendingCelebrations: pendingCelebrations(db),
    properties: listProperties(db),
    habits: listHabits(db),
    progress: {
      totalXp: progressRow.totalXp,
      dailyXp,
      dailyXpTarget,
      efficiencyPct: eff,
      improvementPct: imp,
      yesterdayEfficiencyPct: yEff,
      lastImprovementPulse: pulse.pulse,
      growthStyle: config.growthStyle,
      // Mirrored for any pre-rename client still reading nurtureStyle.
      nurtureStyle: config.growthStyle,
    },
    vsYesterday,
    pulse: pulse.pulse,
    pulseExplanation: pulse.explanation,
    studySessions: listStudySessions(db, 20),
    goals: listGoals(db),
    quests: listQuests(db),
    achievements: listAchievements(db),
    consistency7: getConsistencySeries(db, 7),
    xpSeries7: getXpSeries(db, 7),
    activeSession: active
      ? {
          activity: active.activity,
          startedAt: active.startedAt,
          blockId: (active as { blockId?: string | null }).blockId ?? null,
        }
      : null,
    timeline,
  };
}

/*
 * Session mutation lives in `sessions.ts` now, because every change also has to
 * close and open an `activity_log` interval. Re-exported here so existing
 * callers and routes keep working.
 */
export { setActiveSession, clearActiveSession } from "./sessions.js";
