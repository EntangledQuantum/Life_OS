package com.lifeos.app.ui.you

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.lifeos.app.data.api.AgentPropertyDto
import com.lifeos.app.data.api.DeltaDto
import com.lifeos.app.data.api.GoalDto
import com.lifeos.app.data.api.SettingsDto
import com.lifeos.app.domain.AnalyticsModel
import com.lifeos.app.domain.AnalyticsRange
import com.lifeos.app.domain.Art
import com.lifeos.app.domain.GoalOrder
import com.lifeos.app.ui.AnalyticsState
import com.lifeos.app.ui.TodayUiState
import com.lifeos.app.ui.art.ArtBackground
import com.lifeos.app.ui.art.ArtIcon
import com.lifeos.app.ui.components.AreaChart
import com.lifeos.app.ui.components.ErrorPanel
import com.lifeos.app.ui.components.Mono
import com.lifeos.app.ui.components.PageBody
import com.lifeos.app.ui.components.SectionHeader
import com.lifeos.app.ui.components.SkeletonBlock
import com.lifeos.app.ui.components.ThinTrack
import com.lifeos.app.ui.theme.serverColor
import com.lifeos.app.ui.theme.LifeOsType
import com.lifeos.app.ui.theme.NEUTRAL_NEG
import com.lifeos.app.ui.theme.POSITIVE
import com.lifeos.app.ui.theme.Radii
import com.lifeos.app.ui.theme.Sizes
import com.lifeos.app.ui.theme.Spacing
import com.lifeos.app.ui.theme.arrivalAlpha
import com.lifeos.app.ui.theme.craftedSurface
import com.lifeos.app.ui.theme.lifted
import com.lifeos.app.ui.theme.palette
import com.lifeos.app.ui.theme.pressTone

/**
 * You (§3.3): goals above, the past tense of Today below.
 *
 * Two halves answering one question — *am I going anywhere*. The upper half is
 * the long game; the lower half is Analytics, folded in, because Analytics and
 * Today were showing the same four quantities at two zoom levels and that is
 * how the app came to feel like a dashboard.
 *
 * **There is no create-goal button, anywhere, ever.** Goals come from the agent.
 * This screen is for reading: no FAB, no primary action.
 */
@Composable
fun YouScreen(
    state: TodayUiState,
    analytics: AnalyticsState,
    refreshLineVisible: Boolean,
    emptyCacheTimedOut: Boolean,
    address: String?,
    onToggleAnalytics: () -> Unit,
    onSelectRange: (AnalyticsRange) -> Unit,
    onRetry: () -> Unit,
    onChangeServer: () -> Unit,
    onArmEmptyTimeout: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val data = state.view?.data
    val settings = state.view?.settings ?: SettingsDto()
    val p = palette

    /*
     * Loading → loaded as a fade, not a cut. Read above the empty-cache branch
     * or the animation is created already at its target and never runs; see
     * `arrivalAlpha`.
     */
    val arrival = arrivalAlpha(ready = data != null)

    LaunchedEffect(data == null) {
        if (data == null) onArmEmptyTimeout()
    }

    Column(modifier = modifier.fillMaxSize()) {
        if (refreshLineVisible) {
            LinearProgressIndicator(
                modifier = Modifier.fillMaxWidth().height(2.dp),
                color = p.accent,
                trackColor = p.surface,
            )
        }

        if (data == null) {
            PageBody(modifier = Modifier.padding(Spacing.lg)) {
                if (emptyCacheTimedOut) {
                    ErrorPanel(
                        waitingFor = "Waiting for your goals",
                        serverMessage = null,
                        address = address,
                        onRetry = onRetry,
                        onChangeServer = onChangeServer,
                    )
                } else {
                    SkeletonBlock(120)
                    SkeletonBlock(88)
                    SkeletonBlock(140)
                }
            }
            return@Column
        }

        val goals = remember(data.goals) { GoalOrder.forYou(data.goals) }

        LazyColumn(
            modifier = Modifier.fillMaxSize().graphicsLayer { alpha = arrival },
            contentPadding = PaddingValues(
                start = Spacing.lg,
                end = Spacing.lg,
                top = Spacing.sm,
                bottom = Spacing.xxxl,
            ),
            verticalArrangement = Arrangement.spacedBy(Spacing.md),
        ) {
            /* ---- the upper half: goals, read-only ---- */

            if (goals.isEmpty()) {
                item(key = "no-goals") {
                    Text(
                        text = "No goals yet. Goals come from your agent — ask it what you " +
                            "should be aiming at.",
                        style = LifeOsType.body,
                        color = p.muted,
                    )
                }
            }

            goals.forEachIndexed { index, goal ->
                item(key = "goal-${goal.id}") {
                    // The goal nearest completion is first and rendered larger:
                    // it is the one thing on the screen.
                    GoalCard(goal = goal, lead = index == 0)
                }
            }

            /* ---- the lower half: the past tense of Today ---- */

            item(key = "analytics") {
                AnalyticsBlock(
                    state = analytics,
                    snapshotXp = data.xpSeries7,
                    snapshotConsistency = data.consistency7,
                    onToggle = onToggleAnalytics,
                    onSelectRange = onSelectRange,
                )
            }

            item(key = "vs-yesterday") {
                VsYesterdayBlock(data = data)
            }

            /* ---- collapsed below, each hidden when its flag is off ---- */

            if (settings.achievementsEnabled && data.achievements.isNotEmpty()) {
                item(key = "achievements") {
                    Collapsible("Achievements · ${data.achievements.count { it.unlockedAt != null }}") {
                        data.achievements.forEach { achievement ->
                            Row(
                                modifier = Modifier.fillMaxWidth().padding(vertical = Spacing.xs),
                                horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
                            ) {
                                Text(achievement.emoji.ifBlank { "•" })
                                Column(modifier = Modifier.weight(1f)) {
                                    Text(
                                        text = achievement.title,
                                        style = LifeOsType.bodySmall,
                                        color = if (achievement.unlockedAt != null) p.text else p.faint,
                                    )
                                    if (achievement.description.isNotBlank()) {
                                        Text(
                                            text = achievement.description,
                                            style = LifeOsType.bodySmall,
                                            color = p.faint,
                                            maxLines = 2,
                                            overflow = TextOverflow.Ellipsis,
                                        )
                                    }
                                }
                                if (achievement.unlockedAt != null) {
                                    Mono("✓", color = p.positive)
                                }
                            }
                        }
                    }
                }
            }

            if (settings.questsEnabled && data.quests.isNotEmpty()) {
                item(key = "quests") {
                    Collapsible("Quests · ${data.quests.size}") {
                        data.quests.forEach { quest ->
                            Column(
                                modifier = Modifier.fillMaxWidth().padding(vertical = Spacing.xs),
                                verticalArrangement = Arrangement.spacedBy(Spacing.xs),
                            ) {
                                Row(verticalAlignment = Alignment.CenterVertically) {
                                    Text(
                                        text = quest.title,
                                        style = LifeOsType.bodySmall,
                                        color = p.text,
                                        modifier = Modifier.weight(1f),
                                    )
                                    Mono(
                                        "${quest.progressCount}/${quest.targetCount}",
                                        color = p.muted,
                                    )
                                }
                                ThinTrack(
                                    fraction = if (quest.targetCount > 0) {
                                        quest.progressCount.toFloat() / quest.targetCount
                                    } else {
                                        0f
                                    },
                                )
                            }
                        }
                    }
                }
            }

            if (data.properties.isNotEmpty()) {
                item(key = "properties") {
                    Collapsible("Properties · ${data.properties.size}") {
                        data.properties.forEach { property -> PropertyRow(property) }
                        // Lifetime XP may appear once, small, in this block and
                        // nowhere else: it changes no decision, so it is never a
                        // headline.
                        Row(modifier = Modifier.fillMaxWidth().padding(top = Spacing.sm)) {
                            Text(
                                text = "Lifetime XP",
                                style = LifeOsType.bodySmall,
                                color = p.faint,
                                modifier = Modifier.weight(1f),
                            )
                            Mono("${data.progress.totalXp}", color = p.faint, style = LifeOsType.mono11)
                        }
                    }
                }
            }
        }
    }
}

/**
 * A goal: its art or its emoji, the title, `progressPct` as a thin determinate
 * track, and the rarity ladder's rungs where tiers exist.
 *
 * A goal card and a habit card are deliberately the same shape — the same two
 * art slots, the same dimensions, the same scrim — so one picture works in
 * either place and an agent has one set of numbers to remember rather than two.
 *
 * Read-only, and that is a product decision rather than a missing feature: a
 * goal-editing UI moves the designing work back onto the user, which is the
 * executive-function tax this product exists to remove.
 */
@Composable
private fun GoalCard(goal: GoalDto, lead: Boolean) {
    val p = palette
    val accent = serverColor(goal.themeColor) ?: p.accent
    val rungs = remember(goal) { GoalOrder.rungs(goal) }
    val achieved = goal.status == "achieved"
    val art = remember(goal) { Art.of(goal) }
    val shape = RoundedCornerShape(Radii.card)

    Box(
        modifier = Modifier
            .fillMaxWidth()
            // The lead goal is the one thing on this screen, so it keeps its
            // louder border; both get the lit top edge, because a goal card
            // with nothing behind its outline is the flattest thing in the app.
            .craftedSurface(
                shape = shape,
                base = p.surface,
                border = accent.copy(alpha = if (lead) 0.32f else 0.14f),
                pressShrink = false,
            ),
    ) {
        ArtBackground(art = art, modifier = Modifier.matchParentSize())

        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(if (lead) Spacing.xl else Spacing.lg),
            verticalArrangement = Arrangement.spacedBy(Spacing.sm),
        ) {
        Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(Spacing.md),
        ) {
            /*
             * The picture if there is one, otherwise the bare emoji — not the
             * emoji in a tinted tile. A goal with no art has to look exactly as
             * it did before any of this existed, and giving it a square it never
             * had would make "no art" a visibly second-rate state. The tile
             * belongs to the picture, not to the slot.
             */
            val emoji: @Composable () -> Unit = {
                Text(
                    text = goal.emoji.ifBlank { "◆" },
                    style = if (lead) LifeOsType.pulse else LifeOsType.screenTitle,
                )
            }
            if (art.icon == null) {
                emoji()
            } else {
                ArtIcon(
                    picture = art.icon,
                    size = if (lead) Sizes.goalIconLead else Sizes.goalIcon,
                    tint = accent.copy(alpha = 0.14f),
                    fallback = emoji,
                )
            }
            Column(modifier = Modifier.weight(1f)) {
                goal.currentTier?.label?.takeIf { it.isNotBlank() }?.let {
                    // The rung already reached, named in the agent's own word.
                    Text(it.uppercase(), style = LifeOsType.label, color = accent)
                }
                Text(
                    text = goal.title,
                    style = if (lead) LifeOsType.screenTitle else LifeOsType.cardTitle,
                    color = p.text,
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis,
                )
            }
            Mono(
                text = "${Math.round(goal.progressPct)}%",
                color = if (achieved) p.positive else p.muted,
                style = if (lead) LifeOsType.mono16 else LifeOsType.mono13,
            )
        }

        ThinTrack(
            fraction = (goal.progressPct / 100.0).toFloat(),
            colour = if (achieved) p.positive else accent,
        )

        if (lead && !goal.whyItMatters.isNullOrBlank()) {
            Text(
                text = goal.whyItMatters,
                style = LifeOsType.bodySmall,
                color = p.muted,
                maxLines = 3,
                overflow = TextOverflow.Ellipsis,
            )
        }

        if (rungs.isNotEmpty()) {
            RarityLadder(rungs = rungs, accent = accent)
        }
        }
    }
}

/**
 * The rarity ladder: one rung per tier, bottom first.
 *
 * Reached rungs are filled; the one being worked toward is outlined in the
 * accent; the rest are faint. **No leaderboard and no rank** — the only
 * comparison in this app is you versus yesterday, and a tier is the same goal
 * at a different height, not a position among other people.
 */
/** Reached or not, when a rung brought no picture of its own. */
@Composable
private fun RungDot(reached: Boolean, accent: Color) {
    val p = palette
    Box(
        modifier = Modifier
            .size(6.dp)
            .clip(RoundedCornerShape(50))
            .background(if (reached) accent else p.faint),
    )
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun RarityLadder(rungs: List<GoalOrder.Rung>, accent: Color) {
    val p = palette
    FlowRow(
        modifier = Modifier.fillMaxWidth().padding(top = Spacing.xs),
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
        verticalArrangement = Arrangement.spacedBy(Spacing.xs),
    ) {
        rungs.forEach { rung ->
            Row(
                modifier = Modifier
                    .clip(RoundedCornerShape(Radii.tile))
                    .background(if (rung.reached) accent.copy(alpha = 0.18f) else p.surface2)
                    .border(
                        width = if (rung.isNext) 1.dp else 0.dp,
                        color = if (rung.isNext) accent.copy(alpha = 0.55f) else Color.Transparent,
                        shape = RoundedCornerShape(Radii.tile),
                    )
                    .padding(horizontal = Spacing.sm, vertical = Spacing.xs),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
            ) {
                /*
                 * A rung's own picture where it has one, else the dot. Rarity
                 * is supposed to be recognisable at a glance, and a tier that
                 * was given its own art is saying what that glance should land
                 * on; the dot only ever said "reached" or "not".
                 */
                if (rung.icon != null) {
                    ArtIcon(
                        picture = rung.icon,
                        size = Sizes.rungIcon,
                        tint = accent.copy(alpha = 0.18f),
                        fallback = { RungDot(reached = rung.reached, accent = accent) },
                    )
                } else {
                    RungDot(reached = rung.reached, accent = accent)
                }
                Text(
                    text = rung.label.ifBlank { "Tier ${rung.rank}" },
                    style = LifeOsType.label,
                    color = if (rung.reached) p.text else p.faint,
                )
                if (rung.isNext) {
                    Mono("${Math.round(rung.progressPct)}%", color = accent, style = LifeOsType.mono11)
                }
            }
        }
    }
}

/**
 * Last 7 days, and the range control (§3.3).
 *
 * **Collapsed by default to the 7-day XP chart.** `7d` is drawn from the
 * dashboard snapshot, so it is there offline and costs no request; 30d, 90d and
 * all are one `GET /api/v1/analytics` each, made when asked and never polled.
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun AnalyticsBlock(
    state: AnalyticsState,
    snapshotXp: List<com.lifeos.app.data.api.SeriesPointDto>,
    snapshotConsistency: List<com.lifeos.app.data.api.ConsistencyPointDto>,
    onToggle: () -> Unit,
    onSelectRange: (AnalyticsRange) -> Unit,
) {
    val p = palette

    val xp = remember(state, snapshotXp) {
        if (state.range.fromSnapshot) {
            AnalyticsModel.fromSnapshot(snapshotXp)
        } else {
            state.payload?.let { AnalyticsModel.xp(it) }
                ?: AnalyticsModel.fromSnapshot(emptyList())
        }
    }
    val consistency = remember(state, snapshotConsistency) {
        if (state.range.fromSnapshot) {
            AnalyticsModel.consistencyFromSnapshot(snapshotConsistency)
        } else {
            state.payload?.let { AnalyticsModel.consistency(it) }
                ?: AnalyticsModel.consistencyFromSnapshot(emptyList())
        }
    }

    Column(
        modifier = Modifier
            .fillMaxWidth()
            .craftedSurface(shape = RoundedCornerShape(Radii.card), pressShrink = false)
            .padding(Spacing.lg),
        verticalArrangement = Arrangement.spacedBy(Spacing.md),
    ) {
        Row(
            modifier = Modifier.fillMaxWidth().clickable(onClick = onToggle),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(
                text = if (state.range == AnalyticsRange.D7) {
                    "Last 7 days"
                } else {
                    "Last ${state.range.label}"
                },
                style = LifeOsType.cardTitle,
                color = p.text,
                modifier = Modifier.weight(1f),
            )
            Text(if (state.expanded) "−" else "+", style = LifeOsType.cardTitle, color = p.muted)
        }

        // XP against its dashed target, always — this is the collapsed state.
        AreaChart(series = xp, height = 120.dp)

        /*
         * The target as a figure, under the line that draws it.
         *
         * The chart's domain is sized to the data rather than to the target
         * (see `AnalyticsModel.series`), so on a quiet day the target can be
         * above the top of the box. When it is, the dashed line is pinned to
         * the ceiling and this line says so — the caption is the other half of
         * the clamp, not decoration.
         */
        if (xp.target > 0.0) {
            Mono(
                text = if (xp.targetOffScale) {
                    "target ${Math.round(xp.target)} XP · above this chart"
                } else {
                    "target ${Math.round(xp.target)} XP"
                },
                color = p.faint,
                style = LifeOsType.mono11,
            )
        }

        if (state.loading) {
            Mono("loading ${state.range.label}…", color = p.faint, style = LifeOsType.mono11)
        }
        state.error?.let {
            // Reported in place. A failed range does not take the screen down,
            // and it is not a connection state.
            Text(
                text = "Couldn't load ${state.range.label}: $it",
                style = LifeOsType.bodySmall,
                color = p.warning,
            )
        }

        if (state.expanded) {
            FlowRow(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
            ) {
                AnalyticsRange.entries.forEach { range ->
                    RangeChip(
                        range = range,
                        selected = range == state.range,
                        onClick = { onSelectRange(range) },
                    )
                }
            }

            SectionHeader("Consistency")
            AreaChart(
                series = consistency,
                height = 72.dp,
                line = p.accent2,
                fill = p.accent2,
            )

            state.payload?.let { payload ->
                Row(modifier = Modifier.fillMaxWidth()) {
                    Column(modifier = Modifier.weight(1f)) {
                        SectionHeader("Adherence")
                        Mono(
                            "${Math.round(payload.adherence.ratePct)}% · " +
                                "${payload.adherence.completed}/${payload.adherence.scheduled}",
                            color = p.text,
                            style = LifeOsType.mono13,
                        )
                    }
                    Column(modifier = Modifier.weight(1f)) {
                        SectionHeader("Study")
                        Mono(
                            "${Math.round(payload.study.totalMinutes)}m · " +
                                "${payload.study.sessions} sessions",
                            color = p.text,
                            style = LifeOsType.mono13,
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun RangeChip(range: AnalyticsRange, selected: Boolean, onClick: () -> Unit) {
    val p = palette
    Box(
        modifier = Modifier
            .clip(RoundedCornerShape(Radii.tile))
            .background(if (selected) p.accent.copy(alpha = 0.18f) else p.surface2)
            .clickable(onClick = onClick)
            .padding(horizontal = Spacing.md, vertical = Spacing.sm),
    ) {
        Text(
            text = range.label,
            style = LifeOsType.label,
            color = if (selected) p.accent else p.muted,
        )
    }
}

/**
 * Vs. yesterday: the five figures, `today` large and `delta` small and signed.
 *
 * Positive deltas green, negative **grey**. Nothing is ever red for a bad day —
 * a bad day is not an error state, and this is an app for people who already
 * punish themselves enough.
 */
@Composable
private fun VsYesterdayBlock(data: com.lifeos.app.data.api.DashboardTodayDto) {
    val vs = data.vsYesterday
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
        SectionHeader("Vs. yesterday")
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
        ) {
            DeltaTile("Habits", vs.habitsCompleted, Modifier.weight(1f))
            DeltaTile("XP", vs.xpEarned, Modifier.weight(1f))
            DeltaTile("Eff.", vs.efficiency, Modifier.weight(1f))
        }
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
        ) {
            DeltaTile("Study", vs.studyMinutes, Modifier.weight(1f))
            DeltaTile("Sleep", vs.sleepScore, Modifier.weight(1f))
            Box(Modifier.weight(1f))
        }
    }
}

@Composable
fun DeltaTile(label: String, delta: DeltaDto, modifier: Modifier = Modifier) {
    val p = palette
    val value = delta.today
    val change = delta.delta
    Column(
        modifier = modifier
            .craftedSurface(
                shape = RoundedCornerShape(Radii.tile),
                // A tile is small, so its border would be most of what you see
                // of it. Tone alone separates these five from the page.
                border = null,
                pressShrink = false,
            )
            .padding(Spacing.md),
        verticalArrangement = Arrangement.spacedBy(2.dp),
    ) {
        Text(label, style = LifeOsType.label, color = p.faint)
        Mono(
            text = value?.let { "${Math.round(it)}" } ?: "—",
            color = p.text,
            style = LifeOsType.mono16,
        )
        Mono(
            text = AnalyticsModel.signed(change),
            // Green up, grey down. Never red.
            color = when {
                change == null -> p.faint
                change > 0 -> POSITIVE
                change < 0 -> NEUTRAL_NEG
                else -> p.faint
            },
            style = LifeOsType.mono11,
        )
    }
}

@Composable
private fun PropertyRow(property: AgentPropertyDto) {
    val p = palette
    Row(
        modifier = Modifier.fillMaxWidth().padding(vertical = Spacing.xs),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(
            text = property.label.ifBlank { property.key },
            style = LifeOsType.bodySmall,
            color = p.text,
            modifier = Modifier.weight(1f),
        )
        Mono(
            text = buildString {
                append(property.value?.let { formatNumber(it) } ?: property.textValue ?: "—")
                property.unit?.takeIf { it.isNotBlank() }?.let { append(" $it") }
            },
            color = p.muted,
            style = LifeOsType.mono13,
        )
    }
}

private fun formatNumber(value: Double): String =
    if (value == Math.floor(value) && !value.isInfinite()) "${value.toLong()}" else "%.1f".format(value)

/**
 * A header with everything behind it (§3.3.4).
 *
 * Collapsed by default: the three blocks below the analytics are a read, not a
 * screen, and five units above the fold is the budget.
 */
@Composable
private fun Collapsible(title: String, content: @Composable () -> Unit) {
    val p = palette
    var open by rememberSaveable(title) { mutableStateOf(false) }
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .craftedSurface(shape = RoundedCornerShape(Radii.card), pressShrink = false)
            .padding(Spacing.lg),
        verticalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        Row(
            modifier = Modifier.fillMaxWidth().clickable { open = !open },
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(
                text = title,
                style = LifeOsType.cardTitle,
                color = p.text,
                modifier = Modifier.weight(1f),
            )
            Text(if (open) "−" else "+", style = LifeOsType.cardTitle, color = p.muted)
        }
        if (open) content()
    }
}
