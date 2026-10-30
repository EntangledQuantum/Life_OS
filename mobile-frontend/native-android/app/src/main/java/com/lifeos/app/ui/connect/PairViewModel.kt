package com.lifeos.app.ui.connect

import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import com.lifeos.app.data.AppContainer
import com.lifeos.app.data.LifeOsRepository
import com.lifeos.app.data.PairClaim
import com.lifeos.app.data.PairOutcome
import com.lifeos.app.data.TokenStore
import com.lifeos.app.domain.PairInvite
import com.lifeos.app.domain.PairLink
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

/**
 * What to offer after a failed claim — one per thing that is actually wrong.
 *
 * Three, not two, and the third is the whole of 2.0.2's copy change. A claim
 * that timed out against a server the phone *connected to* is not a bad
 * address, and [CHANGE_SERVER] is the one piece of advice that cannot possibly
 * help: the user re-types a correct address, scans again, and waits out the
 * same timeout. [RETRY] says what happened and has another go.
 */
enum class PairRemedy {
    /** The code is spent or wrong. Fixed at the dashboard. */
    RESCAN,

    /** Nothing is at that address. Fixed in the address field. */
    CHANGE_SERVER,

    /** The server is reachable and slow. Fixed by waiting, or by trying again. */
    RETRY,
}

/**
 * Where the pairing screen is.
 *
 * `Failed` carries what to offer next rather than a code the screen switches on,
 * because the failures want different buttons and deciding that in the view
 * means the decision is made twice (§7.3).
 */
sealed interface PairPhase {
    /** Camera up, nothing scanned yet. */
    data object Scanning : PairPhase

    /** A code is in flight. The address is shown so the wait is explicable. */
    data class Claiming(val address: String) : PairPhase

    data class Failed(
        val message: String,
        val remedy: PairRemedy,
    ) : PairPhase

    data object Paired : PairPhase
}

/**
 * The QR pairing screen's state.
 *
 * Its own view model, like `server`'s, because this screen runs when the one
 * that polls has nothing: no address, no token, no snapshot. It is also the
 * screen a **cold start** lands on — the phone is opening *because* the link was
 * tapped — so it must be able to claim with the rest of the app still empty.
 *
 * Nothing here logs. The code and the token both pass through this class.
 */
class PairViewModel(
    private val repository: LifeOsRepository,
    private val tokens: TokenStore,
    private val claim: PairClaim,
) : ViewModel() {

    private val _phase = MutableStateFlow<PairPhase>(PairPhase.Scanning)
    val phase: StateFlow<PairPhase> = _phase.asStateFlow()

    /**
     * A raw barcode from the camera.
     *
     * The analyser hands over every QR it sees, several times a second, and most
     * of what a camera points at is not ours. A string that does not parse is
     * ignored in silence rather than reported: the viewfinder is still up, the
     * user is still aiming, and "that is not a Life OS code" flashing while they
     * line up the shot would be noise. Returns whether it was taken.
     */
    fun onScanned(raw: String?): Boolean {
        if (_phase.value !is PairPhase.Scanning) return false
        val invite = PairLink.parse(raw) ?: return false
        submit(invite)
        return true
    }

    /**
     * A link from outside the app: the deep link that opened us, or a rescan.
     *
     * One entry point for the camera and for the intent, so the claim, the token
     * write and the failure copy cannot differ between "scanned here" and
     * "scanned in the camera app" — which is the whole reason the deep link is
     * worth having.
     */
    /**
     * The last invite, kept so [retry] has something to send.
     *
     * Held in memory only, never persisted and never logged: for the five
     * minutes it lives, the code in it is a credential (§7.3).
     */
    private var lastInvite: PairInvite? = null

    fun submit(invite: PairInvite) {
        if (_phase.value is PairPhase.Claiming) return
        lastInvite = invite
        _phase.value = PairPhase.Claiming(invite.baseUrl)
        viewModelScope.launch {
            when (val outcome = claim.claim(invite)) {
                is PairOutcome.Paired -> {
                    tokens.save(outcome.token)
                    // A different server is a different life: this clears the
                    // snapshot cache and starts a new life-day epoch.
                    repository.onServerChanged(outcome.baseUrl)
                    repository.refresh()
                    _phase.value = PairPhase.Paired
                }

                is PairOutcome.Refused -> _phase.value = PairPhase.Failed(
                    message = outcome.message,
                    remedy = PairRemedy.RESCAN,
                )

                is PairOutcome.Unreachable -> _phase.value = PairPhase.Failed(
                    // The scan worked and the code may be perfectly good; this
                    // phone cannot reach the address the dashboard named. So the
                    // way out is the address, not another QR.
                    message = "Scanned, but this phone couldn't reach ${outcome.address} " +
                        "(${outcome.detail}).",
                    remedy = PairRemedy.CHANGE_SERVER,
                )

                /*
                 * Reachable, and slow. The address is right — the phone got a
                 * TLS connection to it — so the sentence says that, names the
                 * budget we actually spent, and warns about the one thing a
                 * retry can still run into: the server may have completed the
                 * claim after we stopped listening, and the code is single-use.
                 */
                is PairOutcome.TooSlow -> _phase.value = PairPhase.Failed(
                    message = "This phone reached ${outcome.address}, but it didn't answer " +
                        "within ${outcome.seconds}s. The connection is fine, so the address " +
                        "is right — try again. If the code has been used up by then, mint a " +
                        "new one on your dashboard.",
                    remedy = PairRemedy.RETRY,
                )
            }
        }
    }

    /**
     * Another go with the same code, after a timeout against a reachable server.
     *
     * Deliberately the *same* invite rather than a fresh scan: the address was
     * never the problem, and sending the user back to the dashboard for a new
     * QR is the advice that wasted their evening in 2.0.1. If the server did
     * finish the first claim while we were not listening, this comes back `401`
     * and the copy then says to mint a new one — which is the honest sequence.
     */
    fun retry() {
        val invite = lastInvite ?: return
        if (_phase.value is PairPhase.Claiming) return
        submit(invite)
    }

    /** Back to the viewfinder after a refusal. */
    fun rescan() {
        if (_phase.value is PairPhase.Claiming) return
        _phase.value = PairPhase.Scanning
    }

    companion object {
        fun factory(container: AppContainer): ViewModelProvider.Factory =
            object : ViewModelProvider.Factory {
                @Suppress("UNCHECKED_CAST")
                override fun <T : ViewModel> create(modelClass: Class<T>): T = PairViewModel(
                    repository = container.repository,
                    tokens = container.tokens,
                    claim = container.pairClaim,
                ) as T
            }
    }
}
