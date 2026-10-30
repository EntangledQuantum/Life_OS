package com.lifeos.app.data

import com.lifeos.app.data.api.AddressInput
import com.lifeos.app.data.api.ApiClient
import com.lifeos.app.data.api.Budget
import com.lifeos.app.data.api.ConnectionWitness
import com.lifeos.app.data.api.LifeOsApi
import com.lifeos.app.data.api.PairClaimRequest
import com.lifeos.app.domain.PairInvite
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/**
 * What came of trading a scanned code for the token.
 *
 * Three outcomes rather than two, because "it didn't work" conflates the two
 * failures that need opposite actions from the user. A refused code is fixed by
 * minting a new QR; an address nothing answers at is fixed by changing the
 * address — and offering a rescan for the second one sends someone back to the
 * dashboard to generate codes that will keep failing.
 */
sealed interface PairOutcome {
    data class Paired(val baseUrl: String, val token: String) : PairOutcome

    /** The server answered, and said no. Expired, already used, or not ours. */
    data class Refused(val message: String) : PairOutcome

    /** Nothing answered at that address. Reachability, not the code. */
    data class Unreachable(val address: String, val detail: String) : PairOutcome

    /**
     * Four, because a timeout against a server that *did* connect is its own
     * failure with its own way out.
     *
     * The address resolved, TCP and TLS completed, and the claim had not come
     * back when the budget expired. Nothing about the address is wrong, so
     * sending the user to **Change server** — which is what 2.0.1 did, every
     * time, for this user's tunnelled server — is advice that cannot help.
     */
    data class TooSlow(val address: String, val seconds: Long) : PairOutcome
}

/**
 * `POST /api/v1/pair/claim` (UI_SPEC §7.3).
 *
 * **Unauthenticated by design** — a phone that had the token would not need to
 * pair — so the claim carries no bearer header at all, which is also why it is
 * on the short list `ApiClient` skips auth for. What makes it safe is the code:
 * twelve characters of high-entropy alphabet, five minutes, single use, and
 * mintable only by someone already signed into the dashboard
 * (`apps/api/src/services/pairing.ts`).
 *
 * **Its own deadline** (`Budget.forClaim`), which is the fix at the heart of
 * 2.0.2. Until then the claim borrowed the *probe's* 6s, on the reasoning that
 * somebody is standing there holding a phone at a screen — and that reasoning
 * is backwards. A probe paints a status strip and the next poll has another go;
 * this is one shot at a single-use code with a five-minute life, and there is
 * nothing in the app that will retry it. Measured on the user's phone, their
 * server's claim takes 12.27–17.37s through the Funnel, so 6s could not succeed
 * once. Waiting is the correct behaviour here; giving up is not.
 *
 * Nothing in this file logs, at any level. The code and the token are the only
 * two secrets this app handles and they are both in scope here.
 */
class PairClaim(
    private val apiFactory: (String, ConnectionWitness) -> LifeOsApi = { base, witness ->
        // A client of its own with no token: the one stored (if any) belongs to
        // a different server until this succeeds, and sending it would be
        // handing an old server's credential to a new address.
        //
        // One client per claim, which is also what lets the witness be exact:
        // it watches one request and nothing else.
        ApiClient.retrofit(
            base,
            ApiClient.okHttp(StaticToken(""), Budget.of(base).forClaim(), witness),
        ).create(LifeOsApi::class.java)
    },
) {

    suspend fun claim(invite: PairInvite): PairOutcome = withContext(Dispatchers.IO) {
        val base = ApiClient.normaliseBase(invite.baseUrl)
        val budget = Budget.of(base).forClaim()
        val witness = ConnectionWitness()
        val api = apiFactory(base, witness)

        val attempt = runCatching {
            api.claimPairing("${base}api/v1/pair/claim", PairClaimRequest(invite.code))
        }

        val response = attempt.getOrElse { error ->
            return@withContext when (
                val failure = TransportFailure.of(error, witness, budget.callSeconds)
            ) {
                // Connected, and then we ran out of patience. The address is
                // right; say so, and let the user try again rather than send
                // them off to re-type it.
                is TransportFailure.Slow -> PairOutcome.TooSlow(
                    address = invite.baseUrl,
                    seconds = failure.seconds,
                )

                is TransportFailure.Unreachable -> PairOutcome.Unreachable(
                    address = invite.baseUrl,
                    detail = failure.detail,
                )
            }
        }

        if (!response.isSuccessful) {
            return@withContext PairOutcome.Refused(refusal(response.code()))
        }

        val body = response.body()
        val token = body?.token?.trim().orEmpty()
        if (body == null || token.isBlank()) {
            // A 200 with nothing in it. Rare enough to be a reverse proxy
            // swallowing the body rather than the server, so say what happened
            // instead of claiming the code was bad.
            return@withContext PairOutcome.Refused(
                "That server accepted the code but sent no token back.",
            )
        }

        /*
         * The server tells us which address the *phone* should use, which is
         * not always the one in the QR — a tunnel URL rather than the LAN IP.
         * It goes through the same normaliser as the address field so a path
         * prefix survives and a typed scheme is believed.
         */
        val resolved = body.baseUrl.takeIf { it.isNotBlank() }
            ?.let { AddressInput.normalise(it) }
            ?: invite.baseUrl

        PairOutcome.Paired(baseUrl = resolved, token = token)
    }

    /**
     * One line per HTTP answer, in the user's terms.
     *
     * `401` covers expired *and* already-used: the server compares in constant
     * time and deliberately returns one response for both, so the copy is one
     * sentence covering both — exactly as §7.3 specifies.
     */
    private fun refusal(code: Int): String = when (code) {
        401 -> "That code is no longer valid. Mint a new one on your dashboard."
        404 -> "That address answered, but it does not offer pairing. Check the address."
        426 -> "That server is newer than this app. Update Life OS for Android."
        else -> "That server answered HTTP $code."
    }
}
