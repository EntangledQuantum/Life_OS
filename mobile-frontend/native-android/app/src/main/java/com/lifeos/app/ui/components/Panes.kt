package com.lifeos.app.ui.components

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.widthIn
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.lifeos.app.ui.theme.Sizes
import com.lifeos.app.ui.theme.Spacing

/**
 * Expanded-width two columns (§2.4), and the rule they exist to keep.
 *
 * **In one column the agent's cards come after the day, never before.** Your own
 * habits are what the screen is for; the agent's reading of them is commentary.
 * So this takes the two in that order and lays them out as one column below
 * 840dp and as two beside each other at or above it — the same source order,
 * one layout decision, which is why it is one component rather than an `if` in
 * each screen.
 *
 * Nothing animates when the window is resized: Android resizes the app while it
 * runs, and a 350ms transition on every drag of a split-screen divider is the
 * busiest thing a tablet can do.
 *
 * **Caller's half of the contract:** below 840dp the agent's content belongs
 * *inside* the primary list, so it scrolls with the day, and `secondary` draws
 * nothing. Two scrolling lists stacked in a column is not a one-column layout,
 * it is two viewports — which is why this does not try to merge them.
 */
@Composable
fun TwoPane(
    expanded: Boolean,
    modifier: Modifier = Modifier,
    /** The day. Always first, always the wider column. */
    primary: @Composable () -> Unit,
    /** The agent's commentary. Second column, or below. */
    secondary: @Composable () -> Unit,
) {
    if (!expanded) {
        Column(modifier = modifier.fillMaxSize()) {
            primary()
            secondary()
        }
        return
    }

    Row(
        modifier = modifier.fillMaxSize(),
        horizontalArrangement = Arrangement.spacedBy(Spacing.xl),
    ) {
        Box(
            modifier = Modifier
                .weight(0.58f)
                .fillMaxHeight(),
            contentAlignment = Alignment.TopCenter,
        ) {
            // The line-length cap still applies per column; a 1200dp window
            // must not stretch a sentence across all of it.
            Box(modifier = Modifier.widthIn(max = Sizes.contentMax)) { primary() }
        }
        Box(
            modifier = Modifier
                .weight(0.42f)
                .fillMaxHeight(),
            contentAlignment = Alignment.TopStart,
        ) {
            Box(modifier = Modifier.widthIn(max = 420.dp)) { secondary() }
        }
    }
}
