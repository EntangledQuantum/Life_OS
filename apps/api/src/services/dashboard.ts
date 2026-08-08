import { eq } from "drizzle-orm";
import type { LifeOsDb } from "@life-os/db";
import * as schema from "@life-os/db";
import {
  efficiencyPct,
  improvementPct,
  type DashboardToday,
} from "@life-os/shared";
import {
  getLocalDayBounds,
  getProgressRow,
  hourFromTime,
  loadGamificationConfig,
  nowIso,
} from "./helpers.js";
import { listHabits } from "./habits.js";
import { listStudySessions } from "./study.js";
import { listGoals, pendingCelebrations } from "./goals.js";
import { listProperties } from "./properties.js";
import { listAchievements } from "./achievements.js";
import { listLightReviews, listQuests } from "./quests.js";
import { listAgentEvents } from "./events.js";
import {
  getActiveSession,
  listActivityLog,
  settleActiveSession,
} from "./sessions.js";
import { listStudyBlocks } from "./blocks.js";
import {
  listDueReminders,
  listImminentCards,
  listPinnedCards,
  listUpcomingCards,
} from "./cards.js";
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
  // A timed session that has run out ends here — reading the dashboard is the
  // only moment the answer matters, and a personal app has no scheduler awake
  // at 3am to do it on a timer.
  settleActiveSession(db);
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
  const imp = improvementPct(eff, yEff);

  const blocks = db
    .select()
    .from(schema.scheduleBlocks)
    .where(eq(schema.scheduleBlocks.date, dateStr))
    .all();

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
      let start = hourFromTime(b.plannedStart) ?? 0;
      let end = hourFromTime(b.plannedEnd) ?? start + 1;
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
  const agentEvents = listAgentEvents(db);
  const pendingEventCount = agentEvents.filter((e) => e.status === "pending").length;

  return {
    date: dateStr,
    dayResetTime: resetTime,
    cards: listPinnedCards(db).filter((c) => c.status !== "hidden"),
    // Dashboard shows only what is about to happen; the Timeline tab has the rest.
    upcoming: listImminentCards(db),
    scheduled: listUpcomingCards(db),
    dueReminders: listDueReminders(db),
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
    studyBlocks: listStudyBlocks(db),
    studySessions: listStudySessions(db, 20),
    goals: listGoals(db),
    quests: listQuests(db),
    lightReviews: listLightReviews(db),
    agentEvents,
    pendingEventCount,
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
export {
  setActiveSession,
  clearActiveSession,
  endActiveSession,
} from "./sessions.js";

export function getAnalytics(db: LifeOsDb) {
  const dash = getDashboard(db);
  const snaps = db.select().from(schema.dailySnapshots).all();

  const byCategory: Record<string, { completed: number; total: number }> = {};
  for (const h of dash.habits) {
    const cat = h.category;
    if (!byCategory[cat]) byCategory[cat] = { completed: 0, total: 0 };
    byCategory[cat].total += 1;
    if (h.completedToday) byCategory[cat].completed += 1;
  }

  return {
    consistency7: dash.consistency7,
    xpSeries7: dash.xpSeries7,
    byCategory: Object.entries(byCategory).map(([category, v]) => ({
      category,
      pct: v.total ? Math.round((v.completed / v.total) * 100) : 0,
    })),
    achievements: dash.achievements,
    progress: dash.progress,
    pulse: dash.pulse,
    pulseHistory: snaps
      .slice(-14)
      .map((s) => ({ date: s.date, pulse: s.improvementPulse })),
  };
}
