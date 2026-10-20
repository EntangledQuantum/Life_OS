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
 * Where the pairing screen is.
 *
 * `Failed` carries what to offer next rather than a code the screen switches on,
 * because the two failures want opposite buttons and deciding that in the view
 * means the decision is made twice (§7.3).
 */
sealed interface PairPhase {
    /** Camera up, nothing scanned yet. */
    data object Scanning : PairPhase

    /** A code is in flight. The address is shown so the wait is explicable. */
    data class Claiming(val address: String) : PairPhase

    data class Failed(
        val message: String,
        /** A reachability failure. Offer **Change server**, not a rescan. */
        val changeServer: Boolean,
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
    fun submit(invite: PairInvite) {
        if (_phase.value is PairPhase.Claiming) return
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
                    changeServer = false,
                )

                is PairOutcome.Unreachable -> _phase.value = PairPhase.Failed(
                    // The scan worked and the code may be perfectly good; this
                    // phone cannot reach the address the dashboard named. So the
                    // way out is the address, not another QR.
                    message = "Scanned, but this phone couldn't reach ${outcome.address} " +
                        "(${outcome.detail}).",
                    changeServer = true,
                )
            }
        }
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
