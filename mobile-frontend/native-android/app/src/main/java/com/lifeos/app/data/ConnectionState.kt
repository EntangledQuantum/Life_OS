package com.lifeos.app.data

import com.lifeos.app.data.api.ProtocolMismatchDto

/**
 * The connection state machine (UI_SPEC §7.2).
 *
 * ```
 * Unconfigured ─connect/pair─► Probing ─ok─► Online
 *                                 │           │  │
 *                                 │           │  └─ poll fails ─► Stale ─3 fails─► Unreachable
 *                                 │           └─ 401 ──────────────────────────────► Unauthorized
 *                                 └─ 426 ───────────────────────────────────────────► Outdated
 * Unreachable ─any success─► Online     Unauthorized ─re-enter token─► Probing
 * ```
 *
 * One observable state, rendered by one strip and one error panel. The old app
 * had the network as the source of truth, so every failure became an error panel
 * and there was no such thing as "stale but usable".
 */
sealed interface ConnectionState {

    /** No address, or no token. The connect graph owns the screen. */
    data object Unconfigured : ConnectionState

    /** A probe is in flight. Transient; the cached snapshot still renders. */
    data object Probing : ConnectionState

    /** Last poll succeeded. **No strip at all** — success is silent. */
    data object Online : ConnectionState

    /** 1–2 consecutive failures with a cache under 10 minutes old. */
    data class Stale(val failures: Int, val fetchedAt: Long?) : ConnectionState

    /** 3+ failures, or a cache far older than the poll interval. */
    data class Unreachable(val failures: Int, val fetchedAt: Long?, val detail: String?) :
        ConnectionState

    /** `401`. The token is cleared; connect opens with the address prefilled. */
    data object Unauthorized : ConnectionState

    /** `426`. A full-screen block, because nothing in the app can work. */
    data class Outdated(val mismatch: ProtocolMismatchDto) : ConnectionState

    /** Whether the status strip should be drawn at all. */
    val showsStrip: Boolean
        get() = this is Stale || this is Unreachable

    companion object {
        /** Stale becomes Unreachable at the third consecutive failure. */
        const val UNREACHABLE_AFTER_FAILURES = 3

        /** A cache older than this is Unreachable regardless of the count. */
        const val STALE_CACHE_LIMIT_MS = 10 * 60 * 1000L

        /**
         * Classify a run of failures. One function, so the strip's wording and
         * the state can never disagree about which one it is.
         */
        fun afterFailure(
            failures: Int,
            fetchedAt: Long?,
            now: Long,
            detail: String?,
        ): ConnectionState {
            val age = fetchedAt?.let { now - it }
            val tooOld = age != null && age > STALE_CACHE_LIMIT_MS
            return if (failures >= UNREACHABLE_AFTER_FAILURES || tooOld || fetchedAt == null) {
                Unreachable(failures, fetchedAt, detail)
            } else {
                Stale(failures, fetchedAt)
            }
        }
    }
}

/**
 * Poll intervals per destination (§7.1).
 *
 * The poll runs while a destination is resumed and stops when the process is
 * backgrounded. It is never started from a composition.
 */
object PollIntervals {
    const val TODAY_MS = 8_000L
    const val DAY_MS = 10_000L
    const val YOU_MS = 15_000L
}
