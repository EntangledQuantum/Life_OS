package com.lifeos.app.domain

/**
 * What a queued write is.
 *
 * The queue is the only path a human action takes to the server. There is no
 * "send it now and fall back to the queue if it fails" path, because two paths
 * means two orderings and the second one is never tested.
 */
enum class WriteKind {
    HABIT_COMPLETE,
    HABIT_UNDO,
    TASK_COMPLETE,
    TASK_DISMISS,
    TASK_NOTIFIED,
    CELEBRATION_SEEN,
    SETTINGS_PATCH,
    SESSION_START,
    SESSION_STOP,
    STUDY_LOG,
}

/** Where a write has got to. */
enum class WriteState {
    /** Waiting to be sent, or being retried. */
    PENDING,

    /**
     * Not sent, and never will be: the life-day rolled over under it, or it ran
     * out of attempts. Surfaces once, then sits in the pending list for
     * inspection. Never auto-retried, never re-dated.
     */
    STRANDED,
}

/**
 * Why a write stranded. Carried so the notice can say something true rather
 * than "something went wrong".
 */
enum class StrandReason {
    /** The stamped life-day is not the server's current life-day. */
    DAY_ROLLED_OVER,

    /** Five attempts with backoff, all failed. */
    ATTEMPTS_EXHAUSTED,

    /** The server refused it in a way retrying cannot fix (4xx that is not 409). */
    REJECTED,
}

/**
 * One queued write.
 *
 * `lifeDayDate` is stamped at the moment the user tapped — not when the worker
 * runs — and it is the entire basis of the guard.
 */
data class PendingWrite(
    val id: Long,
    val kind: WriteKind,
    val targetId: String,
    val payloadJson: String,
    /** The `lifeDay.date` that was current when the user tapped. */
    val lifeDayDate: String,
    val enqueuedAt: Long,
    val attempts: Int,
    val lastError: String?,
    val state: WriteState,
    val strandReason: StrandReason?,
    /** True once the stranded notice has been shown. Surfaces once, then never. */
    val noticeShown: Boolean,
)

/** A write is retried at most this many times with backoff, then it strands. */
const val MAX_WRITE_ATTEMPTS = 5

/**
 * The life-day stamp guard (UI_SPEC §7.5).
 *
 * This is the most important piece of correctness in the app. A habit completion
 * replayed after the 04:00 reset lands on the wrong day and silently corrupts a
 * streak — strictly worse than losing the write, because the user can see a lost
 * write and cannot see a corrupted streak.
 *
 * Kept as a pure function of two strings and a kind so it is trivially testable
 * and so there is exactly one place the comparison happens.
 */
object LifeDayGuard {

    sealed interface Verdict {
        /** Stamps match, or the write does not care what day it is. */
        data object Send : Verdict

        /** The day rolled over. Do not send. Strand it and surface once. */
        data object Strand : Verdict

        /**
         * We do not know the server's current life-day yet, so we cannot decide.
         * Leave the write pending and re-probe — guessing in either direction is
         * worse than waiting.
         */
        data object Unknown : Verdict
    }

    fun verdict(
        kind: WriteKind,
        stampedLifeDay: String,
        serverLifeDay: String?,
    ): Verdict {
        // Day-independent writes always send: a settings patch, a celebration
        // acknowledgement, a /notified receipt and a dismissal mean the same
        // thing on any day.
        if (Predicates.isDayIndependent(kind)) return Verdict.Send
        if (serverLifeDay.isNullOrEmpty()) return Verdict.Unknown
        return if (stampedLifeDay == serverLifeDay) Verdict.Send else Verdict.Strand
    }

    /** `true` when this write may be sent right now. */
    fun maySend(kind: WriteKind, stampedLifeDay: String, serverLifeDay: String?): Boolean =
        verdict(kind, stampedLifeDay, serverLifeDay) is Verdict.Send

    /**
     * Exponential backoff for a failed attempt, in milliseconds.
     *
     * WorkManager applies its own backoff between drains; this is the per-write
     * delay the drain honours so one hot-looping write cannot starve the rest of
     * the queue. Capped, because an hour of waiting is indistinguishable from
     * stranded to the person holding the phone.
     */
    fun backoffMs(attempts: Int): Long {
        val capped = attempts.coerceIn(0, 6)
        return 1_000L shl capped // 1s, 2s, 4s … 64s
    }
}
