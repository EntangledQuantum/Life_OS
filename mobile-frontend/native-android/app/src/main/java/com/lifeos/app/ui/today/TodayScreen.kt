package com.lifeos.app.ui.today

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.clickable
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.lifeos.app.data.ConnectionState
import com.lifeos.app.data.api.AgendaItemDto
import com.lifeos.app.data.api.DashboardTodayDto
import com.lifeos.app.domain.PetalInput
import com.lifeos.app.domain.Predicates
import com.lifeos.app.ui.TodayUiState
import com.lifeos.app.ui.components.ErrorPanel
import com.lifeos.app.ui.components.Mono
import com.lifeos.app.ui.components.PageBody
import com.lifeos.app.ui.components.SectionHeader
import com.lifeos.app.ui.components.SkeletonBlock
import com.lifeos.app.ui.components.TwoPane
import com.lifeos.app.ui.growth.GrowthMeter
import com.lifeos.app.ui.growth.GrowthStyle
import com.lifeos.app.ui.theme.serverColor
import com.lifeos.app.ui.theme.LifeOsType
import com.lifeos.app.ui.theme.NEUTRAL_NEG
import com.lifeos.app.ui.theme.POSITIVE
import com.lifeos.app.ui.theme.Radii
import com.lifeos.app.ui.theme.Sizes
import com.lifeos.app.ui.theme.Spacing
import com.lifeos.app.ui.theme.WARNING
import com.lifeos.app.ui.theme.palette

/**
 * The screen people look at. Everything else can be imperfect.
 *
 * **One thing to look at:** the growth meter. Five information units above the
 * fold — activity line, meter (with its two numbers), pulse, and the first two
 * agenda cards — which satisfies the five-unit budget with nothing to spare.
 * That is the point: the old Today had eleven.
 *
 * There is **no FAB**. The primary action is already on every row, and a FAB
 * would float over the one list that matters.
 */
@Composable
fun TodayScreen(
    state: TodayUiState,
    refreshLineVisible: Boolean,
    emptyCacheTimedOut: Boolean,
    address: String?,
    /** ≥ 840dp: the agent's cards move to a second column (§2.4). */
    expanded: Boolean,
    onTick: (AgendaItemDto) -> Unit,
    onOpenItem: (AgendaItemDto) -> Unit,
    onOpenMeterDetail: () -> Unit,
    onOpenNeedsYou: () -> Unit,
    onStartSessionPicker: () -> Unit,
    onStopSession: () -> Unit,
    onRetry: () -> Unit,
    onChangeServer: () -> Unit,
    onArmEmptyTimeout: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val data = state.view?.data
    val p = palette

    LaunchedEffect(data == null) {
        if (data == null) onArmEmptyTimeout()
    }

    Column(modifier = modifier.fillMaxSize()) {
        // A refresh in flight shows a 2dp indeterminate line under the app bar
        // after 600ms only — not before, or every tap flickers it.
        if (refreshLineVisible) {
            LinearProgressIndicator(
                modifier = Modifier.fillMaxWidth().height(2.dp),
                color = p.accent,
                trackColor = p.surface,
            )
        }

        if (data == null) {
            // Truly empty cache: skeletons matching the final layout, never a
            // centred spinner, replaced by the error panel after six seconds.
            PageBody(modifier = Modifier.padding(Spacing.lg)) {
                if (emptyCacheTimedOut) {
                    ErrorPanel(
                        waitingFor = "Waiting for today's dashboard",
                        serverMessage = failureDetail(state.view?.connection),
                        address = address,
                        onRetry = onRetry,
                        onChangeServer = onChangeServer,
                    )
                } else {
                    SkeletonBlock(Sizes.activityLine.value.toInt())
                    SkeletonBlock(200)
                    SkeletonBlock(Sizes.agendaCard.value.toInt())
                    SkeletonBlock(Sizes.agendaCard.value.toInt())
                }
            }
            return@Column
        }

        val needsYou = Predicates.needsYouCount(data)
        val agentCards = Predicates.agentCards(data)
        val streaksEnabled = state.view.settings.streaksEnabled

        TwoPane(
            expanded = expanded,
            modifier = Modifier.fillMaxSize(),
            primary = {
                LazyColumn(
                    modifier = Modifier.fillMaxSize(),
                    contentPadding = androidx.compose.foundation.layout.PaddingValues(
                        start = Spacing.lg,
                        end = Spacing.lg,
                        top = Spacing.sm,
                        bottom = Spacing.xxxl,
                    ),
                    verticalArrangement = Arrangement.spacedBy(Spacing.md),
                ) {
                    item(key = "activity") {
                        ActivityLine(
                            session = data.activeSession,
                            onStart = onStartSessionPicker,
                            onStop = onStopSession,
                        )
                    }

                    item(key = "meter") {
                        MeterBlock(data = data, onOpenDetail = onOpenMeterDetail)
                    }

                    item(key = "pulse") {
                        PulseBlock(pulse = data.pulse, explanation = data.pulseExplanation)
                    }

                    /*
                     * The one list. Already merged, already ordered, applied
                     * into the epoch so nothing moves. **Do not re-split it**
                     * into habits/tasks or Today/Anytime — `data.anytime` is a
                     * convenience subset, not a second section on this screen.
                     */
                    items(state.agenda, key = { it.id }) { item ->
                        AgendaCard(
                            item = item,
                            habit = Predicates.habitFor(data, item),
                            pending = item.refId in (state.view.pendingTargets),
                            streaksEnabled = streaksEnabled,
                            onTick = { onTick(item) },
                            onOpen = { onOpenItem(item) },
                        )
                    }

                    if (state.agenda.isEmpty()) {
                        item(key = "empty") {
                            Text(
                                text = "Nothing on today. Ask your agent to set up some habits.",
                                style = LifeOsType.body,
                                color = p.muted,
                            )
                        }
                    }

                    // One column: the agent's reading of the day comes after
                    // the day, never before.
                    if (!expanded) {
                        agentSection(
                            scope = this,
                            needsYou = needsYou,
                            agentCards = agentCards,
                            onOpenNeedsYou = onOpenNeedsYou,
                        )
                    }
                }
            },
            secondary = {
                if (expanded) {
                    LazyColumn(
                        modifier = Modifier.fillMaxSize(),
                        contentPadding = androidx.compose.foundation.layout.PaddingValues(
                            end = Spacing.lg,
                            top = Spacing.sm,
                            bottom = Spacing.xxxl,
                        ),
                        verticalArrangement = Arrangement.spacedBy(Spacing.md),
                    ) {
                        agentSection(
                            scope = this,
                            needsYou = needsYou,
                            agentCards = agentCards,
                            onOpenNeedsYou = onOpenNeedsYou,
                        )
                    }
                }
            },
        )
    }
}

/**
 * The agent's half of Today: the Needs-you link and the two pinned cards.
 *
 * One function, called from either column, so the two layouts cannot drift into
 * showing different things.
 */
private fun agentSection(
    scope: androidx.compose.foundation.lazy.LazyListScope,
    needsYou: Int,
    agentCards: List<com.lifeos.app.data.api.TaskDto>,
    onOpenNeedsYou: () -> Unit,
) {
    if (needsYou > 0) {
        scope.item(key = "needs-you") {
            val p = palette
            // The count and Day's list come from the same predicate, so this
            // link can never point at a page that renders nothing.
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(Radii.card))
                    .clickable(onClick = onOpenNeedsYou)
                    .padding(vertical = Spacing.md),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text("Needs you", style = LifeOsType.cardTitle, color = p.text)
                Mono(" · $needsYou", color = p.accent)
                Box(Modifier.weight(1f))
                Text("›", style = LifeOsType.cardTitle, color = p.muted)
            }
        }
    }

    if (agentCards.isNotEmpty()) {
        scope.item(key = "agent-header") { SectionHeader("From your agent") }
        scope.items(agentCards, key = { "agent-${it.id}" }) { task ->
            AgentCard(title = task.title, subtitle = task.subtitle, emoji = task.emoji)
        }
    }
}

@Composable
private fun MeterBlock(data: DashboardTodayDto, onOpenDetail: () -> Unit) {
    val p = palette

    // One petal per active habit, in a stable order, so the figure is a picture
    // of *your* habits rather than a generic gauge.
    val petals = data.habits
        .filter { it.active }
        .map { PetalInput(it.id, it.completedToday, it.themeColor) }

    val history = data.consistency7.map { it.pct }

    Column(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(Radii.card))
            .clickable(onClick = onOpenDetail)
            .padding(vertical = Spacing.sm),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        GrowthMeter(
            efficiencyPct = data.progress.efficiencyPct,
            dailyXp = data.progress.dailyXp,
            dailyXpTarget = data.progress.dailyXpTarget,
            style = GrowthStyle.from(data.progress.growthStyle),
            habits = petals,
            consistencyHistory = history,
            modifier = Modifier.fillMaxWidth().height(Sizes.meter),
        )
        // Keeps the petal colours honest: a malformed themeColor falls back to
        // the accent rather than drawing nothing.
        if (petals.isNotEmpty() && petals.all { serverColor(it.colorHex) == null }) {
            Mono("", color = p.faint)
        }
    }
}

/**
 * The pulse (§4.2): the word, then one sentence.
 *
 * Never accompanied by a number that contradicts it — which is exactly why
 * `improvementPct` is not next to it but one tap deep, behind the meter.
 */
@Composable
private fun PulseBlock(pulse: String, explanation: String) {
    val p = palette
    val colour = when (pulse) {
        "Improving" -> POSITIVE
        "Recovering" -> WARNING
        "Drifting" -> NEUTRAL_NEG
        else -> p.accent // Stable
    }
    Column(horizontalAlignment = Alignment.CenterHorizontally, modifier = Modifier.fillMaxWidth()) {
        Text(pulse, style = LifeOsType.pulse, color = colour)
        if (explanation.isNotBlank()) {
            Text(
                text = explanation,
                style = LifeOsType.bodySmall,
                color = p.muted,
                // Clamped to two lines with no "more" affordance. The sentence
                // is a mood, not a document.
                maxLines = 2,
                overflow = TextOverflow.Ellipsis,
            )
        }
    }
}

@Composable
private fun AgentCard(title: String, subtitle: String?, emoji: String?) {
    val p = palette
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(Radii.card))
            .background(p.surface)
            .padding(Spacing.lg),
        verticalArrangement = Arrangement.spacedBy(Spacing.xs),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            if (!emoji.isNullOrBlank()) {
                Text(emoji, modifier = Modifier.padding(end = Spacing.sm))
            }
            Text(title, style = LifeOsType.cardTitle, color = p.text)
        }
        if (!subtitle.isNullOrBlank()) {
            Text(subtitle, style = LifeOsType.bodySmall, color = p.muted)
        }
        // No `svg` rendering in this milestone: agent SVG is untrusted and must
        // be sandboxed, which is a later milestone's job. Drawing it unsandboxed
        // to look complete would be the wrong trade.
    }
}

private fun failureDetail(state: ConnectionState?): String? = when (state) {
    is ConnectionState.Unreachable -> state.detail
    is ConnectionState.Stale -> "The last ${state.failures} attempts failed."
    ConnectionState.Unauthorized -> "The server did not accept this token."
    else -> null
}
