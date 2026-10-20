package com.lifeos.app.ui.components

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.lifeos.app.ui.theme.LifeOsType
import com.lifeos.app.ui.theme.LocalReducedMotion
import com.lifeos.app.ui.theme.Motion
import com.lifeos.app.ui.theme.Radii
import com.lifeos.app.ui.theme.Spacing
import com.lifeos.app.ui.theme.palette

/** How long an undo stays offered (§4.6). */
const val UNDO_WINDOW_MS = 5_000L

/**
 * The one transient surface on Today (§4.6).
 *
 * Five seconds, one action, and it **insets above the navigation bar** rather
 * than covering it — a snackbar that hides the bar is a snackbar that makes the
 * user wait before they can navigate. It fades; it does not slide, because
 * sliding chrome at the bottom edge is exactly what §5.4 cut.
 *
 * Not `SnackbarHost`: M3's host owns its own timing, its own slide-in and its
 * own insets, and all three had to be overridden. A fade and a timer is less
 * code than fighting it.
 */
@Composable
fun UndoSnackbar(
    visible: Boolean,
    message: String,
    onUndo: () -> Unit,
    onTimeout: () -> Unit,
    modifier: Modifier = Modifier,
    /** Changes when a *new* prompt appears, so the timer restarts for it. */
    promptKey: Any? = message,
) {
    val p = palette
    val reduced = LocalReducedMotion.current

    LaunchedEffect(visible, promptKey) {
        if (!visible) return@LaunchedEffect
        kotlinx.coroutines.delay(UNDO_WINDOW_MS)
        onTimeout()
    }

    AnimatedVisibility(
        visible = visible,
        enter = fadeIn(tween(if (reduced) Motion.REDUCED else Motion.SHORT)),
        exit = fadeOut(tween(if (reduced) Motion.REDUCED else Motion.SHORT)),
        modifier = modifier,
    ) {
        Box(
            modifier = Modifier
                .fillMaxWidth()
                // No navigation-bar inset here: this sits inside the shell's
                // content area, which already ends above the navigation bar.
                // Adding the inset again would float it in mid-air.
                .padding(horizontal = Spacing.lg, vertical = Spacing.md),
            contentAlignment = Alignment.BottomCenter,
        ) {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .heightIn(min = 48.dp)
                    .clip(RoundedCornerShape(Radii.tile))
                    .background(p.surface2)
                    .border(1.dp, p.border, RoundedCornerShape(Radii.tile))
                    .padding(start = Spacing.lg, end = Spacing.xs),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
            ) {
                Text(
                    text = message,
                    style = LifeOsType.bodySmall,
                    color = p.text,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.weight(1f),
                )
                // One action. A snackbar with two is a dialog that got away.
                TextButton(onClick = onUndo) {
                    Text("Undo", style = LifeOsType.label, color = p.accent)
                }
            }
        }
    }
}
