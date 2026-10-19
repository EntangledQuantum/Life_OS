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

@Serializable
data class GoalDto(
    val id: String = "",
    val title: String = "",
    val whyItMatters: String? = null,
    val emoji: String = "",
    val progressPct: Double = 0.0,
    val status: String = "active",
    val celebrationPending: Boolean = false,
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

@Serializable
data class SettingsDto(
    val celebrationIntensity: String = "full",
    val reducedMotion: Boolean = false,
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
    val timezone: String? = null,
    val notificationSound: String = "chime",
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
    val settings: SettingsDto = SettingsDto(),
)

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
