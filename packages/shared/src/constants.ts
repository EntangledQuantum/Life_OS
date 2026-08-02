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

export const IMPROVEMENT_PULSES = [
  "Improving",
  "Stable",
  "Recovering",
  "Drifting",
] as const;

export type ImprovementPulse = (typeof IMPROVEMENT_PULSES)[number];

export const ACTIVITIES = [
  "Deep Work",
  "Study",
  "Sleep",
  "Exercise",
  "Break",
  "Life Admin",
] as const;

export type Activity = (typeof ACTIVITIES)[number];

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
