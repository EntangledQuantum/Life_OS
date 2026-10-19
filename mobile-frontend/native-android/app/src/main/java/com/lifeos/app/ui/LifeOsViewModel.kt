package com.lifeos.app.ui

import android.content.Context
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import com.lifeos.app.data.AppContainer
import com.lifeos.app.data.ConnectionState
import com.lifeos.app.data.LifeOsRepository
import com.lifeos.app.data.PollIntervals
import com.lifeos.app.data.TodayView
import com.lifeos.app.data.api.AgendaItemDto
import com.lifeos.app.data.sync.SyncWorker
import com.lifeos.app.domain.AgendaEpoch
import com.lifeos.app.domain.PendingWrite
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch

/** What Today renders. Assembled once, so no screen re-derives any of it. */
data class TodayUiState(
    val view: TodayView? = null,
    /**
     * The agenda in **epoch order** — the one list, already merged and already
     * ordered, with nothing moved since the user last looked at it.
     */
    val agenda: List<AgendaItemDto> = emptyList(),
    /** A refresh has been in flight for over 600ms. Before that: nothing. */
    val showRefreshLine: Boolean = false,
    /** An empty cache that has been empty for 6 seconds becomes an error panel. */
    val emptyCacheTimedOut: Boolean = false,
)

/**
 * One view model for the whole shell.
 *
 * It owns the poll, the agenda's ordering epoch and every action, which is what
 * keeps three promises structurally rather than by convention:
 *
 *  - **The poll is never started from a composition** (§7.1). It is a coroutine
 *    on `viewModelScope`, started and stopped by the destination.
 *  - **There is exactly one poller.** Three screens each starting their own is
 *    how an 8-second poll becomes three.
 *  - **The epoch survives recomposition and rotation**, so a tick cannot move a
 *    row because the window got wider.
 */
class LifeOsViewModel(
    private val repository: LifeOsRepository,
    private val appContext: Context,
) : ViewModel() {

    private var epoch: AgendaEpoch? = null
    private var pollJob: Job? = null

    private val refreshInFlight = MutableStateFlow(false)
    private val refreshLine = MutableStateFlow(false)
    private val emptyTimedOut = MutableStateFlow(false)

    val connection: StateFlow<ConnectionState> = repository.connection

    val pendingWrites: StateFlow<List<PendingWrite>> = repository.pendingWrites
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), emptyList())

    val state: StateFlow<TodayUiState> = repository.today
        .map { view -> TodayUiState(view = view, agenda = order(view)) }
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), TodayUiState())

    val refreshLineVisible: StateFlow<Boolean> = refreshLine
    val emptyCacheTimedOut: StateFlow<Boolean> = emptyTimedOut

    init {
        // A cold start fires a fetch immediately; the cached snapshot is already
        // on screen by the time it lands.
        refresh()
        SyncWorker.request(appContext)
    }

    /* -------------------------------------------------------------- ordering */

    /**
     * Apply the incoming agenda into the current epoch.
     *
     * A new epoch — a full re-sort — begins only on a life-day change, a cold
     * process start (this view model being constructed), or an explicit
     * pull-to-refresh. Within an epoch nothing already on screen changes index,
     * which is what stops a ticked row sliding to the bottom (§4.6).
     */
    private fun order(view: TodayView): List<AgendaItemDto> {
        val data = view.data ?: return emptyList()
        val lifeDay = data.lifeDay.lifeDay.ifBlank { data.date }
        val current = epoch
        val active = if (current == null || current.lifeDayDate != lifeDay) {
            AgendaEpoch.from(lifeDay, data.agenda).also { epoch = it }
        } else {
            current
        }
        return active.apply(data.agenda)
    }

    /** Pull-to-refresh, and only pull-to-refresh, starts a new epoch. */
    fun refreshAndResort() {
        epoch = null
        refresh()
    }

    /* ----------------------------------------------------------------- poll */

    /**
     * Start polling for the destination the user is on.
     *
     * 8s on Today, 10s on Day, 15s on You. Stopped when the process is
     * backgrounded (the caller ties this to the lifecycle), and fired
     * immediately on resume.
     */
    fun startPolling(intervalMs: Long = PollIntervals.TODAY_MS) {
        pollJob?.cancel()
        pollJob = viewModelScope.launch {
            refresh()
            while (true) {
                delay(intervalMs)
                refresh()
            }
        }
    }

    fun stopPolling() {
        pollJob?.cancel()
        pollJob = null
    }

    fun refresh() {
        viewModelScope.launch {
            refreshInFlight.value = true
            // The 2dp indeterminate line appears only after 600ms. Before that,
            // every tap would flicker it.
            val lineJob = launch {
                delay(com.lifeos.app.ui.theme.Motion.REFRESH_INDICATOR_DELAY_MS)
                if (refreshInFlight.value) refreshLine.value = true
            }
            repository.refresh()
            lineJob.cancel()
            refreshInFlight.value = false
            refreshLine.value = false
        }
    }

    /** Arms the 6-second timer that turns a truly empty cache into a panel. */
    fun armEmptyCacheTimeout() {
        viewModelScope.launch {
            delay(com.lifeos.app.ui.theme.Motion.EMPTY_CACHE_ERROR_MS)
            emptyTimedOut.value = true
        }
    }

    /* --------------------------------------------------------------- actions */

    /**
     * Tick a row.
     *
     * Enqueue, and return. The overlay has already moved the UI; the aggregates
     * are left to the refetch, because one write can award XP, move efficiency,
     * flip the pulse, schedule the next occurrence and complete a goal, and
     * rebuilding that here drifts.
     */
    fun tick(item: AgendaItemDto) {
        viewModelScope.launch {
            repository.complete(item.source, item.refId)
            SyncWorker.request(appContext)
            // Fired immediately after a write is enqueued, so the meter catches
            // up in well under a second on a LAN.
            refresh()
        }
    }

    fun undo(item: AgendaItemDto) {
        viewModelScope.launch {
            if (item.source == "habit") {
                repository.undoHabit(item.refId)
                SyncWorker.request(appContext)
                refresh()
            }
        }
    }

    fun dismissStrandedNotice() {
        viewModelScope.launch { repository.dismissStrandedNotice() }
    }

    fun retryAllStranded() {
        viewModelScope.launch {
            repository.retryAllStranded()
            SyncWorker.request(appContext)
        }
    }

    fun discardStranded() {
        viewModelScope.launch { repository.discardStranded() }
    }

    override fun onCleared() {
        stopPolling()
        super.onCleared()
    }

    companion object {
        fun factory(container: AppContainer, appContext: Context): ViewModelProvider.Factory =
            object : ViewModelProvider.Factory {
                @Suppress("UNCHECKED_CAST")
                override fun <T : ViewModel> create(modelClass: Class<T>): T =
                    LifeOsViewModel(container.repository, appContext) as T
            }
    }
}
