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
import com.lifeos.app.data.api.AnalyticsDto
import com.lifeos.app.data.sync.SyncWorker
import com.lifeos.app.domain.AgendaEpoch
import com.lifeos.app.domain.AnalyticsRange
import com.lifeos.app.domain.Celebration
import com.lifeos.app.domain.Celebrations
import com.lifeos.app.domain.PendingWrite
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
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
 * The overlays reached by tap and closed by back (§2.3).
 *
 * Held as state on the view model rather than as `NavHost` destinations, which
 * is a stated divergence: `navigation-compose` has no bottom-sheet destination,
 * and a `ModalBottomSheet` is an overlay over the screen underneath rather than
 * a place you go — the screen behind it keeps polling and keeps its scroll.
 * Back closes it through the sheet's own dismissal, including predictive back.
 */
sealed interface AppSheet {
    /** `agenda/{id}` — tapping a card's body. */
    data class Agenda(val id: String) : AppSheet

    /** `task/{id}` — a Day row or a Needs-you row. */
    data class Task(val id: String) : AppSheet

    /** The meter's vsYesterday sheet: everything cut from Today. */
    data object MeterDetail : AppSheet

    /** `session/picker` — the seven activity chips. */
    data object SessionPicker : AppSheet

    /** `study/log` — Day's FAB. */
    data object StudyLog : AppSheet
}

/**
 * The 5-second undo snackbar after a tick (§4.6).
 *
 * Only for habits: `POST /habits/:id/undo` exists and there is no task
 * equivalent, so offering Undo on a task would be a button that cannot work.
 */
data class UndoPrompt(val item: AgendaItemDto, val shownAt: Long)

/** You's lower half. One request per range the user asks for, never polled. */
data class AnalyticsState(
    val range: AnalyticsRange = AnalyticsRange.D7,
    val loading: Boolean = false,
    val payload: AnalyticsDto? = null,
    val error: String? = null,
    /** Collapsed by default (§3.3): the 7-day XP chart and nothing else. */
    val expanded: Boolean = false,
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

    /* ------------------------------------------------------------- overlays */

    private val _sheet = MutableStateFlow<AppSheet?>(null)
    val sheet: StateFlow<AppSheet?> = _sheet

    fun openSheet(sheet: AppSheet) {
        _sheet.value = sheet
    }

    fun closeSheet() {
        _sheet.value = null
    }

    /* ---------------------------------------------------------------- undo */

    private val _undoPrompt = MutableStateFlow<UndoPrompt?>(null)
    val undoPrompt: StateFlow<UndoPrompt?> = _undoPrompt

    /**
     * Rows already offered an undo in this epoch.
     *
     * "It does not reappear on a second tick of the same row" — a user who ticks,
     * undoes and re-ticks has made their point, and a snackbar that returns every
     * time becomes a thing to dismiss rather than a safety net.
     */
    private val undoOffered = HashSet<String>()

    fun dismissUndoPrompt() {
        _undoPrompt.value = null
    }

    /* ----------------------------------------------------------- analytics */

    private val _analytics = MutableStateFlow(AnalyticsState())
    val analytics: StateFlow<AnalyticsState> = _analytics

    fun toggleAnalytics() {
        _analytics.value = _analytics.value.copy(expanded = !_analytics.value.expanded)
    }

    /**
     * Pick a range.
     *
     * `7d` is served from the snapshot the whole app already has, so it costs no
     * request and works offline; the other three are one `GET /api/v1/analytics`
     * each. A failure here is reported in place and never changes the connection
     * state — the rest of You is still correct.
     */
    fun selectRange(range: AnalyticsRange) {
        val current = _analytics.value
        if (current.range == range && (range.fromSnapshot || current.payload != null)) return
        _analytics.value = current.copy(range = range, error = null, payload = null)
        if (range.fromSnapshot) return
        viewModelScope.launch {
            _analytics.value = _analytics.value.copy(loading = true)
            val result = repository.analytics(range)
            // A range the user has since changed away from must not land.
            if (_analytics.value.range != range) return@launch
            _analytics.value = result.fold(
                onSuccess = { _analytics.value.copy(loading = false, payload = it, error = null) },
                onFailure = {
                    _analytics.value.copy(
                        loading = false,
                        payload = null,
                        error = it.message ?: "Couldn't load that range",
                    )
                },
            )
        }
    }

    /* --------------------------------------------------------- celebration */

    /**
     * Keys the user has pressed **Nice** on.
     *
     * The `celebration-seen` write is queued like everything else, so the next
     * poll still reports the goal pending for a moment. Without this the dialog
     * would reappear the instant it closed — and §3.4 forbids anything that
     * makes the celebration feel like it is fighting the user.
     */
    private val celebrationsDismissed = MutableStateFlow<Set<String>>(emptySet())

    val celebration: StateFlow<Celebration?> =
        combine(repository.today, celebrationsDismissed) { view, dismissed ->
            Celebrations.next(view.data?.pendingCelebrations ?: emptyList(), dismissed)
        }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), null)

    /**
     * The only path to `celebration-seen` — a real dismissal, never a render and
     * never a timer.
     */
    fun dismissCelebration(celebration: Celebration) {
        celebrationsDismissed.value = celebrationsDismissed.value + celebration.key
        viewModelScope.launch {
            repository.markCelebrationSeen(celebration.goalId)
            SyncWorker.request(appContext)
            refresh()
        }
    }

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
            // A new epoch is also a new day's worth of undo offers.
            undoOffered.clear()
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
        // Undo exists for habits only, and once per row per epoch.
        if (item.source == "habit" && !item.done && undoOffered.add(item.refId)) {
            _undoPrompt.value = UndoPrompt(item, System.currentTimeMillis())
        }
    }

    fun undo(item: AgendaItemDto) {
        _undoPrompt.value = null
        viewModelScope.launch {
            if (item.source == "habit") {
                repository.undoHabit(item.refId)
                SyncWorker.request(appContext)
                refresh()
            }
        }
    }

    /* -------------------------------------------- the rest of the actions */

    /** Needs you: complete. Same endpoint a Day row's tick uses. */
    fun completeTask(taskId: String) {
        viewModelScope.launch {
            repository.complete("task", taskId)
            SyncWorker.request(appContext)
            refresh()
        }
    }

    /** Needs you: put it away without doing it. Day-independent. */
    fun dismissTask(taskId: String) {
        viewModelScope.launch {
            repository.dismissTask(taskId)
            SyncWorker.request(appContext)
            refresh()
        }
    }

    fun startSession(activity: String) {
        closeSheet()
        viewModelScope.launch {
            repository.startSession(activity)
            SyncWorker.request(appContext)
            refresh()
        }
    }

    fun stopSession() {
        viewModelScope.launch {
            repository.stopSession()
            SyncWorker.request(appContext)
            refresh()
        }
    }

    fun logStudy(title: String, minutes: Int, qualityFlag: String) {
        closeSheet()
        viewModelScope.launch {
            repository.logStudy(title, minutes, qualityFlag)
            SyncWorker.request(appContext)
            refresh()
        }
    }

    /**
     * A server-backed setting, through the same queue as everything else, so a
     * control moves instantly offline and syncs later (§3.5).
     */
    fun patchSetting(key: String, value: String) {
        viewModelScope.launch {
            repository.patchSettings(key, value)
            SyncWorker.request(appContext)
            refresh()
        }
    }

    fun patchSetting(key: String, value: Int) {
        viewModelScope.launch {
            repository.patchSettings(key, value)
            SyncWorker.request(appContext)
            refresh()
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
