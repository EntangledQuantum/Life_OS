export const ACCENT_THEMES = {
  nebula: { name: "Nebula", hue: 224 },
  quantum: { name: "Quantum", hue: 296 },
  terminal: { name: "Terminal", hue: 150 },
  ember: { name: "Ember", hue: 38 },
} as const;

export type AccentThemeId = keyof typeof ACCENT_THEMES;

export const CATEGORIES = [
  "Life",
  "Health",
  "Study",
  "Deep Work",
  "Startup",
  "Exploration",
  "Custom",
] as const;

export type Category = (typeof CATEGORIES)[number];

export const QUALITY_FLAGS = [
  "normal",
  "struggle",
  "inspired",
  "feynman",
  "retrieval",
] as const;

export type QualityFlag = (typeof QUALITY_FLAGS)[number];

export const HABIT_GRAPHICS = [
  "ring",
  "liquid",
  "tree",
  "flame",
  "none",
] as const;

export type HabitGraphic = (typeof HABIT_GRAPHICS)[number];

/**
 * Daily-progress visual styles ("Growth meter").
 *
 * Renamed from the old `nurtureStyle` (`plant` | `water` | `both`) because
 * "water" read as the drinking-water habit. The concept is nurturing growth
 * toward the daily XP target, not hydration.
 */
export const GROWTH_STYLES = ["sprout", "orb"] as const;

export type GrowthStyle = (typeof GROWTH_STYLES)[number];

/** Legacy values still accepted from older agents / stored configs. */
export const LEGACY_GROWTH_STYLES = ["plant", "water", "both"] as const;

/** Map any historical or current value onto a supported GrowthStyle. */
export function normalizeGrowthStyle(value: unknown): GrowthStyle {
  switch (value) {
    case "orb":
    case "water":
      return "orb";
    case "sprout":
    case "plant":
    case "both":
      return "sprout";
    default:
      return "sprout";
  }
}

/** How a card repeats after it is completed. */
export const REPEAT_RULES = ["none", "daily", "weekly", "spaced"] as const;
export type RepeatRule = (typeof REPEAT_RULES)[number];

/**
 * Default expanding-interval ladder (days) for `repeatRule: "spaced"`.
 * Completing occurrence *n* schedules the next one `SPACED_OFFSETS[n]` days out;
 * once the ladder is exhausted the card stops repeating.
 */
export const SPACED_OFFSETS_DAYS = [1, 3, 7, 14, 30, 60] as const;

/**
 * Reminder chimes.
 *
 * All of these are synthesized by the client at play time rather than shipped
 * as audio files — nothing to 404, no extra request, and it works identically
 * on the static Pages build. A client on another platform is free to map these
 * ids onto native system sounds instead; the id is the contract, not the
 * waveform.
 */
export const NOTIFICATION_SOUNDS = [
  {
    id: "chime",
    label: "Chime",
    description: "Two rising notes. Clear without being startling.",
  },
  {
    id: "bell",
    label: "Bell",
    description: "A single struck bell with a long tail.",
  },
  {
    id: "marimba",
    label: "Marimba",
    description: "Three soft wooden notes. The gentlest option.",
  },
  {
    id: "pulse",
    label: "Pulse",
    description: "Two low blips. Discreet enough for a shared room.",
  },
  {
    id: "alert",
    label: "Alert",
    description: "Insistent and hard to miss. For things you must not sleep through.",
  },
  {
    id: "none",
    label: "Silent",
    description: "No sound at all — reminders still flash on screen.",
  },
] as const;

export type NotificationSoundId = (typeof NOTIFICATION_SOUNDS)[number]["id"];

export const NOTIFICATION_SOUND_IDS = NOTIFICATION_SOUNDS.map((s) => s.id) as [
  NotificationSoundId,
  ...NotificationSoundId[],
];

export function isNotificationSound(value: unknown): value is NotificationSoundId {
  return (
    typeof value === "string" &&
    (NOTIFICATION_SOUND_IDS as readonly string[]).includes(value)
  );
}

export const IMPROVEMENT_PULSES = [
  "Improving",
  "Stable",
  "Recovering",
  "Drifting",
] as const;

export type ImprovementPulse = (typeof IMPROVEMENT_PULSES)[number];

/**
 * The abstract shape of a day. Everything schedulable — timeline blocks, the
 * "Right now" switcher, and agent event cards — is tagged with one of these.
 *
 * This list is deliberately closed: an agent may invent any *content* it likes
 * but must map it onto one of these buckets, so the timeline and the daily
 * stats stay comparable across days. `Exploration` is the creative /
 * curiosity-driven bucket (side quests, tinkering, art, wandering research).
 */
export const ACTIVITIES = [
  "Deep Work",
  "Study",
  "Sleep",
  "Exercise",
  "Break",
  "Life Admin",
  "Exploration",
] as const;

export type Activity = (typeof ACTIVITIES)[number];

/**
 * Tags an agent may attach to a schedulable card. Identical to ACTIVITIES —
 * named separately because it is the *contract* agents code against, and
 * because a card carrying one of these auto-activates the matching timeline
 * bucket when the user starts it.
 */
export const CARD_ACTIVITY_TAGS = ACTIVITIES;
export type CardActivityTag = Activity;

export function isActivityTag(value: unknown): value is Activity {
  return (
    typeof value === "string" && (ACTIVITIES as readonly string[]).includes(value)
  );
}

/** Distinct accent colors for new habits */
export const HABIT_COLOR_PALETTE = [
  "#5B8CFF",
  "#A78BFA",
  "#34D399",
  "#FBBF24",
  "#F472B6",
  "#22D3EE",
  "#FB923C",
  "#4ADE80",
  "#818CF8",
  "#E879F9",
];

export const DEFAULT_SEED_HABITS = [
  {
    name: "Wake window",
    emoji: "🌅",
    category: "Life" as const,
    isTiny: true,
    baseXp: 15,
    themeColor: "#FBBF24",
    themeGraphic: "ring" as const,
    anchor: "when I leave bed",
  },
  {
    name: "Water",
    emoji: "💧",
    category: "Health" as const,
    isTiny: true,
    baseXp: 10,
    themeColor: "#22D3EE",
    themeGraphic: "liquid" as const,
    anchor: "after I sit at desk",
  },
  {
    name: "Study session",
    emoji: "📚",
    category: "Study" as const,
    isTiny: false,
    baseXp: 40,
    themeColor: "#A78BFA",
    themeGraphic: "tree" as const,
    anchor: "when I open Learning Vault",
  },
  {
    name: "Deep work block",
    emoji: "🎯",
    category: "Deep Work" as const,
    isTiny: false,
    baseXp: 50,
    themeColor: "#5B8CFF",
    themeGraphic: "flame" as const,
    anchor: "after first water",
  },
  {
    name: "Movement",
    emoji: "🏃",
    category: "Health" as const,
    isTiny: true,
    baseXp: 20,
    themeColor: "#34D399",
    themeGraphic: "ring" as const,
    anchor: "after deep work",
  },
  {
    name: "Sleep wind-down",
    emoji: "🌙",
    category: "Life" as const,
    isTiny: true,
    baseXp: 15,
    themeColor: "#818CF8",
    themeGraphic: "ring" as const,
    anchor: "when screens go dark",
  },
] as const;

export const DEFAULT_ACHIEVEMENTS = [
  {
    key: "first_complete",
    title: "First spark",
    description: "Complete any habit",
    emoji: "✨",
    xpBonus: 25,
  },
  {
    key: "tiny_habit_master",
    title: "Tiny Habit Master",
    description: "Complete 10 tiny habits",
    emoji: "🌱",
    xpBonus: 50,
  },
  {
    key: "first_inspired",
    title: "Inspired mind",
    description: "Log a study session marked inspired",
    emoji: "💡",
    xpBonus: 75,
  },
  {
    key: "wake_7",
    title: "7-day wake consistency",
    description: "Complete wake habit 7 times",
    emoji: "☀️",
    xpBonus: 100,
  },
  {
    key: "streak_recovered",
    title: "Streak recovered",
    description: "Restart a habit after a pause",
    emoji: "🔄",
    xpBonus: 40,
  },
  {
    key: "night_owl_study",
    title: "Night owl who still studied",
    description: "Log a study session after 23:00 local",
    emoji: "🦉",
    xpBonus: 60,
  },
  {
    key: "deep_work_10",
    title: "10 deep work blocks",
    description: "Complete deep work habit 10 times",
    emoji: "🔥",
    xpBonus: 120,
  },
] as const;
