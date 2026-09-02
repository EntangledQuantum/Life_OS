import { sqliteTable, text, integer, real } from "drizzle-orm/sqlite-core";

export const habits = sqliteTable("habits", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  emoji: text("emoji").notNull().default("✨"),
  category: text("category").notNull().default("Custom"),
  frequencyRule: text("frequency_rule").notNull().default("daily"),
  /**
   * When in the day this habit happens, "HH:mm" local. Null means no
   * particular time.
   *
   * A habit with a time appears on the timeline for that slot, every day,
   * derived from this row — there is no second record to keep in sync. Before
   * this an agent had to create a separate task to carry the time, which gave
   * the user two things to tick for one act.
   */
  scheduledTime: text("scheduled_time"),
  /** How long it takes. Only meaningful alongside `scheduledTime`. */
  durationMinutes: integer("duration_minutes"),
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
  /** Tell the agent when this habit is completed. Off unless it asked. */
  webhookOnComplete: integer("webhook_on_complete", { mode: "boolean" })
    .notNull()
    .default(false),
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
  /** One interactive widget: a slider to ask something, or a button. JSON. */
  controlJson: text("control_json"),
  /** Hear about the control being used. Off by default — a slider fires often. */
  webhookOnInteract: integer("webhook_on_interact", { mode: "boolean" })
    .notNull()
    .default(false),
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
  /** Tell the agent when this block is completed. Off unless it asked. */
  webhookOnComplete: integer("webhook_on_complete", { mode: "boolean" })
    .notNull()
    .default(false),
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
  /**
   * How long before a scheduled thing you are told about it — and, because they
   * are the same idea, how close it has to be to reach the front page.
   */
  reminderLeadMinutes: integer("reminder_lead_minutes").notNull().default(15),
  plannedWake: text("planned_wake").notNull().default("11:00"),
  plannedSleepStart: text("planned_sleep_start").notNull().default("02:00"),
  plannedSleepEnd: text("planned_sleep_end").notNull().default("03:00"),
  quietHoursStart: text("quiet_hours_start").notNull().default("03:30"),
  quietHoursEnd: text("quiet_hours_end").notNull().default("10:30"),
  dayResetTime: text("day_reset_time").notNull().default("04:00"),
  /**
   * IANA zone the times in this database are meant in, e.g. `Asia/Kolkata`.
   *
   * Null means the machine's own zone, which is what it has always silently
   * been. It matters for an agent reading this from somewhere else: a container
   * runs in UTC, and without being told otherwise it schedules "09:00" in the
   * wrong one and disagrees with the app about which life-day a completion
   * belongs to.
   */
  timezone: text("timezone"),
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

/**
 * The only kind of work there is, besides a habit.
 *
 * Absorbs what used to be four tables — scheduled cards, agent events, light
 * reviews and study blocks — because they were the same object wearing
 * different hats, and an agent had to guess which hat to put on. Every optional
 * part (a time, a repeat, XP, links, a card presentation) is just a column that
 * may be null.
 *
 * `sourceTable` / `sourceId` record where a row was carried over from in the
 * v6 migration. They make the import idempotent and keep a row traceable.
 */
export const tasks = sqliteTable("tasks", {
  id: text("id").primaryKey(),
  /** Presentation and grouping only — every kind behaves identically. */
  kind: text("kind").notNull().default("task"),
  title: text("title").notNull(),
  subtitle: text("subtitle"),
  body: text("body"),
  purpose: text("purpose"),
  status: text("status").notNull().default("active"),
  activityTag: text("activity_tag"),

  showAt: text("show_at"),
  eventAt: text("event_at"),
  durationMinutes: integer("duration_minutes"),
  /** Explicit override; normally derived from eventAt minus the user's lead. */
  remindAt: text("remind_at"),
  notifiedAt: text("notified_at"),

  repeatRule: text("repeat_rule").notNull().default("none"),
  repeatIndex: integer("repeat_index").notNull().default(0),
  repeatOffsetsJson: text("repeat_offsets_json"),

  xpOnComplete: integer("xp_on_complete").notNull().default(0),
  webhookOnComplete: integer("webhook_on_complete", { mode: "boolean" })
    .notNull()
    .default(false),
  webhookOnInteract: integer("webhook_on_interact", { mode: "boolean" })
    .notNull()
    .default(false),

  /** Links and references — what a "study block" always was underneath. */
  resourcesJson: text("resources_json"),

  /** Pinned to a front-page card slot (0 or 1). Null = not pinned. */
  slot: integer("slot"),
  emoji: text("emoji"),
  themeColor: text("theme_color"),
  imageUrl: text("image_url"),
  imageData: text("image_data"),
  svg: text("svg"),
  ctaLabel: text("cta_label"),
  ctaLink: text("cta_link"),
  controlJson: text("control_json"),

  progress: integer("progress").notNull().default(0),
  sound: integer("sound", { mode: "boolean" }).notNull().default(true),
  flash: integer("flash", { mode: "boolean" }).notNull().default(true),

  source: text("source").notNull().default("agent"),
  /**
   * The habit this task is *about*, if any.
   *
   * A pointer and nothing else: completing one does not complete the other.
   * They are different things concerning the same subject — an agent card
   * explaining where the reading habit stands is not the reading habit — and
   * the link exists so a client can show the relationship rather than leaving
   * the user to infer it from the titles.
   */
  habitId: text("habit_id"),
  /** The scheduled task this card explains. A pointer, like `habitId`. */
  linkedTaskId: text("linked_task_id"),
  /** Serialized CardStyle — layout, scrim, gradient, border. Null = defaults. */
  cardStyleJson: text("card_style_json"),
  metaJson: text("meta_json"),

  completedAt: text("completed_at"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),

  sourceTable: text("source_table"),
  sourceId: text("source_id"),
});

/**
 * Where completions get delivered.
 *
 * More than one, because a person can plausibly run both Hermes and OpenClaw,
 * and because a single global URL in `settings` gave no way to say *which*
 * agent asked to be told about *what*.
 */
export const webhookTargets = sqliteTable("webhook_targets", {
  id: text("id").primaryKey(),
  /** Human label — "Hermes", "OpenClaw dev". */
  name: text("name").notNull(),
  /** `hermes` | `openclaw` | `generic`. Decides the auth and body shape. */
  preset: text("preset").notNull().default("generic"),
  url: text("url").notNull(),
  /** HMAC key (hermes) or bearer token (openclaw). Never leaves the server. */
  secret: text("secret"),
  /** JSON array of event names. Empty/null = every event. */
  eventsJson: text("events_json"),
  active: integer("active", { mode: "boolean" }).notNull().default(true),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

/**
 * Every delivery attempt, kept.
 *
 * The old implementation was fire-and-forget with a `console.error` on failure,
 * which meant a webhook that had been silently failing for a week looked
 * identical to one that had never been configured. A row per attempt is what
 * makes "did my agent actually hear about this?" answerable.
 */
export const webhookDeliveries = sqliteTable("webhook_deliveries", {
  id: text("id").primaryKey(),
  targetId: text("target_id").notNull(),
  event: text("event").notNull(),
  /** The exact JSON body sent, so a failure can be inspected or replayed. */
  payloadJson: text("payload_json").notNull(),
  /** 1-based; a row is updated in place as retries happen. */
  attempt: integer("attempt").notNull().default(1),
  /** `pending` | `delivered` | `failed` */
  status: text("status").notNull().default("pending"),
  responseStatus: integer("response_status"),
  error: text("error"),
  createdAt: text("created_at").notNull(),
  deliveredAt: text("delivered_at"),
});

/**
 * What you are doing right now, at the level the timeline cares about. Set by
 * hand and only by hand; nothing an agent schedules ever writes here.
 *
 * `previous_activity` and `ends_at` used to live here, for sessions that started
 * themselves from a card and handed the day back when they expired. Scheduled
 * things no longer start, so those are gone from the model. Databases created
 * before this still carry the physical columns — harmless, always null — but
 * Drizzle must not reference them, or every INSERT names a column a fresh
 * database does not have.
 */
export const activeSessions = sqliteTable("active_sessions", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  activity: text("activity").notNull(),
  startedAt: text("started_at").notNull(),
  blockId: text("block_id"),
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

/**
 * Every value an agent counter has held.
 *
 * The counter itself is one number overwritten in place, which cannot answer
 * "am I reading more than I was in June". Written only when the value actually
 * changes, so a counter nobody touches costs nothing.
 */
export const propertyHistory = sqliteTable("property_history", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  /** The property's stable uid — survives a rename of `key`. */
  uid: text("uid").notNull(),
  /** The key as it was at the time, for readable series without a join. */
  key: text("key").notNull(),
  value: real("value").notNull(),
  at: text("at").notNull(),
});

/** Every progress percentage a goal has passed through. Same reasoning. */
export const goalProgressHistory = sqliteTable("goal_progress_history", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  goalId: text("goal_id").notNull(),
  pct: real("pct").notNull(),
  at: text("at").notNull(),
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
