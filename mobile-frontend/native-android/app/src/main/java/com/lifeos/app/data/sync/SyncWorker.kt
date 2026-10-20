package com.lifeos.app.data.sync

import android.content.Context
import androidx.work.BackoffPolicy
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import com.lifeos.app.LifeOsApp
import com.lifeos.app.data.DrainOutcome
import com.lifeos.app.widget.LifeOsWidget
import kotlinx.coroutines.flow.first
import java.util.concurrent.TimeUnit

/**
 * Drains the write queue, then refetches.
 *
 * `WorkManager` rather than a coroutine on the app scope, because the queue has
 * to survive the process: the user ticks a row, puts the phone in their pocket,
 * and the machine wakes up twenty minutes later. A job that dies with the
 * Activity is a write the user believes they made and did not.
 *
 * Exponential backoff is WorkManager's; the per-write backoff inside the drain
 * is separate and stops one failing write starving the rest of the queue.
 */
class SyncWorker(context: Context, params: WorkerParameters) :
    CoroutineWorker(context, params) {

    override suspend fun doWork(): Result {
        val app = applicationContext as? LifeOsApp ?: return Result.success()
        val repository = app.container.repository

        val outcome = runCatching { repository.drain() }.getOrElse { return Result.retry() }

        /*
         * A write landing changes aggregates the client deliberately does not
         * patch (§4.6), so a successful drain is always followed by a refetch.
         *
         * The periodic run refetches whether or not anything drained: that is
         * the whole point of it — the cache, and therefore the widget, has to
         * be current without the app having been opened.
         */
        if (outcome == DrainOutcome.DRAINED || isPeriodic) {
            runCatching { repository.refresh() }
        }

        /*
         * Reminders and the widget are reconciled from the same snapshot, in
         * the same run, so they cannot disagree about what today looks like.
         * Both read Room; neither fetches on its own.
         */
        runCatching {
            app.container.reminders.reconcile(repository.today.first())
        }
        runCatching { LifeOsWidget.refresh(applicationContext) }

        return when (outcome) {
            DrainOutcome.RETRY -> Result.retry()
            // Nothing to do and nothing we can do: a cleared token or a missing
            // address is the connect graph's problem, not something to retry
            // against until the battery dies.
            DrainOutcome.UNAUTHORIZED, DrainOutcome.NOT_CONFIGURED -> Result.success()
            DrainOutcome.EMPTY, DrainOutcome.DRAINED -> Result.success()
        }
    }

    /** The periodic run refetches unconditionally; the on-demand one does not. */
    private val isPeriodic: Boolean get() = tags.contains(TAG_PERIODIC)

    companion object {
        private const val UNIQUE_NAME = "lifeos-drain"
        private const val PERIODIC_NAME = "lifeos-periodic"
        private const val TAG_PERIODIC = "lifeos-periodic-tag"

        /**
         * Keep the cache, the widget and the reminder alarms current without
         * the app being opened (Part C).
         *
         * **What Android actually guarantees here, stated plainly, because the
         * alternative is a README that promises something the platform will not
         * deliver:**
         *
         *  - Fifteen minutes is the *minimum* period `WorkManager` accepts, and
         *    it is a floor, not a schedule. The real interval is whatever the
         *    OS decides: in Doze, work is deferred to maintenance windows,
         *    which on an idle phone overnight can be hours apart. On many OEM
         *    builds — and OnePlus/ColorOS, which this is tested on, is one of
         *    the stricter ones — aggressive battery management can defer or
         *    drop it entirely until the app is next opened.
         *  - So this is a **best-effort freshener**, not a delivery mechanism.
         *    Nothing the user must hear depends on it: the reminders that must
         *    arrive on time are `AlarmManager` alarms seeded from the derived
         *    times (`ReminderAlarms`), which is a different and much stronger
         *    OS promise.
         *  - It is deliberately **not** a foreground service. A persistent
         *    notification for a habit tracker is a worse product and a worse
         *    citizen, and it is the kind of thing that gets an app flagged.
         *
         * `KEEP` so re-asking on every launch does not reset the period and
         * push the next run fifteen minutes out forever.
         */
        fun schedulePeriodic(context: Context) {
            val request = PeriodicWorkRequestBuilder<SyncWorker>(
                repeatInterval = 15,
                repeatIntervalTimeUnit = TimeUnit.MINUTES,
            )
                .addTag(TAG_PERIODIC)
                .setConstraints(
                    Constraints.Builder()
                        // Any network. Life OS is on the LAN, so UNMETERED or
                        // NOT_ROAMING would be wrong — the server is on the same
                        // Wi-Fi, and a phone with no internet can still reach it.
                        .setRequiredNetworkType(NetworkType.CONNECTED)
                        // No battery-not-low or idle constraint: a refresh is
                        // one small GET, and adding constraints only buys more
                        // reasons for it never to run.
                        .build(),
                )
                .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 5, TimeUnit.MINUTES)
                .build()

            WorkManager.getInstance(context).enqueueUniquePeriodicWork(
                PERIODIC_NAME,
                ExistingPeriodicWorkPolicy.KEEP,
                request,
            )
        }

        /**
         * Ask for a drain. Called after every enqueue, and on reconnect.
         *
         * `APPEND_OR_REPLACE` rather than `KEEP`: a tick that arrives while a
         * drain is already running must not be silently dropped, and the drain is
         * idempotent over the queue so running it twice is harmless.
         */
        fun request(context: Context) {
            val request = OneTimeWorkRequestBuilder<SyncWorker>()
                .setConstraints(
                    Constraints.Builder()
                        // Any network: Life OS is on the LAN, so CONNECTED is the
                        // right constraint and NOT_ROAMING/UNMETERED would be
                        // wrong — the server is on the same Wi-Fi.
                        .setRequiredNetworkType(NetworkType.CONNECTED)
                        .build(),
                )
                .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 10, TimeUnit.SECONDS)
                .build()

            WorkManager.getInstance(context)
                .enqueueUniqueWork(UNIQUE_NAME, ExistingWorkPolicy.APPEND_OR_REPLACE, request)
        }
    }
}
