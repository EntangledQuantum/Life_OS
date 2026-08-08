import { sqliteTable, text, integer, real } from "drizzle-orm/sqlite-core";

export const habits = sqliteTable("habits", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  emoji: text("emoji").notNull().default("✨"),
  category: text("category").notNull().default("Custom"),
  frequencyRule: text("frequency_rule").notNull().default("daily"),
  preferredTimeWindow: text("preferred_time_window"),
  anchor: text("anchor"),
  linkedGoalId: text("linked_goal_id"),
  isTiny: integer("is_tiny", { mode: "boolean" }).notNull().default(true),
  baseXp: integer("base_xp").notNull().default(15),
  /** Bonus XP outside the daily redistributed pool (agent-settable) */
  extraXp: integer("extra_xp").notNull().default(0),
  /** Relative weight for daily XP pool redistribution (default 1) */
  xpWeight: integer("xp_weight").notNull().default(1),
  active: integer("active", { mode: "boolean" }).notNull().default(true),
  notes: text("notes"),
  themeColor: text("theme_color").notNull().default("#5B8CFF"),
  themeGraphic: text("theme_graphic").notNull().default("ring"),
  iconKey: text("icon_key"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
  deletedAt: text("deleted_at"),
});

/**
 * Agent-owned front-page cards.
 * Slots 0 and 1 are content cards; slot 2 is the reserved singleton
 * agent-setup card, which does not consume a content slot.
 * Free-form content + optional image/SVG + complete → webhook to agent.
 */
export const dashboardCards = sqliteTable("dashboard_cards", {
  id: text("id").primaryKey(),
  /** -1 unpinned (event/reminder), 0-1 content, 2 agent-setup */
  slot: integer("slot").notNull(),
  /** task | agent-setup | event | reminder */
  kind: text("kind").notNull().default("task"),
  /** What the card is for, in the agent's own words */
  purpose: text("purpose"),
  /** One of ACTIVITIES — the day bucket this card activates when started */
  activityTag: text("activity_tag"),
  /** Hidden until this instant */
  showAt: text("show_at"),
  /** Notification fires here — always strictly before eventAt */
  remindAt: text("remind_at"),
  /** When the thing actually happens */
  eventAt: text("event_at"),
  durationMinutes: integer("duration_minutes"),
  /** none | daily | weekly | spaced */
  repeatRule: text("repeat_rule").notNull().default("none"),
  repeatIndex: integer("repeat_index").notNull().default(0),
  /** JSON array of day offsets for a custom spaced ladder */
  repeatOffsetsJson: text("repeat_offsets_json"),
  sound: integer("sound", { mode: "boolean" }).notNull().default(true),
  flash: integer("flash", { mode: "boolean" }).notNull().default(true),
  /** Set once the client has actually chimed, so it only fires once */
  notifiedAt: text("notified_at"),
  /** Timeline block created when the user started this card */
  linkedBlockId: text("linked_block_id"),
  title: text("title").notNull(),
  subtitle: text("subtitle"),
  body: text("body"),
  emoji: text("emoji").default("📌"),
  themeColor: text("theme_color").default("#5B8CFF"),
  imageUrl: text("image_url"),
  /** data:image/...;base64,... optional small inline image */
  imageData: text("image_data"),
  /** Sanitized inline SVG markup supplied by the agent */
  svg: text("svg"),
  status: text("status").notNull().default("active"), // active | done | hidden
  progress: integer("progress").default(0), // 0-100
  ctaLabel: text("cta_label"),
  ctaLink: text("cta_link"),
  /** Freeform JSON for agent state (book slug, chapter, etc.) */
  metaJson: text("meta_json"),
  xpOnComplete: integer("xp_on_complete").notNull().default(0),
  webhookOnComplete: integer("webhook_on_complete", { mode: "boolean" })
    .notNull()
    .default(true),
  completedAt: text("completed_at"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const habitLogs = sqliteTable("habit_logs", {
  id: text("id").primaryKey(),
  habitId: text("habit_id")
    .notNull()
    .references(() => habits.id),
  completedAt: text("completed_at").notNull(),
  note: text("note"),
  source: text("source").notNull().default("user"),
  xpAwarded: integer("xp_awarded").notNull().default(0),
  undoneAt: text("undone_at"),
});

export const sleepLogs = sqliteTable("sleep_logs", {
  id: text("id").primaryKey(),
  date: text("date").notNull(),
  plannedWake: text("planned_wake"),
  plannedSleepStart: text("planned_sleep_start"),
  actualWake: text("actual_wake"),
  actualSleep: text("actual_sleep"),
  sleepQuality: integer("sleep_quality"),
  notes: text("notes"),
  createdAt: text("created_at").notNull(),
});

export const scheduleBlocks = sqliteTable("schedule_blocks", {
  id: text("id").primaryKey(),
  date: text("date").notNull(),
  category: text("category").notNull(),
  label: text("label").notNull(),
  plannedStart: text("planned_start"),
  plannedEnd: text("planned_end"),
  actualStart: text("actual_start"),
  actualEnd: text("actual_end"),
  status: text("status").notNull().default("planned"),
  source: text("source").notNull().default("agent"),
  notes: text("notes"),
  completedAt: text("completed_at"),
  createdAt: text("created_at").notNull(),
});

export const studySessions = sqliteTable("study_sessions", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  linkedBookSlug: text("linked_book_slug"),
  linkedConceptSlug: text("linked_concept_slug"),
  durationMinutes: integer("duration_minutes"),
  pages: integer("pages"),
  qualityFlag: text("quality_flag").notNull().default("normal"),
  note: text("note"),
  generatedSummary: text("generated_summary"),
  source: text("source").notNull().default("user"),
  xpAwarded: integer("xp_awarded").notNull().default(0),
  createdAt: text("created_at").notNull(),
});

export const goals = sqliteTable("goals", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  description: text("description"),
  /** achieved is only written once the celebration has actually been seen */
  status: text("status").notNull().default("active"),
  targetDate: text("target_date"),
  whyItMatters: text("why_it_matters"),
  progressPct: real("progress_pct").notNull().default(0),
  /** agent | user — goals are the agent's job by default */
  ownerKind: text("owner_kind").notNull().default("agent"),
  /** Serialized GoalCondition; null means manual progress only */
  conditionJson: text("condition_json"),
  autoCheck: integer("auto_check", { mode: "boolean" }).notNull().default(true),
  /** First instant the condition evaluated true */
  conditionMetAt: text("condition_met_at"),
  /** When the user actually watched the celebration */
  celebrationSeenAt: text("celebration_seen_at"),
  /** JSON array of leaf explanations from the last evaluation */
  conditionDetailJson: text("condition_detail_json"),
  emoji: text("emoji").notNull().default("🎯"),
  themeColor: text("theme_color").notNull().default("#A78BFA"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

/**
 * Agent-defined internal properties: named values the agent maintains itself
 * (books read, chapters revised, gym sessions) that goal conditions read.
 * `id` is the stable uid agents can key their own records to; `key` is the
 * human-readable slug used inside conditions.
 */
export const agentProperties = sqliteTable("agent_properties", {
  id: text("id").primaryKey(),
  key: text("key").notNull().unique(),
  label: text("label").notNull(),
  /** counter | number | text | json */
  kind: text("kind").notNull().default("counter"),
  value: real("value"),
  textValue: text("text_value"),
  unit: text("unit"),
  description: text("description"),
  createdBy: text("created_by"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const goalHabitLinks = sqliteTable("goal_habit_links", {
  id: text("id").primaryKey(),
  goalId: text("goal_id")
    .notNull()
    .references(() => goals.id),
  habitId: text("habit_id")
    .notNull()
    .references(() => habits.id),
});

export const lightReviews = sqliteTable("light_reviews", {
  id: text("id").primaryKey(),
  prompt: text("prompt").notNull(),
  forDate: text("for_date").notNull(),
  link: text("link"),
  completedAt: text("completed_at"),
  createdAt: text("created_at").notNull(),
});

/** Hermes live tasks / reviews / reminders for the user */
export const agentEvents = sqliteTable("agent_events", {
  id: text("id").primaryKey(),
  kind: text("kind").notNull().default("task"),
  title: text("title").notNull(),
  body: text("body"),
  link: text("link"),
  forDate: text("for_date").notNull(),
  status: text("status").notNull().default("pending"),
  priority: integer("priority").notNull().default(0),
  /** Bonus XP awarded on complete — outside the daily habit pool */
  xpOnComplete: integer("xp_on_complete").notNull().default(0),
  completedAt: text("completed_at"),
  createdAt: text("created_at").notNull(),
});

export const achievements = sqliteTable("achievements", {
  id: text("id").primaryKey(),
  key: text("key").notNull().unique(),
  title: text("title").notNull(),
  description: text("description").notNull(),
  emoji: text("emoji").notNull().default("🏆"),
  xpBonus: integer("xp_bonus").notNull().default(0),
  unlockedAt: text("unlocked_at"),
});

export const userProgress = sqliteTable("user_progress", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  totalXp: integer("total_xp").notNull().default(0),
  currentLevel: integer("current_level").notNull().default(1),
  lastImprovementPulse: text("last_improvement_pulse")
    .notNull()
    .default("Stable"),
  updatedAt: text("updated_at").notNull(),
});

export const quests = sqliteTable("quests", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  description: text("description"),
  targetCount: integer("target_count").notNull().default(1),
  progressCount: integer("progress_count").notNull().default(0),
  xpBonus: integer("xp_bonus").notNull().default(50),
  forDate: text("for_date"),
  completedAt: text("completed_at"),
  createdAt: text("created_at").notNull(),
});

export const dailySnapshots = sqliteTable("daily_snapshots", {
  id: text("id").primaryKey(),
  date: text("date").notNull().unique(),
  totalXpEarned: integer("total_xp_earned").notNull().default(0),
  habitsCompletedCount: integer("habits_completed_count").notNull().default(0),
  studyMinutes: integer("study_minutes").notNull().default(0),
  sleepScore: real("sleep_score"),
  consistencyPct: real("consistency_pct").notNull().default(0),
  improvementPulse: text("improvement_pulse"),
  createdAt: text("created_at").notNull(),
});

export const gamificationConfig = sqliteTable("gamification_config", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  configJson: text("config_json").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const settings = sqliteTable("settings", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  gamificationEnabled: integer("gamification_enabled", { mode: "boolean" })
    .notNull()
    .default(true),
  streaksEnabled: integer("streaks_enabled", { mode: "boolean" })
    .notNull()
    .default(true),
  pointsEnabled: integer("points_enabled", { mode: "boolean" })
    .notNull()
    .default(true),
  achievementsEnabled: integer("achievements_enabled", { mode: "boolean" })
    .notNull()
    .default(true),
  questsEnabled: integer("quests_enabled", { mode: "boolean" })
    .notNull()
    .default(true),
  celebrationIntensity: text("celebration_intensity")
    .notNull()
    .default("full"),
  accentTheme: text("accent_theme").notNull().default("nebula"),
  reducedMotion: integer("reduced_motion", { mode: "boolean" })
    .notNull()
    .default(false),
  /** Which chime a reminder plays; `none` is visual-only */
  notificationSound: text("notification_sound").notNull().default("chime"),
  /** Suppress the interruption, not the information */
  doNotDisturb: integer("do_not_disturb", { mode: "boolean" })
    .notNull()
    .default(false),
  /** Treat quiet hours as an automatic do-not-disturb window */
  quietHoursSilent: integer("quiet_hours_silent", { mode: "boolean" })
    .notNull()
    .default(true),
  plannedWake: text("planned_wake").notNull().default("11:00"),
  plannedSleepStart: text("planned_sleep_start").notNull().default("02:00"),
  plannedSleepEnd: text("planned_sleep_end").notNull().default("03:00"),
  quietHoursStart: text("quiet_hours_start").notNull().default("03:30"),
  quietHoursEnd: text("quiet_hours_end").notNull().default("10:30"),
  dayResetTime: text("day_reset_time").notNull().default("04:00"),
  storageMode: text("storage_mode").notNull().default("local"),
  supabaseUrl: text("supabase_url"),
  supabaseKey: text("supabase_key"),
  /** Agent webhook URL for card/habit complete triggers */
  agentWebhookUrl: text("agent_webhook_url"),
  agentWebhookSecret: text("agent_webhook_secret"),
  /** Periodic snapshots of the SQLite file into data/backups/ */
  backupsEnabled: integer("backups_enabled", { mode: "boolean" })
    .notNull()
    .default(true),
  backupIntervalHours: integer("backup_interval_hours").notNull().default(6),
  backupKeep: integer("backup_keep").notNull().default(24),
  lastBackupAt: text("last_backup_at"),
  updatedAt: text("updated_at").notNull(),
});

export const activeSessions = sqliteTable("active_sessions", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  activity: text("activity").notNull(),
  startedAt: text("started_at").notNull(),
  blockId: text("block_id"),
  /**
   * What was running before this session took over, so a timed session can hand
   * the day back instead of leaving whatever it interrupted lost. Null means
   * there was nothing to return to.
   */
  previousActivity: text("previous_activity"),
  /**
   * When a timed session should end by itself — set from a card's
   * `durationMinutes`. Null means it runs until stopped.
   */
  endsAt: text("ends_at"),
});

/**
 * What actually happened, as opposed to what was planned.
 *
 * `active_sessions` holds one row and is replaced on every switch, so before
 * this table existed changing activity simply discarded the interval that just
 * ended — there was no way to draw the part of the day you had already lived.
 * One row per interval, closed when the next one starts.
 */
export const activityLog = sqliteTable("activity_log", {
  id: text("id").primaryKey(),
  /** Life-day key, so a 1am session lands on the day it belonged to. */
  date: text("date").notNull(),
  activity: text("activity").notNull(),
  startedAt: text("started_at").notNull(),
  /** Null while it is still running. */
  endedAt: text("ended_at"),
  blockId: text("block_id"),
  source: text("source").notNull().default("user"),
});

/*
 * `auth_sessions` used to live here. It stored session tokens minted by the old
 * username/password login. Auth is a single bearer token now — nothing issued,
 * read, or expired a row in that table any more — so `ensureSchema()` drops it
 * on boot.
 */

export const specialEventCandidates = sqliteTable("special_event_candidates", {
  id: text("id").primaryKey(),
  kind: text("kind").notNull(),
  refId: text("ref_id"),
  summary: text("summary").notNull(),
  createdAt: text("created_at").notNull(),
  reviewedAt: text("reviewed_at"),
});
