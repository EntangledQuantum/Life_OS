import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import {
  DEFAULT_ACHIEVEMENTS,
  DEFAULT_GAMIFICATION_CONFIG,
  DEFAULT_SEED_HABITS,
  redistributeDailyXp,
} from "@life-os/shared";
import { createDb, resolveDbPath } from "./client.js";
import { ensureSchema } from "./ensure-schema.js";
import * as schema from "./schema.js";

ensureSchema();
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
    ])
    .run();
}

// Sample schedule blocks for today (local)
const today = new Date();
const y = today.getFullYear();
const m = String(today.getMonth() + 1).padStart(2, "0");
const d = String(today.getDate()).padStart(2, "0");
const dateStr = `${y}-${m}-${d}`;

const blockCount = db.select().from(schema.scheduleBlocks).all().length;
if (blockCount === 0) {
  const blocks = [
    { category: "Sleep", label: "Sleep", plannedStart: "02:00", plannedEnd: "11:00" },
    { category: "Life", label: "Morning buffer", plannedStart: "11:00", plannedEnd: "13:00" },
    { category: "Deep Work", label: "Deep work", plannedStart: "13:00", plannedEnd: "16:00" },
    { category: "Study", label: "Study", plannedStart: "16:30", plannedEnd: "18:30" },
    { category: "Health", label: "Movement", plannedStart: "19:00", plannedEnd: "19:45" },
    { category: "Startup", label: "Build", plannedStart: "20:00", plannedEnd: "23:30" },
    { category: "Break", label: "Wind-down", plannedStart: "00:00", plannedEnd: "02:00" },
  ];
  for (const b of blocks) {
    db.insert(schema.scheduleBlocks)
      .values({
        id: nanoid(),
        date: dateStr,
        category: b.category,
        label: b.label,
        plannedStart: b.plannedStart,
        plannedEnd: b.plannedEnd,
        actualStart: null,
        actualEnd: null,
        status: "planned",
        source: "agent",
        notes: null,
        completedAt: null,
        createdAt: now,
      })
      .run();
  }
}

// Sample agent events
const eventCount = db.select().from(schema.agentEvents).all().length;
if (eventCount === 0) {
  db.insert(schema.agentEvents)
    .values([
      {
        id: nanoid(),
        kind: "review",
        title: "Light SR: Feynman one concept",
        body: "Pick yesterday’s hardest idea and explain it in 3 sentences.",
        link: null,
        forDate: dateStr,
        status: "pending",
        priority: 2,
        xpOnComplete: 15,
        completedAt: null,
        createdAt: now,
      },
      {
        id: nanoid(),
        kind: "task",
        title: "Protect deep work block",
        body: "When Right Now is Deep Work, stay on the block Hermes scheduled.",
        link: null,
        forDate: dateStr,
        status: "pending",
        priority: 1,
        xpOnComplete: 10,
        completedAt: null,
        createdAt: now,
      },
    ])
    .run();
}

// Light review sample
const reviewCount = db.select().from(schema.lightReviews).all().length;
if (reviewCount === 0) {
  db.insert(schema.lightReviews)
    .values({
      id: nanoid(),
      prompt: "Explain one concept from yesterday in 3 sentences (Feynman).",
      forDate: dateStr,
      completedAt: null,
      createdAt: now,
    })
    .run();
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

// Sample agent card (slot 0) if none
const cardCount = db.select().from(schema.dashboardCards).all().length;
if (cardCount === 0) {
  db.insert(schema.dashboardCards)
    .values({
      id: nanoid(),
      slot: 0,
      kind: "task",
      title: "Currently reading",
      subtitle: "Agent can update this anytime",
      body: "Set book title, chapter, and mark done when finished. Completing fires your agent webhook if configured.",
      emoji: "📖",
      themeColor: "#A78BFA",
      imageUrl: null,
      imageData: null,
      svg: null,
      status: "active",
      progress: 20,
      ctaLabel: "Mark chapter done",
      ctaLink: null,
      metaJson: JSON.stringify({ type: "reading", book: null, chapter: 1 }),
      xpOnComplete: 25,
      webhookOnComplete: true,
      completedAt: null,
      createdAt: now,
      updatedAt: now,
    })
    .run();
}

/**
 * Agent setup card (reserved slot 2). Ships disconnected so a fresh install
 * explains how to attach Hermes / OpenClaw; the agent replaces it once connected.
 */
const setupCard = db
  .select()
  .from(schema.dashboardCards)
  .all()
  .find((c) => c.slot === 2);
if (!setupCard) {
  db.insert(schema.dashboardCards)
    .values({
      id: nanoid(),
      slot: 2,
      kind: "agent-setup",
      title: "No agent connected",
      subtitle: "Hermes · OpenClaw · Claude Code · any HTTP agent",
      body:
        "Point your agent at docs/skills/life-os/SKILL.md and give it this API base " +
        "plus the API_TOKEN from .env. It can then create habits, schedule blocks, " +
        "inject reviews, redistribute the daily XP pool, and replace this card.",
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
      status: "active",
      progress: 0,
      ctaLabel: "Read the agent skill",
      ctaLink: "https://github.com/EntangledQuantum/Life_OS/blob/master/docs/skills/life-os/SKILL.md",
      metaJson: JSON.stringify({ connected: false }),
      xpOnComplete: 0,
      webhookOnComplete: false,
      completedAt: null,
      createdAt: now,
      updatedAt: now,
    })
    .run();
}

console.log("Seed complete.");
