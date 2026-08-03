/**
 * One-call instance setup for agents.
 *
 * A freshly cloned Life OS boots with demo habits and default hours. An agent
 * meeting a new user shouldn't have to make a dozen round-trips to reshape it —
 * it should be able to describe the person's day once and have the instance
 * match. Everything here is also reachable individually; this is a convenience
 * over the same services, not a second source of truth.
 */
import type { LifeOsDb } from "@life-os/db";
import * as schema from "@life-os/db";
import type { AccentThemeId, GrowthStyle, HabitGraphic } from "@life-os/shared";
import { createHabit, deleteHabit, listHabits, rebalanceHabitXp } from "./habits.js";
import { getSettings, updateGamificationConfig, updateSettings } from "./settings.js";
import { createCard } from "./cards.js";

export interface InitialSetupInput {
  /** Replace the seeded habits instead of adding alongside them. */
  replaceHabits?: boolean;
  habits?: {
    name: string;
    emoji?: string;
    category?: string;
    isTiny?: boolean;
    anchor?: string;
    xpWeight?: number;
    themeColor?: string;
    themeGraphic?: HabitGraphic;
  }[];
  dailyXpTarget?: number;
  growthStyle?: GrowthStyle;
  settings?: Partial<{
    plannedWake: string;
    plannedSleepStart: string;
    plannedSleepEnd: string;
    quietHoursStart: string;
    quietHoursEnd: string;
    dayResetTime: string;
    accentTheme: AccentThemeId;
    celebrationIntensity: "full" | "minimal" | "off";
    reducedMotion: boolean;
    gamificationEnabled: boolean;
    streaksEnabled: boolean;
    pointsEnabled: boolean;
    achievementsEnabled: boolean;
    questsEnabled: boolean;
    agentWebhookUrl: string | null;
    agentWebhookSecret: string | null;
    backupsEnabled: boolean;
    backupIntervalHours: number;
    backupKeep: number;
  }>;
  /** Identify yourself on the setup card so the user can see who is connected. */
  agentName?: string;
  agentSetupCard?: {
    title?: string;
    subtitle?: string;
    body?: string;
    svg?: string | null;
    themeColor?: string;
  };
}

export function runInitialSetup(db: LifeOsDb, input: InitialSetupInput) {
  const removed: string[] = [];
  const created: string[] = [];

  if (input.replaceHabits && input.habits?.length) {
    for (const habit of listHabits(db)) {
      deleteHabit(db, habit.id);
      removed.push(habit.name);
    }
  }

  for (const habit of input.habits ?? []) {
    const result = createHabit(db, {
      name: habit.name,
      emoji: habit.emoji ?? "✨",
      category: habit.category ?? "Custom",
      frequencyRule: "daily",
      isTiny: habit.isTiny ?? true,
      extraXp: 0,
      xpWeight: habit.xpWeight ?? 1,
      // Let the pool assign baseXp; a hand-picked number would be overwritten
      // by the very next rebalance anyway.
      redistribute: true,
      anchor: habit.anchor ?? null,
      themeColor: habit.themeColor,
      themeGraphic: habit.themeGraphic,
    });
    created.push(result.name);
  }

  if (input.settings && Object.keys(input.settings).length > 0) {
    updateSettings(db, input.settings);
  }

  if (input.dailyXpTarget !== undefined || input.growthStyle !== undefined) {
    updateGamificationConfig(db, {
      dailyXpTarget: input.dailyXpTarget,
      growthStyle: input.growthStyle,
    });
  }

  const shares = rebalanceHabitXp(db);

  let setupCard = null;
  if (input.agentName || input.agentSetupCard) {
    const card = createCard(db, {
      kind: "agent-setup",
      title: input.agentSetupCard?.title ?? `${input.agentName ?? "Agent"} connected`,
      subtitle:
        input.agentSetupCard?.subtitle ??
        "Your agent is wired into this instance and can reshape it any time.",
      body: input.agentSetupCard?.body ?? null,
      svg: input.agentSetupCard?.svg ?? null,
      themeColor: input.agentSetupCard?.themeColor ?? "#5B8CFF",
      meta: { connected: true, agent: input.agentName ?? null },
      webhookOnComplete: false,
    });
    if ("card" in card) setupCard = card.card;
  }

  return {
    ok: true as const,
    habitsRemoved: removed,
    habitsCreated: created,
    habits: listHabits(db).length,
    shares,
    settings: getSettings(db),
    setupCard,
    propertiesDefined: db.select().from(schema.agentProperties).all().length,
  };
}
