package com.lifeos.app.data.api

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

/*
 * Payload shapes, modelled on `packages/shared/src/types.ts`, `agenda.ts`,
 * `tasks.ts` and `time.ts`. **Modelled on, not imported** — this app has no
 * contact with the workspace beyond HTTP (see the isolation contract).
 *
 * Every field has a default. A server that grows a field must not break an
 * installed app, and `ignoreUnknownKeys` plus defaults is what makes a missing
 * or extra key a non-event rather than a crash on the one screen the user looks
 * at every morning.
 */

@Serializable
data class LifeDayDto(
    val lifeDay: String = "",
    val lifeDayStart: String? = null,
    val lifeDayEnd: String? = null,
    val dayResetTime: String = "04:00",
    val timezone: String? = null,
)

@Serializable
data class AgendaItemDto(
    /** `habit:<id>` or `task:<id>`. Stable across a day. */
    val id: String = "",
    /** `habit` | `task` — which thing you complete. */
    val source: String = "task",
    /** The habit or task id, which is what you complete. */
    val refId: String = "",
    val title: String = "",
    val subtitle: String? = null,
    val emoji: String? = null,
    val activityTag: String? = null,
    val kind: String? = null,
    /** When it happens today, as an instant. Null means no particular time. */
    val at: String? = null,
    val durationMinutes: Int? = null,
    val startHour: Double? = null,
    val endHour: Double? = null,
    /** `upcoming` | `now` | `done` | `overdue` | `anytime`. */
    val state: String = "upcoming",
    val done: Boolean = false,
    val xp: Int = 0,
    val streak: Int? = null,
    val habitId: String? = null,
    val themeColor: String? = null,
    /** Already resolved server-side; a row wants the picture or the emoji. */
    val iconImage: String? = null,
)

@Serializable
data class HabitWithTodayDto(
    val id: String = "",
    val name: String = "",
    val emoji: String = "",
    val anchor: String? = null,
    val themeColor: String = "",
    val completedToday: Boolean = false,
    val currentStreak: Int = 0,
    val longestStreak: Int = 0,
    val history7: List<Boolean> = emptyList(),
    val iconImageUrl: String? = null,
    val iconImageData: String? = null,
    val active: Boolean = true,
    val baseXp: Int = 0,
)

@Serializable
data class TaskDto(
    val id: String = "",
    val kind: String = "task",
    val title: String = "",
    val subtitle: String? = null,
    val body: String? = null,
    val purpose: String? = null,
    val status: String = "active",
    val activityTag: String? = null,
    val showAt: String? = null,
    val eventAt: String? = null,
    val durationMinutes: Int? = null,
    val remindAt: String? = null,
    val notifiedAt: String? = null,
    val repeatRule: String = "none",
    val xpOnComplete: Int = 0,
    val habitId: String? = null,
    /** 0 or 1 pins a task as an agent card; null is an ordinary task. */
    val slot: Int? = null,
    val emoji: String? = null,
    val themeColor: String? = null,
    val svg: String? = null,
    val ctaLabel: String? = null,
    val ctaLink: String? = null,
    val source: String = "agent",
)

@Serializable
data class UserProgressDto(
    val totalXp: Int = 0,
    val dailyXp: Int = 0,
    val dailyXpTarget: Int = 0,
    /** Can exceed 100. Clamp the fill, never the number. */
    val efficiencyPct: Double = 0.0,
    val improvementPct: Double = 0.0,
    val yesterdayEfficiencyPct: Double = 0.0,
    val lastImprovementPulse: String = "Stable",
    val growthStyle: String = "bloom",
)

@Serializable
data class DeltaDto(
    val today: Double? = null,
    val yesterday: Double? = null,
    val delta: Double? = null,
)

@Serializable
data class VsYesterdayDto(
    val habitsCompleted: DeltaDto = DeltaDto(),
    val xpEarned: DeltaDto = DeltaDto(),
    val studyMinutes: DeltaDto = DeltaDto(),
    val sleepScore: DeltaDto = DeltaDto(),
    val efficiency: DeltaDto = DeltaDto(),
)

@Serializable
data class TimelineBlockDto(
    val id: String = "",
    val category: String = "",
    val label: String = "",
    val startHour: Double = 0.0,
    val endHour: Double = 0.0,
    val color: String = "",
    val status: String = "planned",
    /** Solid behind the now-marker for what was lived; tinted ahead for the plan. */
    val actual: Boolean = false,
)

@Serializable
data class ActiveSessionDto(
    val activity: String = "",
    val startedAt: String = "",
    val blockId: String? = null,
)

/**
 * One rung of a goal's rarity ladder.
 *
 * `rank` orders them from the bottom up: 1 is the one you reach first. A tier is
 * the same goal at a different height — its own condition, its own words, its
 * own celebration — which is why a rung carries a `celebrationPending` of its
 * own and a five-rung goal can owe the user four animations on the way up.
 */
@Serializable
data class GoalTierDto(
    val id: String = "",
    val goalId: String = "",
    val rank: Int = 0,
    /** The agent's word for this rarity: "Bronze", "Mythic", "Ten". */
    val label: String = "",
    /** Overrides the goal's title on this rung's card and celebration. */
    val title: String? = null,
    val description: String? = null,
    val emoji: String? = null,
    val themeColor: String? = null,
    /** Progress toward this rung specifically, 0–100. */
    val progressPct: Double = 0.0,
    val metAt: String? = null,
    val celebrationSeenAt: String? = null,
    /** Met but unwitnessed — this rung still owes the user an animation. */
    val celebrationPending: Boolean = false,
)

@Serializable
data class GoalDto(
    val id: String = "",
    val title: String = "",
    val description: String? = null,
    val whyItMatters: String? = null,
    val emoji: String = "",
    val themeColor: String? = null,
    val progressPct: Double = 0.0,
    /** `active` becomes `achieved` only after the user has seen the celebration. */
    val status: String = "active",
    val conditionMetAt: String? = null,
    val celebrationSeenAt: String? = null,
    val celebrationPending: Boolean = false,
    /** Lowest rung first. Empty for a goal that is simply done or not done. */
    val tiers: List<GoalTierDto> = emptyList(),
    val currentTier: GoalTierDto? = null,
    val nextTier: GoalTierDto? = null,
    /** The rung the celebration should be about, or null. */
    val pendingTier: GoalTierDto? = null,
)

/** An agent-maintained counter, shown read-only in You's properties block. */
@Serializable
data class AgentPropertyDto(
    val uid: String = "",
    val key: String = "",
    val label: String = "",
    val kind: String = "counter",
    val value: Double? = null,
    val textValue: String? = null,
    val unit: String? = null,
)

@Serializable
data class QuestDto(
    val id: String = "",
    val title: String = "",
    val description: String? = null,
    val targetCount: Int = 0,
    val progressCount: Int = 0,
    val xpBonus: Int = 0,
    val completedAt: String? = null,
)

@Serializable
data class AchievementDto(
    val id: String = "",
    val key: String = "",
    val title: String = "",
    val description: String = "",
    val emoji: String = "",
    val xpBonus: Int = 0,
    val unlockedAt: String? = null,
)

@Serializable
data class SeriesPointDto(
    val date: String = "",
    val current: Double = 0.0,
    val target: Double = 0.0,
)

@Serializable
data class ConsistencyPointDto(
    val date: String = "",
    val pct: Double = 0.0,
)

/**
 * `GET /api/v1/settings`, and the body of a `PATCH`.
 *
 * **This does not ride along on `dashboard/today`** — the dashboard payload has
 * no `settings` key, so every flag here was reading its default until it was
 * fetched separately. `celebrationIntensity`, `streaksEnabled` and the quiet
 * hours all change what a screen draws, so the repository fetches this beside
 * the dashboard and caches it in its own row.
 *
 * Only the fields this app is allowed to touch are modelled. `storageMode`,
 * `supabaseUrl`, the webhook and the backup settings exist on the server and are
 * deliberately absent: if it configures the server or the website, it is not in
 * this app (§9).
 */
@Serializable
data class SettingsDto(
    val celebrationIntensity: String = "full",
    val reducedMotion: Boolean = false,
    val gamificationEnabled: Boolean = true,
    val streaksEnabled: Boolean = true,
    val pointsEnabled: Boolean = true,
    val achievementsEnabled: Boolean = true,
    val questsEnabled: Boolean = true,
    val doNotDisturb: Boolean = false,
    val quietHoursSilent: Boolean = false,
    val quietHoursStart: String = "22:00",
    val quietHoursEnd: String = "07:00",
    val reminderLeadMinutes: Int = 15,
    val dayResetTime: String = "04:00",
    /** The day's intended shape — what gives the ribbon form on an empty day. */
    val plannedWake: String = "07:00",
    val plannedSleepStart: String = "23:00",
    val plannedSleepEnd: String = "07:00",
    /** Read-only display. The server always resolves it; the app never sets it. */
    val timezone: String? = null,
    val notificationSound: String = "chime",
)

/* ------------------------------------------------------------- analytics */

/** One reading of a value that changes over time. */
@Serializable
data class HistoryPointDto(val at: String = "", val value: Double = 0.0)

@Serializable
data class AnalyticsDailyDto(
    val date: String = "",
    val xp: Double = 0.0,
    val xpTarget: Double = 0.0,
    val efficiencyPct: Double = 0.0,
    /** 100 — the line efficiency is measured against. */
    val efficiencyTarget: Double = 100.0,
    val habitsCompleted: Int = 0,
    val habitsPossible: Int = 0,
    val consistencyPct: Double = 0.0,
    val studyMinutes: Double = 0.0,
)

@Serializable
data class AnalyticsHabitDto(
    val id: String = "",
    val name: String = "",
    val emoji: String = "",
    val themeColor: String = "",
    /** Over the days the habit **existed**, not the whole window. */
    val ratePct: Double = 0.0,
    val completions: Int = 0,
    val daysPossible: Int = 0,
    val currentStreak: Int = 0,
)

@Serializable
data class AnalyticsAdherenceDto(
    val scheduled: Int = 0,
    val completed: Int = 0,
    val completedLate: Int = 0,
    val dismissed: Int = 0,
    val ratePct: Double = 0.0,
)

@Serializable
data class AnalyticsStudyDto(
    val totalMinutes: Double = 0.0,
    val sessions: Int = 0,
)

@Serializable
data class AnalyticsPropertyDto(
    val uid: String = "",
    val key: String = "",
    val label: String = "",
    val unit: String? = null,
    val current: Double? = null,
    /** Change across the window. Null when there is nothing to compare to. */
    val delta: Double? = null,
    val series: List<HistoryPointDto> = emptyList(),
)

/**
 * `GET /api/v1/analytics?range=7d|30d|90d|all` — the one screen-specific read.
 *
 * Every series arrives ready to draw, and **where there is a target, the target
 * rides the same axis as the actual**. The client does no arithmetic on it
 * beyond picking colours.
 */
@Serializable
data class AnalyticsDto(
    val range: String = "7d",
    /** First day included, `YYYY-MM-DD`. */
    val from: String = "",
    val daily: List<AnalyticsDailyDto> = emptyList(),
    val habits: List<AnalyticsHabitDto> = emptyList(),
    val adherence: AnalyticsAdherenceDto = AnalyticsAdherenceDto(),
    val study: AnalyticsStudyDto = AnalyticsStudyDto(),
    val properties: List<AnalyticsPropertyDto> = emptyList(),
)

/** `GET /api/v1/dashboard/today` — the one read the whole app is built on. */
@Serializable
data class DashboardTodayDto(
    val date: String = "",
    val dayResetTime: String = "04:00",
    val lifeDay: LifeDayDto = LifeDayDto(),
    /** Today, already merged and already ordered. Do not re-split it. */
    val agenda: List<AgendaItemDto> = emptyList(),
    /** A convenience subset of `agenda`, not a second section on any screen. */
    val anytime: List<AgendaItemDto> = emptyList(),
    val tasks: List<TaskDto> = emptyList(),
    val current: List<TaskDto> = emptyList(),
    val dueReminders: List<TaskDto> = emptyList(),
    val pendingCelebrations: List<GoalDto> = emptyList(),
    /** Agent-defined counters. Read-only in You, behind a header. */
    val properties: List<AgentPropertyDto> = emptyList(),
    val quests: List<QuestDto> = emptyList(),
    val achievements: List<AchievementDto> = emptyList(),
    val habits: List<HabitWithTodayDto> = emptyList(),
    val progress: UserProgressDto = UserProgressDto(),
    val vsYesterday: VsYesterdayDto = VsYesterdayDto(),
    val pulse: String = "Stable",
    val pulseExplanation: String = "",
    val goals: List<GoalDto> = emptyList(),
    val consistency7: List<ConsistencyPointDto> = emptyList(),
    val xpSeries7: List<SeriesPointDto> = emptyList(),
    val activeSession: ActiveSessionDto? = null,
    val timeline: List<TimelineBlockDto> = emptyList(),
)
/*
 * There is deliberately no `settings` field here. The server's
 * `dashboard/today` carries no `settings` key, so a field with a default on
 * this type is a lie that always reads as the default: it made
 * `streaksEnabled`, `celebrationIntensity` and the quiet hours look wired when
 * nothing was reading them. Settings come from [SettingsDto] via
 * `GET /api/v1/settings`, cached in its own row.
 */

/** `GET /health` — the reachability probe, and where `lan` comes from. */
@Serializable
data class HealthDto(
    val ok: Boolean = false,
    val service: String = "",
    val storage: String? = null,
    val host: String? = null,
    /**
     * False means the server is bound to loopback only — the single most common
     * reason a phone cannot connect. A warning, not a failure: the app cannot
     * fix it, so it links to docs/NETWORK.md instead of pretending otherwise.
     */
    val lan: Boolean? = null,
)

/** `GET /api/v1/protocol` — unauthenticated, so it can be checked first. */
@Serializable
data class ProtocolDto(
    val protocol: Int = 0,
    val minProtocol: Int = 0,
)

/** The `426` body. */
@Serializable
data class ProtocolMismatchDto(
    val error: String = "",
    val hint: String = "",
    val clientProtocol: Int = 0,
    val serverProtocol: Int = 0,
    val minProtocol: Int = 0,
    val downloadUrl: String = "",
)

@Serializable
data class AuthMeDto(
    val ok: Boolean = false,
    val user: String? = null,
)

@Serializable
data class PairClaimRequest(val code: String)

@Serializable
data class PairClaimResponse(
    val baseUrl: String = "",
    val token: String = "",
)

/** `source: "user"` on every human action — it is how the agent tells them apart. */
@Serializable
data class SourceBody(val source: String = "user")
