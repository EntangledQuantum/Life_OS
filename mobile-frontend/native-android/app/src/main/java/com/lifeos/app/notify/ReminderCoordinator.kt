package com.lifeos.app.notify

import android.content.Context
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.ProcessLifecycleOwner
import com.lifeos.app.data.AppPreferences
import com.lifeos.app.data.ConnectionState
import com.lifeos.app.data.LifeOsRepository
import com.lifeos.app.data.TodayView
import com.lifeos.app.data.api.SettingsDto
import com.lifeos.app.data.db.FiredNotificationDao
import com.lifeos.app.data.db.FiredNotificationEntity
import com.lifeos.app.data.sync.SyncWorker
import com.lifeos.app.domain.NotificationSounds
import com.lifeos.app.domain.NotificationType
import com.lifeos.app.domain.QuietHours
import com.lifeos.app.domain.Reminders
import com.lifeos.app.domain.SoundId
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import java.time.LocalTime

/**
 * The reminder runner (UI_SPEC §8.4).
 *
 * ## Where this lives, and why that is the whole point
 *
 * In the old app the equivalent was a component mounted by the Today screen. If
 * the app reopened on Timeline — which is where a tapped notification landed
 * you — nothing was ever registered with the OS, and the only notifications that
 * fired were the ones raised while Today happened to be open. The lesson
 * transfers even though the code does not: **this is not owned by a screen.** It
 * is created by `AppContainer`, started from `LifeOsApp.onCreate`, and collects
 * Room. Every destination, every cold start and every background `SyncWorker`
 * run goes through it, because they all end in a snapshot landing in Room.
 *
 * It reads Room rather than being called by the repository on each fetch, which
 * keeps the one-seam architecture intact: the repository writes snapshots, and
 * everything else — the UI, the widget, this — is a reader.
 */
class ReminderCoordinator(
    private val context: Context,
    private val repository: LifeOsRepository,
    private val preferences: AppPreferences,
    private val fired: FiredNotificationDao,
    private val scope: CoroutineScope,
    private val now: () -> Long = System::currentTimeMillis,
) {

    /** Keys claimed in this process. Guards the race, not the restart. */
    private val claimedHere = HashSet<String>()

    /**
     * Collect, and reconcile on every change that could matter.
     *
     * `distinctUntilChanged` on a small key rather than on the view: the
     * repository's flow re-emits on every write-queue change, and reseeding
     * sixteen alarms each time a tick is enqueued is work for nothing.
     */
    fun start() {
        scope.launch {
            combine(repository.today, preferences.prefs) { view, prefs ->
                view to prefs
            }
                .distinctUntilChanged { (oldView, oldPrefs), (newView, newPrefs) ->
                    oldView.fetchedAt == newView.fetchedAt &&
                        oldView.settings == newView.settings &&
                        oldView.connection == newView.connection &&
                        oldView.strandedNotice == newView.strandedNotice &&
                        oldPrefs.notificationSounds == newPrefs.notificationSounds
                }
                .collect { (view, prefs) ->
                    runCatching {
                        LifeOsChannels.sync(
                            context = context,
                            chosen = prefs.notificationSounds,
                            serverDefault = view.settings.notificationSound,
                        )
                        reconcile(view)
                    }
                }
        }

        scope.launch {
            // A week back is well past the alarm horizon, so a pruned key can
            // never be re-fired by a task that is still live.
            runCatching { fired.prune(now() - 7L * 24 * 60 * 60 * 1000) }
        }
    }

    /**
     * Seed the alarms and say anything that is due now.
     *
     * Also called directly after a background sync, so the widget and the
     * notifications are current together.
     */
    suspend fun reconcile(view: TodayView) {
        val data = view.data ?: return
        val settings = view.settings
        val plan = Reminders.plan(data, settings, now())

        ReminderAlarms.reseed(context, plan.alarms)

        /*
         * Due-now. The alarm path handles the backgrounded case; this handles
         * the case where the app is open and the server has moved a task into
         * `dueReminders` since the last poll. Both go through the same claim, so
         * whichever arrives first wins and the other does nothing.
         */
        for (task in plan.dueNow) {
            fire(
                type = NotificationType.DUE_NOW,
                targetId = task.id,
                title = task.title,
                body = task.subtitle ?: task.purpose,
                settings = settings,
                lifeDay = data.lifeDay.lifeDay,
                withTaskActions = true,
            )
        }

        /*
         * Needs-you and Goal-ready only while backgrounded.
         *
         * Not a shortcut: with the app open, Day already lists the queue and the
         * celebration overlay is already on screen over every destination. An OS
         * notification about something the user is looking at is the noise §9.10
         * is about.
         */
        if (!isForeground()) {
            for (task in plan.needsYou) {
                fire(
                    type = NotificationType.NEEDS_YOU,
                    targetId = task.id,
                    title = task.title,
                    body = task.subtitle ?: "The agent is waiting on you",
                    settings = settings,
                    lifeDay = data.lifeDay.lifeDay,
                )
            }
            for (goal in plan.goalsReady) {
                fire(
                    type = NotificationType.GOAL_READY,
                    targetId = goal.id,
                    title = goal.pendingTier?.title ?: goal.title,
                    body = "Ready to see",
                    settings = settings,
                    lifeDay = data.lifeDay.lifeDay,
                    // A goal is not a task: there is nothing to tick and nothing
                    // to snooze, and `celebration-seen` fires on **Nice.** and on
                    // nothing else (§3.4).
                )
            }
        }

        syncProblem(view)
    }

    /**
     * The alarm receiver's entry point: say this one reminder.
     *
     * Prefers the live task from Room over the intent's extras, because the
     * agent may have retitled or completed it since the alarm was set. A task
     * that is gone or already done says nothing — the alarm was a plan, not a
     * promise.
     */
    suspend fun fireReminder(taskId: String, fallbackTitle: String?, fallbackBody: String?) {
        val view = repository.today.first()
        val data = view.data
        val task = data?.tasks?.firstOrNull { it.id == taskId }

        if (task != null && !com.lifeos.app.domain.Predicates.isOpen(task)) return

        fire(
            type = NotificationType.REMINDER,
            targetId = taskId,
            title = task?.title ?: fallbackTitle ?: "Life OS",
            body = task?.subtitle ?: task?.purpose ?: fallbackBody,
            settings = view.settings,
            lifeDay = data?.lifeDay?.lifeDay ?: "",
            withTaskActions = true,
        )
    }

    /**
     * Fire once, and only once (§8.4).
     *
     * The order is the contract, and it is this order on purpose:
     *
     *  1. **Claim.** `INSERT OR IGNORE` on the fired table. Losing the claim
     *     means somebody else already said it, and we stop — no post, and no
     *     second `/notified`.
     *  2. **POST `/notified`**, enqueued, *before* anything about audio or
     *     visuals is decided. Under DND and quiet hours this is the only step
     *     that happens, which is exactly §8.4's rule: the server must know the
     *     item was surfaced even when the phone said nothing, or every
     *     suppressed reminder fires the moment DND ends.
     *  3. **Post**, unless silenced. Never let the visual channel depend on the
     *     audio: a silent sound id still posts a notification, and a denied
     *     permission still leaves the in-app pulse and the status strip
     *     carrying everything.
     */
    private suspend fun fire(
        type: NotificationType,
        targetId: String,
        title: String,
        body: String?,
        settings: SettingsDto,
        lifeDay: String,
        withTaskActions: Boolean = false,
    ) {
        val key = "${type.key}:$targetId"

        // The in-process half: a recomposition racing the claim is the common
        // bug, and it is cheaper to lose here than in SQLite.
        synchronized(claimedHere) {
            if (!claimedHere.add(key)) return
        }

        val claimed = fired.claim(
            FiredNotificationEntity(key = key, firedAt = now(), lifeDayDate = lifeDay),
        )
        if (claimed < 0) return

        // Step 2, unconditionally. Goals have no /notified endpoint; the
        // celebration's own `celebration-seen` is the receipt for those.
        if (type == NotificationType.REMINDER ||
            type == NotificationType.DUE_NOW ||
            type == NotificationType.NEEDS_YOU
        ) {
            runCatching {
                repository.markNotified(targetId)
                SyncWorker.request(context)
            }
        }

        val nowMinutes = LocalTime.now().let { it.hour * 60 + it.minute }
        if (QuietHours.isSilenced(settings, nowMinutes)) {
            // Post nothing, flash nothing, keep the item visible and pulsing in
            // the app, and let the status strip say it is silenced.
            return
        }

        val sound = NotificationSounds.resolve(
            type = type,
            chosen = preferences.current().notificationSounds,
            serverDefault = settings.notificationSound,
        )
        Notifier.post(
            context = context,
            type = type,
            targetId = targetId,
            title = title,
            body = body,
            sound = sound,
            withTaskActions = withTaskActions,
        )
    }

    /**
     * The one notification that is not about the day (§8.1).
     *
     * Stranded writes, or no successful contact for over thirty minutes with a
     * non-empty queue. Silent, `LOW`, no sound row, and keyed by life-day so it
     * is said once per day rather than once per poll.
     */
    private suspend fun syncProblem(view: TodayView) {
        val lifeDay = view.data?.lifeDay?.lifeDay ?: return
        val stranded = view.strandedNotice

        val unreachableTooLong = (view.connection as? ConnectionState.Unreachable)
            ?.let { state ->
                val since = state.fetchedAt ?: return@let false
                view.pendingCount > 0 && now() - since > UNREACHABLE_NOTICE_MS
            } ?: false

        val reason = when {
            stranded != null ->
                "${stranded.count} change(s) from ${stranded.lifeDayDate} couldn't be saved"

            unreachableTooLong ->
                "${view.pendingCount} change(s) waiting — Life OS hasn't answered for a while"

            else -> return
        }

        fire(
            type = NotificationType.SYNC_PROBLEM,
            targetId = lifeDay,
            title = "Life OS couldn't sync",
            body = reason,
            settings = view.settings,
            lifeDay = lifeDay,
        )
    }

    private fun isForeground(): Boolean =
        runCatching {
            ProcessLifecycleOwner.get().lifecycle.currentState
                .isAtLeast(Lifecycle.State.STARTED)
        }.getOrDefault(false)

    /** Sound ids the picker previews. Kept here so Settings need not know the URI. */
    fun previewUri(sound: SoundId) = LifeOsChannels.uri(context, sound)

    private companion object {
        const val UNREACHABLE_NOTICE_MS = 30L * 60 * 1000
    }
}
