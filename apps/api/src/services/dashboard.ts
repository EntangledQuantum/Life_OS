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
import { listGoals } from "./goals.js";
import { listAchievements } from "./achievements.js";
import { listLightReviews, listQuests } from "./quests.js";
import { listAgentEvents } from "./events.js";
import { listStudyBlocks } from "./blocks.js";
import { listCards } from "./cards.js";
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
  "Deep Work": "#A78BFA",
  Study: "#C084FC",
  Health: "#34D399",
  Break: "#94A3B8",
  Startup: "#FBBF24",
  Exercise: "#34D399",
};

export function getDashboard(db: LifeOsDb): DashboardToday {
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

  let timeline: Seg[] =
    cleaned.length > 0
      ? cleaned.map((s) => ({
          id: s.id,
          category: s.category,
          label: s.label,
          startHour: s.start,
          endHour: s.end,
          color: s.color,
          status: s.status,
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
          },
        ];

  // Enforce chain: each start === previous end (kill any float holes)
  for (let i = 1; i < timeline.length; i++) {
    timeline[i]!.startHour = timeline[i - 1]!.endHour;
  }
  if (timeline.length) {
    timeline[0]!.startHour = 0;
    timeline[timeline.length - 1]!.endHour = 24;
  }
  timeline = timeline.filter((s) => s.endHour > s.startHour + 1e-6);

  const active = db.select().from(schema.activeSessions).limit(1).get();
  const agentEvents = listAgentEvents(db);
  const pendingEventCount = agentEvents.filter((e) => e.status === "pending").length;

  return {
    date: dateStr,
    dayResetTime: resetTime,
    cards: listCards(db).filter((c) => c.status !== "hidden"),
    habits: listHabits(db),
    progress: {
      totalXp: progressRow.totalXp,
      dailyXp,
      dailyXpTarget,
      efficiencyPct: eff,
      improvementPct: imp,
      yesterdayEfficiencyPct: yEff,
      lastImprovementPulse: pulse.pulse,
      nurtureStyle: config.nurtureStyle ?? "plant",
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

export function setActiveSession(
  db: LifeOsDb,
  activity: string,
  startedAt?: string,
  blockId?: string | null,
) {
  db.delete(schema.activeSessions).run();
  const started = startedAt ?? nowIso();
  db.insert(schema.activeSessions)
    .values({ activity, startedAt: started, blockId: blockId ?? null })
    .run();
  return { activity, startedAt: started, blockId: blockId ?? null };
}

export function clearActiveSession(db: LifeOsDb) {
  db.delete(schema.activeSessions).run();
  return { ok: true };
}

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
