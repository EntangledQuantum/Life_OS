package com.lifeos.app.data

import com.lifeos.app.data.api.ApiClient
import com.lifeos.app.data.api.Budget
import com.lifeos.app.data.api.ConnectionWitness
import com.lifeos.app.data.api.LifeOsApi
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/** One probe's verdict. Four of these are shown side by side, never merged. */
sealed interface ProbeResult {
    data object Pending : ProbeResult
    data class Pass(val detail: String) : ProbeResult

    /** A real failure: the thing does not work. */
    data class Fail(val detail: String) : ProbeResult

    /** Works, but something is off — `lan: false` is the canonical case. */
    data class Warn(val detail: String) : ProbeResult
}

/**
 * The four results `server`'s **Test** reports (§7.6).
 *
 * The whole point is that they are separate. "Can't connect" conflates four
 * different user actions: wake the machine, fix the address, paste a new token,
 * update the app. One combined result cannot tell the user which.
 */
data class ProbeReport(
    val reachable: ProbeResult = ProbeResult.Pending,
    val protocol: ProbeResult = ProbeResult.Pending,
    val auth: ProbeResult = ProbeResult.Pending,
    val lan: ProbeResult = ProbeResult.Pending,
) {
    /** Save is enabled when Test passed; a failed Test offers "Save anyway". */
    val passed: Boolean
        get() = reachable is ProbeResult.Pass &&
            protocol is ProbeResult.Pass &&
            auth is ProbeResult.Pass

    val finished: Boolean
        get() = reachable !is ProbeResult.Pending &&
            protocol !is ProbeResult.Pending &&
            auth !is ProbeResult.Pending
}

/**
 * Runs the three HTTP probes behind the four results, each with its own deadline.
 *
 * Non-destructive: this never writes the address or the token anywhere. Nothing
 * changes until the user presses Save.
 */
class ServerProbe(private val tokens: TokenStore) {

    suspend fun run(address: String, tokenOverride: String?): ProbeReport =
        withContext(Dispatchers.IO) {
            val base = ApiClient.normaliseBase(address)

            /*
             * A probe client of its own: a shorter deadline than an ordinary
             * request, because the user is sitting in front of it waiting, and
             * a one-shot token that is not committed to the Keystore yet.
             *
             * **The deadline comes from the address** (`Budget.forProbe`): 6s
             * for a machine on this network, 15s for a public or tunnelled one.
             * A flat 6s was why this user's server tested as flaky rather than
             * as working — their `/health` takes 3.4–5.7s through the Funnel, so
             * the same address passed some runs and failed others.
             */
            val budget = Budget.of(base).forProbe()
            val probeTokens: TokenSource = tokenOverride?.let { StaticToken(it) } ?: tokens
            // One witness for a strictly sequential run of three, reset before
            // each, so "did we connect" is the answer for *that* request.
            val witness = ConnectionWitness()
            val client = ApiClient.okHttp(probeTokens, budget, witness)
            val api: LifeOsApi = ApiClient.retrofit(base, client).create(LifeOsApi::class.java)

            var report = ProbeReport()

            /* 1. Reachability + lan, from /health. Unauthenticated, so a bad
             *    token cannot make a reachable server look unreachable. */
            val started = System.nanoTime()
            witness.reset()
            val health = runCatching { api.health("${base}health") }
            val healthResponse = health.getOrNull()
            report = if (healthResponse != null && healthResponse.isSuccessful) {
                val ms = (System.nanoTime() - started) / 1_000_000
                val body = healthResponse.body()
                report.copy(
                    reachable = ProbeResult.Pass("$ms ms"),
                    lan = when (body?.lan) {
                        true -> ProbeResult.Pass("reachable from your network")
                        false -> ProbeResult.Warn(
                            "lan: false — only this machine can reach it",
                        )
                        null -> ProbeResult.Warn("the server did not say")
                    },
                )
            } else {
                val detail = healthResponse?.let { "HTTP ${it.code()}" }
                    ?: health.exceptionOrNull()?.let { describe(it, witness, budget) }
                    ?: "no answer"
                report.copy(
                    reachable = ProbeResult.Fail(detail),
                    // Nothing answered, so there is nothing to say about `lan`.
                    lan = ProbeResult.Pending,
                )
            }

            /* 2. Protocol, unauthenticated. */
            witness.reset()
            val protocol = runCatching { api.protocol("${base}api/v1/protocol") }
            val protocolResponse = protocol.getOrNull()
            val mine = ApiClient.clientProtocol
            report = when {
                protocolResponse != null && protocolResponse.isSuccessful -> {
                    val server = protocolResponse.body()?.protocol ?: 0
                    val min = protocolResponse.body()?.minProtocol ?: server
                    when {
                        server == 0 -> report.copy(
                            protocol = ProbeResult.Warn("the server did not say"),
                        )

                        mine in min..server || mine == server -> report.copy(
                            protocol = ProbeResult.Pass("protocol $server, matches this app"),
                        )

                        mine < min -> report.copy(
                            protocol = ProbeResult.Fail(
                                "server speaks $server; this app speaks $mine",
                            ),
                        )

                        else -> report.copy(
                            protocol = ProbeResult.Warn(
                                "server speaks $server; this app speaks $mine",
                            ),
                        )
                    }
                }

                else -> report.copy(
                    protocol = ProbeResult.Fail(
                        protocolResponse?.let { "HTTP ${it.code()}" }
                            ?: protocol.exceptionOrNull()?.let { describe(it, witness, budget) }
                            ?: "no answer",
                    ),
                )
            }

            /* 3. Auth, with the token. Reported on its own line, so a rotated
             *    token reads as "paste a new one" and not as "server is down". */
            witness.reset()
            val me = runCatching { api.me() }
            val meResponse = me.getOrNull()
            report = when {
                meResponse != null && meResponse.isSuccessful ->
                    report.copy(auth = ProbeResult.Pass("accepted"))

                meResponse?.code() == 401 ->
                    report.copy(auth = ProbeResult.Fail("401 — not accepted"))

                meResponse?.code() == 426 ->
                    report.copy(auth = ProbeResult.Fail("426 — this app is too old"))

                else -> report.copy(
                    auth = ProbeResult.Fail(
                        meResponse?.let { "HTTP ${it.code()}" }
                            ?: me.exceptionOrNull()?.let { describe(it, witness, budget) }
                            ?: "no answer",
                    ),
                )
            }

            report
        }

    /**
     * One line for a failed probe, and the same line the pairing claim would
     * give for the same socket (`TransportFailure`).
     *
     * A timeout where the connection was established reads *"connected, but no
     * answer within 15s"* rather than *"timed out"* — on the server screen that
     * is the difference between "your address is wrong" and "your server is
     * slow", and only one of those is worth retyping an address over.
     */
    private fun describe(
        error: Throwable,
        witness: ConnectionWitness,
        budget: Budget,
    ): String = TransportFailure.of(error, witness, budget.callSeconds).detail
}
