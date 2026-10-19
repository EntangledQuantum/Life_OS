package com.lifeos.app.widget

import android.content.Context
import androidx.glance.GlanceId
import androidx.glance.appwidget.GlanceAppWidgetReceiver
import androidx.glance.appwidget.action.ActionCallback
import androidx.glance.action.ActionParameters
import androidx.glance.action.actionParametersOf
import androidx.glance.appwidget.GlanceAppWidget
import com.lifeos.app.LifeOsApp
import com.lifeos.app.data.api.AgendaItemDto
import com.lifeos.app.data.sync.SyncWorker

/**
 * The receiver the launcher talks to.
 *
 * Nothing in it but the widget it hosts: everything else is reached through
 * `LifeOsApp.container`, the same object graph the app and the workers use, so
 * the widget cannot end up with a second repository or a second write queue.
 */
class LifeOsWidgetReceiver : GlanceAppWidgetReceiver() {
    override val glanceAppWidget: GlanceAppWidget = LifeOsWidget()
}

/**
 * Ticking a row from the home screen (§8.5).
 *
 * **Through the same write queue as everything else**, which is the whole point:
 * it works with the app closed and the server asleep, it is stamped with the
 * life-day that is current at the moment of the tap so the guard can refuse it
 * if the day rolls over before it sends, and the optimistic overlay means the
 * widget redraws immediately without waiting for a round trip.
 *
 * `updateAll` right after the enqueue is that immediate redraw: the overlay is
 * applied on read, so re-rendering from Room is enough — there is no separate
 * widget state to patch.
 */
class WidgetTickAction : ActionCallback {

    override suspend fun onAction(
        context: Context,
        glanceId: GlanceId,
        parameters: ActionParameters,
    ) {
        val source = parameters[KEY_SOURCE] ?: return
        val refId = parameters[KEY_REF] ?: return
        val app = context.applicationContext as? LifeOsApp ?: return

        app.container.repository.complete(source, refId)
        SyncWorker.request(context)
        LifeOsWidget.refresh(context)
    }

    companion object {
        private val KEY_SOURCE = ActionParameters.Key<String>("source")
        private val KEY_REF = ActionParameters.Key<String>("refId")

        fun params(item: AgendaItemDto): ActionParameters =
            actionParametersOf(KEY_SOURCE to item.source, KEY_REF to item.refId)
    }
}

/**
 * Setting what you are doing, from a chip.
 *
 * The same `POST /api/v1/session/active` the picker sheet sends, queued the same
 * way. `startedAt` is deliberately not sent — the server stamps it, so a phone
 * with a drifting clock cannot write a session that started in the future.
 */
class WidgetSessionAction : ActionCallback {

    override suspend fun onAction(
        context: Context,
        glanceId: GlanceId,
        parameters: ActionParameters,
    ) {
        val activity = parameters[KEY_ACTIVITY] ?: return
        val app = context.applicationContext as? LifeOsApp ?: return

        app.container.repository.startSession(activity)
        SyncWorker.request(context)
        LifeOsWidget.refresh(context)
    }

    companion object {
        private val KEY_ACTIVITY = ActionParameters.Key<String>("activity")

        fun params(activity: String): ActionParameters =
            actionParametersOf(KEY_ACTIVITY to activity)
    }
}
