package com.lifeos.app.data

import com.lifeos.app.data.api.ConnectionWitness
import java.io.InterruptedIOException

/**
 * Why a request produced nothing — in the two terms a user can act on.
 *
 * "Can't reach it" has been doing the work of two different failures, and they
 * want opposite things from the person reading them:
 *
 *  - **[Unreachable]** — no such host, nothing listening, no route. The address
 *    is the problem. Offer **Change server**.
 *  - **[Slow]** — the host resolved, TCP and TLS completed, the server simply
 *    had not answered by the time the budget ran out. The address is *right*.
 *    Offer **Try again**.
 *
 * Collapsing those two is what shipped in 2.0.1: a pairing claim given 6s
 * against a server that needs 12–17s reported *"Couldn't reach that address
 * (timed out)"* — honest about the timeout, wrong about the cause, and it sent
 * the user off to re-type an address that was already correct.
 *
 * One function decides it ([of]) so the pairing screen and the server screen
 * cannot describe the same socket two different ways.
 */
sealed interface TransportFailure {

    /** One line, in the user's terms, for whichever surface is reporting. */
    val detail: String

    /** Nothing answered, and nothing was ever there to answer. */
    data class Unreachable(override val detail: String) : TransportFailure

    /**
     * Connected, then ran out of patience. [seconds] is the budget we spent, not
     * a measurement of the server — saying "didn't answer within 45s" is a fact
     * about us, and phrasing it as one is the honest version.
     */
    data class Slow(override val detail: String, val seconds: Long) : TransportFailure

    companion object {

        /**
         * Classify a thrown transport error.
         *
         * [witness] is what makes the distinction possible at all; with none
         * supplied every timeout reads as [Unreachable], which is the old
         * behaviour and the conservative one.
         */
        fun of(
            error: Throwable,
            witness: ConnectionWitness?,
            budgetSeconds: Long,
        ): TransportFailure = when {
            timedOut(error) && witness?.connected == true -> Slow(
                detail = "connected, but no answer within ${budgetSeconds}s",
                seconds = budgetSeconds,
            )

            else -> Unreachable(describeTransportFailure(error))
        }

        /**
         * Did we give up, or were we refused?
         *
         * Walks the cause chain because OkHttp's **call** timeout is enforced
         * outside the interceptor stack: when it fires, the call is cancelled
         * and the `InterruptedIOException("timeout")` that surfaces carries the
         * original failure as its cause. Checking only the top of the chain
         * misses the case this whole file is about.
         *
         * `SocketTimeoutException` is itself an `InterruptedIOException`, so one
         * test covers the read deadline and the call deadline both.
         */
        private fun timedOut(error: Throwable): Boolean {
            var current: Throwable? = error
            var hops = 0
            // Bounded: a cause chain can be circular, and this runs on a failure
            // path where an infinite loop would look like a hang.
            while (current != null && hops < MAX_CAUSE_HOPS) {
                if (current is InterruptedIOException) return true
                current = current.cause
                hops++
            }
            return false
        }

        private const val MAX_CAUSE_HOPS = 8
    }
}

/**
 * What to tell the user when nothing answered.
 *
 * Named cases, because `java.net.SocketTimeoutException` on a settings screen
 * tells the user nothing about which of the four things to go and fix.
 *
 * Top-level, and now in its own file rather than at the foot of `ServerProbe`,
 * because three callers share it — the probe, the pairing claim and
 * [TransportFailure.of]. Two copies of this list would drift into the probe
 * saying "connection refused" where pairing says "could not connect" about the
 * identical socket.
 */
internal fun describeTransportFailure(error: Throwable): String = when (error) {
    is java.net.SocketTimeoutException -> "timed out"
    is java.net.UnknownHostException -> "no such host"
    is java.net.ConnectException -> "connection refused"
    is InterruptedIOException -> "timed out"
    else -> error.message?.takeIf { it.isNotBlank() } ?: "could not connect"
}
