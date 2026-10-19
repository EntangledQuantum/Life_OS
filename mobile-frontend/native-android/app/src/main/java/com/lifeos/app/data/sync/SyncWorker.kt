package com.lifeos.app.data.sync

import android.content.Context
import androidx.work.BackoffPolicy
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import com.lifeos.app.LifeOsApp
import com.lifeos.app.data.DrainOutcome
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

        // A write landing changes aggregates the client deliberately does not
        // patch (§4.6), so a successful drain is always followed by a refetch.
        if (outcome == DrainOutcome.DRAINED) {
            runCatching { repository.refresh() }
        }

        return when (outcome) {
            DrainOutcome.RETRY -> Result.retry()
            // Nothing to do and nothing we can do: a cleared token or a missing
            // address is the connect graph's problem, not something to retry
            // against until the battery dies.
            DrainOutcome.UNAUTHORIZED, DrainOutcome.NOT_CONFIGURED -> Result.success()
            DrainOutcome.EMPTY, DrainOutcome.DRAINED -> Result.success()
        }
    }

    companion object {
        private const val UNIQUE_NAME = "lifeos-drain"

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
