package com.lifeos.app.ui.server

import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import com.lifeos.app.data.AppContainer
import com.lifeos.app.data.LifeOsRepository
import com.lifeos.app.data.ProbeReport
import com.lifeos.app.data.ServerProbe
import com.lifeos.app.data.TokenStore
import com.lifeos.app.data.api.AddressInput
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

data class ServerUiState(
    val address: String = "",
    val token: String = "",
    val tokenVisible: Boolean = false,
    val hasStoredToken: Boolean = false,
    val keepExistingToken: Boolean = true,
    val recent: List<String> = emptyList(),
    val testing: Boolean = false,
    val report: ProbeReport? = null,
    val saved: Boolean = false,
)

/**
 * The server screen's own state.
 *
 * Separate from [com.lifeos.app.ui.LifeOsViewModel] because this screen has to
 * work when that one has nothing: no address, no token, no snapshot, no
 * connection. Coupling it to the thing that polls is how the old app ended up
 * with a Change-server button that could only be reached from a working app.
 */
class ServerViewModel(
    private val repository: LifeOsRepository,
    private val tokens: TokenStore,
    private val probe: ServerProbe,
    private val preferences: com.lifeos.app.data.AppPreferences,
) : ViewModel() {

    private val _state = MutableStateFlow(ServerUiState())
    val state: StateFlow<ServerUiState> = _state.asStateFlow()

    init {
        viewModelScope.launch {
            val prefs = preferences.current()
            _state.update {
                it.copy(
                    // Prefilled with the current address, so the common case —
                    // the last octet changed — is a two-character edit.
                    address = prefs.baseUrl ?: "",
                    recent = prefs.recentAddresses,
                    hasStoredToken = tokens.hasToken(),
                    keepExistingToken = tokens.hasToken(),
                )
            }
        }
    }

    fun onAddressChange(value: String) =
        _state.update { it.copy(address = value, report = null) }

    fun onTokenChange(value: String) =
        _state.update { it.copy(token = value, report = null) }

    fun onKeepTokenChange(keep: Boolean) =
        _state.update { it.copy(keepExistingToken = keep, report = null) }

    fun onToggleTokenVisible() =
        _state.update { it.copy(tokenVisible = !it.tokenVisible) }

    /** Three probes, four results, each with its own 6s deadline. */
    fun test() {
        val current = _state.value
        val address = AddressInput.normalise(current.address) ?: return
        viewModelScope.launch {
            _state.update { it.copy(testing = true, report = null, address = address) }
            val tokenOverride = if (current.keepExistingToken) null else current.token
            val report = probe.run(address, tokenOverride)
            _state.update { it.copy(testing = false, report = report) }
        }
    }

    /**
     * Commit. Only this writes anything.
     *
     * The token goes to the Keystore; the address goes to DataStore and clears
     * the snapshot cache if it changed.
     */
    fun save(onDone: () -> Unit) {
        val current = _state.value
        val address = AddressInput.normalise(current.address) ?: return
        viewModelScope.launch {
            if (!current.keepExistingToken && current.token.isNotBlank()) {
                tokens.save(current.token.trim())
            }
            repository.onServerChanged(address)
            repository.refresh()
            _state.update { it.copy(saved = true, address = address, token = "") }
            onDone()
        }
    }

    companion object {
        fun factory(container: AppContainer): ViewModelProvider.Factory =
            object : ViewModelProvider.Factory {
                @Suppress("UNCHECKED_CAST")
                override fun <T : ViewModel> create(modelClass: Class<T>): T = ServerViewModel(
                    repository = container.repository,
                    tokens = container.tokens,
                    probe = container.probe,
                    preferences = container.preferences,
                ) as T
            }
    }
}
