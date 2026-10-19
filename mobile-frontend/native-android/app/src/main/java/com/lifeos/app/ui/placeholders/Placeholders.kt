package com.lifeos.app.ui.placeholders

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextAlign
import com.lifeos.app.ui.components.Mono
import com.lifeos.app.ui.theme.LifeOsType
import com.lifeos.app.ui.theme.Spacing
import com.lifeos.app.ui.theme.palette

/**
 * Day and You, this milestone.
 *
 * The shell, the navigation and the motion are real; the content is not. Stated
 * on screen rather than faked, because a screen that looks finished and is not
 * is how a milestone gets signed off twice.
 *
 * Day will hold the ribbon, Needs-you and the four day buckets; You will hold
 * goals and the folded-in analytics.
 */
@Composable
fun PlaceholderScreen(
    title: String,
    willHold: String,
    liveFact: String?,
    modifier: Modifier = Modifier,
) {
    val p = palette
    Column(
        modifier = modifier.fillMaxSize().padding(Spacing.xxl),
        verticalArrangement = Arrangement.spacedBy(Spacing.md, Alignment.CenterVertically),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text(title, style = LifeOsType.screenTitle, color = p.text)
        Text(
            text = willHold,
            style = LifeOsType.bodySmall,
            color = p.muted,
            textAlign = TextAlign.Center,
        )
        // One real number from the live snapshot, so the screen proves the data
        // layer is wired rather than only claiming it.
        if (!liveFact.isNullOrBlank()) {
            Mono(liveFact, color = p.faint)
        }
    }
}
