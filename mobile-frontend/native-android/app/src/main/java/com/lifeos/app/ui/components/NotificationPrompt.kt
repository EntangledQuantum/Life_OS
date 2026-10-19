package com.lifeos.app.ui.components

import android.Manifest
import android.os.Build
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalContext
import com.lifeos.app.data.api.DashboardTodayDto
import com.lifeos.app.domain.Reminders
import com.lifeos.app.notify.LifeOsChannels
import com.lifeos.app.ui.theme.LifeOsType
import com.lifeos.app.ui.theme.Radii
import com.lifeos.app.ui.theme.Spacing
import com.lifeos.app.ui.theme.palette

/**
 * `POST_NOTIFICATIONS`, asked **in context** (§8.2).
 *
 * Never on first launch cold. A permission dialog on the first frame of an app
 * the user has not yet connected to a server is a dialog about nothing, and it
 * is answered "no" — permanently, because Android only asks twice.
 *
 * So the condition is the one §8.2 names: the first time the user is about to
 * rely on a reminder. Concretely, **there is at least one task with a derived
 * notification time** — which is `remindAt ?? eventAt - lead` through the same
 * [Reminders.notifyAtMillis] the alarms use, not a second hand-written test for
 * "has a time". Plus a one-line rationale, and asked once: a denial is
 * remembered in preferences so this does not reappear on every resume.
 *
 * Denied is a fully supported state. The in-app pulse and the status strip carry
 * everything, and Settings → Notifications says Android is blocking them with a
 * link to the screen that unblocks it.
 */
@Composable
fun NotificationPermissionPrompt(
    data: DashboardTodayDto?,
    leadMinutes: Int,
    alreadyAsked: Boolean,
    onAsked: () -> Unit,
    modifier: Modifier = Modifier,
) {
    // Below 33 the permission is granted at install; there is nothing to ask.
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) return
    if (alreadyAsked) return

    val context = LocalContext.current
    if (LifeOsChannels.permitted(context)) return

    val hasSomethingToSay = data?.tasks?.any {
        Reminders.notifyAtMillis(it, leadMinutes) != null
    } ?: false
    if (!hasSomethingToSay) return

    val launcher = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.RequestPermission(),
        // Recorded either way: asking again after a refusal is how an app
        // becomes something to dismiss.
        onResult = { onAsked() },
    )

    val p = palette
    Column(
        modifier = modifier
            .fillMaxWidth()
            .padding(horizontal = Spacing.lg, vertical = Spacing.sm)
            .clip(RoundedCornerShape(Radii.tile))
            .background(p.surface)
            .padding(Spacing.md),
        verticalArrangement = Arrangement.spacedBy(Spacing.xs),
    ) {
        Text("Be told before things", style = LifeOsType.body, color = p.text)
        Text(
            text = "You have something scheduled today. Android needs your " +
                "permission before Life OS can say so.",
            style = LifeOsType.bodySmall,
            color = p.faint,
        )
        Row(horizontalArrangement = Arrangement.spacedBy(Spacing.sm)) {
            TextButton(onClick = { launcher.launch(Manifest.permission.POST_NOTIFICATIONS) }) {
                Text("Allow", color = p.accent)
            }
            TextButton(onClick = onAsked) {
                Text("Not now", color = p.muted)
            }
        }
    }
}
