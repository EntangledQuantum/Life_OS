import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import {
  DEFAULT_ACHIEVEMENTS,
  DEFAULT_GAMIFICATION_CONFIG,
  DEFAULT_SEED_HABITS,
  redistributeDailyXp,
} from "@life-os/shared";
import { bootstrapDatabase } from "./bootstrap.js";
import { createDb, resolveDbPath } from "./client.js";
import * as schema from "./schema.js";

/*
 * Full bootstrap, not just `ensureSchema`. The versioned migrations are
 * additive — they alter and extend, they do not create the base tables — so on
 * a brand-new file the Drizzle migration folder has to run first. Seeding an
 * empty database used to fail on `no such table: settings`.
 */
bootstrapDatabase();
const db = createDb();
const now = new Date().toISOString();

console.log(`Seeding ${resolveDbPath()}…`);

// Settings
const existingSettings = db.select().from(schema.settings).all();
if (existingSettings.length === 0) {
  db.insert(schema.settings)
    .values({
      gamificationEnabled: true,
      streaksEnabled: true,
      pointsEnabled: true,
      achievementsEnabled: true,
      questsEnabled: true,
      celebrationIntensity: "full",
      accentTheme: "nebula",
      reducedMotion: false,
      plannedWake: "11:00",
      plannedSleepStart: "02:00",
      plannedSleepEnd: "03:00",
      quietHoursStart: "03:30",
      quietHoursEnd: "10:30",
      dayResetTime: "04:00",
      storageMode: "local",
      updatedAt: now,
    })
    .run();
}

// Progress
const existingProgress = db.select().from(schema.userProgress).all();
if (existingProgress.length === 0) {
  db.insert(schema.userProgress)
    .values({
      totalXp: 0,
      currentLevel: 1,
      lastImprovementPulse: "Stable",
      updatedAt: now,
    })
    .run();
}

// Gamification config
const existingCfg = db.select().from(schema.gamificationConfig).all();
if (existingCfg.length === 0) {
  db.insert(schema.gamificationConfig)
    .values({
      configJson: JSON.stringify(DEFAULT_GAMIFICATION_CONFIG),
      updatedAt: now,
    })
    .run();
}

// Achievements
for (const a of DEFAULT_ACHIEVEMENTS) {
  const found = db
    .select()
    .from(schema.achievements)
    .where(eq(schema.achievements.key, a.key))
    .all();
  if (found.length === 0) {
    db.insert(schema.achievements)
      .values({
        id: nanoid(),
        key: a.key,
        title: a.title,
        description: a.description,
        emoji: a.emoji,
        xpBonus: a.xpBonus,
        unlockedAt: null,
      })
      .run();
  }
}

// Habits
const habitCount = db.select().from(schema.habits).all().length;
if (habitCount === 0) {
  for (const h of DEFAULT_SEED_HABITS) {
    db.insert(schema.habits)
      .values({
        id: nanoid(),
        name: h.name,
        emoji: h.emoji,
        category: h.category,
        frequencyRule: "daily",
        preferredTimeWindow: "any",
        anchor: h.anchor,
        linkedGoalId: null,
        isTiny: h.isTiny,
        baseXp: h.baseXp,
        active: true,
        notes: null,
        themeColor: h.themeColor,
        themeGraphic: h.themeGraphic,
        iconKey: null,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      })
      .run();
  }
}

// Sample goals
const goalCount = db.select().from(schema.goals).all().length;
if (goalCount === 0) {
  db.insert(schema.goals)
    .values([
      {
        id: nanoid(),
        title: "Protect deep work",
        description: "Ship meaningful blocks even on irregular days",
        status: "active",
        targetDate: null,
        whyItMatters: "Civilization-scale impact needs focused hours",
        progressPct: 20,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: nanoid(),
        title: "Active learning flywheel",
        description: "Study with retrieval & Feynman, not passive scroll",
        status: "active",
        targetDate: null,
        whyItMatters: "Thinking better compounds forever",
        progressPct: 15,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: nanoid(),
        title: "Sleep as a skill",
        description: "Night-owl friendly consistency, not shame",
        status: "active",
        targetDate: null,
        whyItMatters: "Energy is the real productivity system",
        progressPct: 10,
        createdAt: now,
        updatedAt: now,
      },
      {
        // Demonstrates the condition mechanism on a fresh clone. Deliberately
        // starts unmet, so nobody gets a celebration modal they didn't earn.
        id: nanoid(),
        title: "Finish 3 books",
        description:
          "Example of an agent-set goal. Your agent pushes to the books_read counter; this checks itself.",
        status: "active",
        targetDate: null,
        whyItMatters: "You said you missed reading",
        progressPct: 0,
        ownerKind: "agent",
        conditionJson: JSON.stringify({
          type: "property",
          key: "books_read",
          op: ">=",
          value: 3,
        }),
        autoCheck: true,
        emoji: "📚",
        themeColor: "#A78BFA",
        createdAt: now,
        updatedAt: now,
      },
    ])
    .run();
}

// The counter the example goal watches, so the wiring is visible on day one.
const propertyCount = db.select().from(schema.agentProperties).all().length;
if (propertyCount === 0) {
  db.insert(schema.agentProperties)
    .values({
      id: nanoid(),
      key: "books_read",
      label: "Books finished",
      kind: "counter",
      value: 0,
      unit: "books",
      description:
        "Example agent counter. POST /api/v1/properties/books_read/increment",
      createdBy: "seed",
      createdAt: now,
      updatedAt: now,
    })
    .run();
}

// Today, in local time. The seeded day is drawn against this.
const today = new Date();
const y = today.getFullYear();
const m = String(today.getMonth() + 1).padStart(2, "0");
const d = String(today.getDate()).padStart(2, "0");
const dateStr = `${y}-${m}-${d}`;

/** Local HH:mm today, as an ISO instant. */
function at(hhmm: string): string {
  const [hh, mm] = hhmm.split(":").map(Number);
  const dt = new Date(today);
  dt.setHours(hh ?? 0, mm ?? 0, 0, 0);
  return dt.toISOString();
}

// Quest sample
const questCount = db.select().from(schema.quests).all().length;
if (questCount === 0) {
  db.insert(schema.quests)
    .values({
      id: nanoid(),
      title: "Complete 3 habits today",
      description: "Any three — tiny wins count",
      targetCount: 3,
      progressCount: 0,
      xpBonus: 40,
      forDate: dateStr,
      completedAt: null,
      createdAt: now,
    })
    .run();
}

// Rebalance habit XP from daily pool (new habits don't raise the ceiling)
{
  const active = db
    .select()
    .from(schema.habits)
    .all()
    .filter((h) => h.active && !h.deletedAt);
  const shares = redistributeDailyXp(
    active.map((h) => ({ id: h.id, xpWeight: 1, active: true })),
    DEFAULT_GAMIFICATION_CONFIG.dailyXpTarget,
  );
  for (const [id, baseXp] of shares) {
    db.update(schema.habits)
      .set({ baseXp, extraXp: 0, xpWeight: 1 })
      .where(eq(schema.habits.id, id))
      .run();
  }
}

/**
 * A seeded day.
 *
 * Every one of these is a row in `tasks` — there is no separate table for a
 * schedule block, an agent event or a review any more, so a fresh install shows
 * the same shape a real one does. One is pinned as a front-page card; the rest
 * live on the Timeline until their time comes round.
 */
interface SeedTask {
  kind: "task" | "study" | "review" | "reminder";
  title: string;
  subtitle?: string;
  body?: string;
  activityTag?: string;
  eventAt?: string;
  durationMinutes?: number;
  repeatRule?: "none" | "daily" | "weekly" | "spaced";
  themeColor?: string;
  emoji?: string;
  progress?: number;
  slot?: 0 | 1;
  xpOnComplete?: number;
  webhookOnComplete?: boolean;
  resources?: { label: string; url: string; kind?: string }[];
  meta?: Record<string, unknown>;
}

const taskCount = db.select().from(schema.tasks).all().length;
if (taskCount === 0) {
  const seeded: SeedTask[] = [
    {
      kind: "task",
      title: "Deep work",
      activityTag: "Deep Work",
      eventAt: at("13:00"),
      durationMinutes: 180,
      themeColor: "#A78BFA",
      emoji: "🎯",
      xpOnComplete: 30,
    },
    {
      kind: "study",
      title: "Read one chapter",
      subtitle: "Whatever your agent has you on",
      body:
        "Read it once for shape, then again with a pen. Write three sentences " +
        "you could say out loud to someone who has not read it.",
      activityTag: "Study",
      eventAt: at("16:30"),
      durationMinutes: 120,
      themeColor: "#C084FC",
      emoji: "📖",
      xpOnComplete: 25,
      resources: [
        {
          label: "The Feynman technique",
          url: "https://fs.blog/feynman-technique/",
          kind: "link",
        },
      ],
    },
    {
      kind: "task",
      title: "Move for 45 minutes",
      activityTag: "Exercise",
      eventAt: at("19:00"),
      durationMinutes: 45,
      themeColor: "#34D399",
      emoji: "🏃",
      xpOnComplete: 20,
    },
    {
      /* No time on it — this is the "whenever" pile on the Timeline. */
      kind: "review",
      title: "Explain one concept in three sentences",
      body:
        "Pick yesterday's hardest idea. If you cannot say it plainly, you have " +
        "not got it yet.",
      emoji: "🧠",
      xpOnComplete: 15,
      repeatRule: "daily",
    },
    {
      kind: "task",
      title: "Currently reading",
      subtitle: "Your agent can update this any time",
      body:
        "A pinned card is just a task the agent chose to draw large. Completing " +
        "it fires a webhook, if the agent subscribed to one.",
      slot: 0,
      emoji: "📚",
      themeColor: "#A78BFA",
      progress: 20,
      xpOnComplete: 25,
      webhookOnComplete: true,
      meta: { type: "reading", book: null, chapter: 1 },
    },
  ];

  for (const t of seeded) {
    db.insert(schema.tasks)
      .values({
        id: nanoid(),
        kind: t.kind,
        title: t.title,
        subtitle: t.subtitle ?? null,
        body: t.body ?? null,
        purpose: null,
        status: "active",
        activityTag: t.activityTag ?? null,
        showAt: null,
        eventAt: t.eventAt ?? null,
        durationMinutes: t.durationMinutes ?? null,
        remindAt: null,
        notifiedAt: null,
        repeatRule: t.repeatRule ?? "none",
        repeatIndex: 0,
        repeatOffsetsJson: null,
        xpOnComplete: t.xpOnComplete ?? 0,
        webhookOnComplete: t.webhookOnComplete ?? false,
        webhookOnInteract: false,
        resourcesJson: t.resources ? JSON.stringify(t.resources) : null,
        slot: t.slot ?? null,
        emoji: t.emoji ?? null,
        themeColor: t.themeColor ?? null,
        imageUrl: null,
        imageData: null,
        svg: null,
        ctaLabel: null,
        ctaLink: null,
        controlJson: null,
        progress: t.progress ?? 0,
        sound: true,
        flash: true,
        source: "agent",
        metaJson: t.meta ? JSON.stringify(t.meta) : null,
        completedAt: null,
        createdAt: now,
        updatedAt: now,
      })
      .run();
  }
}

/**
 * The agent status strip. Ships disconnected so a fresh install explains how to
 * attach an agent; the agent overwrites it once connected. Marked by
 * `meta.connected`, and deliberately holding no slot — the two content slots are
 * for cards you act on, and this is not one of them.
 */
const statusStrip = db
  .select()
  .from(schema.tasks)
  .all()
  .find((t) => (t.metaJson ?? "").includes('"connected"'));
if (!statusStrip) {
  db.insert(schema.tasks)
    .values({
      id: nanoid(),
      kind: "task",
      title: "No agent connected",
      subtitle: "Hermes · OpenClaw · Claude Code · any MCP client",
      body:
        "Point your agent at docs/skills/life-os/SKILL.md and give it this " +
        "instance's MCP endpoint plus the API_TOKEN from .env. It can then " +
        "create habits and tasks, redistribute the daily XP pool, subscribe to " +
        "completions, and replace this strip.",
      purpose: null,
      status: "active",
      activityTag: null,
      showAt: null,
      eventAt: null,
      durationMinutes: null,
      remindAt: null,
      notifiedAt: null,
      repeatRule: "none",
      repeatIndex: 0,
      repeatOffsetsJson: null,
      xpOnComplete: 0,
      webhookOnComplete: false,
      webhookOnInteract: false,
      resourcesJson: null,
      slot: null,
      emoji: "🤖",
      themeColor: "#5B8CFF",
      imageUrl: null,
      imageData: null,
      svg:
        '<svg viewBox="0 0 120 72" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Agent not connected">' +
        '<rect x="6" y="20" width="38" height="32" rx="8" fill="none" stroke="#5B8CFF" stroke-width="2"/>' +
        '<circle cx="19" cy="34" r="3.2" fill="#5B8CFF"/><circle cx="31" cy="34" r="3.2" fill="#5B8CFF"/>' +
        '<path d="M18 43h14" stroke="#5B8CFF" stroke-width="2" stroke-linecap="round"/>' +
        '<path d="M25 20v-7" stroke="#5B8CFF" stroke-width="2" stroke-linecap="round"/>' +
        '<circle cx="25" cy="11" r="2.4" fill="#5B8CFF"/>' +
        '<path d="M50 36h8M62 36h8" stroke="#64748B" stroke-width="2" stroke-linecap="round" stroke-dasharray="1 5"/>' +
        '<rect x="76" y="20" width="38" height="32" rx="8" fill="none" stroke="#64748B" stroke-width="2"/>' +
        '<path d="M86 30h18M86 36h18M86 42h11" stroke="#64748B" stroke-width="2" stroke-linecap="round"/>' +
        "</svg>",
      ctaLabel: "Read the agent skill",
      ctaLink:
        "https://github.com/EntangledQuantum/Life_OS/blob/master/docs/skills/life-os/SKILL.md",
      controlJson: null,
      progress: 0,
      sound: false,
      flash: false,
      source: "agent",
      metaJson: JSON.stringify({ connected: false }),
      completedAt: null,
      createdAt: now,
      updatedAt: now,
    })
    .run();
}

console.log("Seed complete.");
