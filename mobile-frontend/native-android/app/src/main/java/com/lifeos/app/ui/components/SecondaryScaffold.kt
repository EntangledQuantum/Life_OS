package com.lifeos.app.ui.components

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import com.lifeos.app.ui.theme.LifeOsType
import com.lifeos.app.ui.theme.palette

/**
 * Every screen that is **not** one of the three destinations.
 *
 * This exists because of a bug found by driving the app on a phone: the `server`
 * screen and the Settings index drew their first row of content *behind the
 * status bar* — on Settings the word "Appearance" sat under the clock. Today, Day
 * and You were fine, which is exactly why it went unnoticed: they have their own
 * app bar inside a `Scaffold`, and a `Scaffold` consumes the status-bar inset.
 * The secondary screens were composed straight into the `NavHost` with nothing
 * between them and an edge-to-edge window.
 *
 * The fix is a pattern, not eleven fixes:
 *
 *  - `contentWindowInsets = WindowInsets.safeDrawing` — status bar, navigation
 *    bar *and* display cutout, rather than `systemBars` alone. These screens are
 *    reachable in landscape, where the cutout is on the side.
 *  - A top app bar on every one of them, which also fixes the second half of the
 *    same bug: **Settings had no visible back control at all.** Predictive back
 *    worked, so it was navigable by gesture and by nothing else.
 *  - The content is handed the scaffold's padding already applied, so a screen
 *    passed through here needs no change of its own. That is the point: a
 *    twelfth secondary screen cannot forget to do this, because there is nothing
 *    for it to remember.
 *
 * `onBack` is nullable for the one case that has nowhere to go back to.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SecondaryScaffold(
    title: String,
    onBack: (() -> Unit)?,
    modifier: Modifier = Modifier,
    actions: @Composable RowScope.() -> Unit = {},
    content: @Composable () -> Unit,
) {
    val p = palette
    Scaffold(
        modifier = modifier,
        containerColor = p.bg,
        contentColor = p.text,
        contentWindowInsets = WindowInsets.safeDrawing,
        topBar = {
            TopAppBar(
                title = { Text(title, style = LifeOsType.screenTitle, color = p.text) },
                navigationIcon = {
                    if (onBack != null) {
                        IconButton(onClick = onBack) {
                            Icon(
                                imageVector = Icons.AutoMirrored.Filled.ArrowBack,
                                contentDescription = "Back",
                                tint = p.text,
                            )
                        }
                    }
                },
                actions = actions,
                colors = TopAppBarDefaults.topAppBarColors(
                    containerColor = p.bg,
                    titleContentColor = p.text,
                    navigationIconContentColor = p.text,
                ),
            )
        },
    ) { padding ->
        Box(modifier = Modifier.padding(padding).fillMaxSize()) { content() }
    }
}

/**
 * The three terminal screens: first run, the QR stub's parent state, and `426`.
 *
 * Insets but no app bar and no back, because there is no "back" from "this app
 * has never been connected" or from "this app is too old for this server". They
 * centre a block in the window, and the only thing they were missing is the
 * inset — a centred block still collides with the status bar on a short window
 * or in landscape.
 */
@Composable
fun BlockScaffold(
    modifier: Modifier = Modifier,
    content: @Composable () -> Unit,
) {
    val p = palette
    Scaffold(
        modifier = modifier,
        containerColor = p.bg,
        contentColor = p.text,
        contentWindowInsets = WindowInsets.safeDrawing,
    ) { padding ->
        Box(modifier = Modifier.padding(padding).fillMaxSize()) { content() }
    }
}
