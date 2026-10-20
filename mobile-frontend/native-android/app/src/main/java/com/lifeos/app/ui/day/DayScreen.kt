package com.lifeos.app.ui.day

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material3.ExtendedFloatingActionButton
import androidx.compose.material3.Icon
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.lifeos.app.data.api.SettingsDto
import com.lifeos.app.data.api.TaskDto
import com.lifeos.app.domain.DayBucket
import com.lifeos.app.domain.DayBuckets
import com.lifeos.app.domain.PlannedDay
import com.lifeos.app.domain.Predicates
import com.lifeos.app.ui.TodayUiState
import com.lifeos.app.ui.components.ErrorPanel
import com.lifeos.app.ui.components.Mono
import com.lifeos.app.ui.components.PageBody
import com.lifeos.app.ui.components.SectionHeader
import com.lifeos.app.ui.components.SkeletonBlock
import com.lifeos.app.ui.components.TwoPane
import com.lifeos.app.ui.components.pulseBorder
import com.lifeos.app.ui.theme.ActivityColors
import com.lifeos.app.ui.theme.LifeOsType
import com.lifeos.app.ui.theme.Radii
import com.lifeos.app.ui.theme.Sizes
import com.lifeos.app.ui.theme.Spacing
import com.lifeos.app.ui.theme.palette
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter

/**
 * Day (§3.2): the ribbon, the agent's queue, and everything that has a time on
 * it but is not happening now.
 *
 * **Scheduled things never start.** There is no Start button on any row here, no
 * timer and no running state — a task has a target time and a done flag, and
 * completing one does not touch the activity session. The only running thing in
 * the app is the manually-set session on Today.
 *
 * Rows are **list rows, not cards**: 56dp, a 3dp activity rule, time in mono.
 * Deliberately lighter than an agenda card, because this is reading, not doing.
 */
@Composable
fun DayScreen(
    state: TodayUiState,
    refreshLineVisible: Boolean,
    emptyCacheTimedOut: Boolean,
    address: String?,
    expanded: Boolean,
    onOpenTask: (TaskDto) -> Unit,
    onCompleteTask: (String) -> Unit,
    onDismissTask: (String) -> Unit,
    onLogStudy: () -> Unit,
    onRetry: () -> Unit,
    onChangeServer: () -> Unit,
    onArmEmptyTimeout: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val data = state.view?.data
    val settings = state.view?.settings ?: SettingsDto()
    val p = palette

    LaunchedEffect(data == null) {
        if (data == null) onArmEmptyTimeout()
    }

    Box(modifier = modifier.fillMaxSize()) {
        Column(modifier = Modifier.fillMaxSize()) {
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
                            waitingFor = "Waiting for the day",
                            serverMessage = null,
                            address = address,
                            onRetry = onRetry,
                            onChangeServer = onChangeServer,
                        )
                    } else {
                        SkeletonBlock(Sizes.ribbon.value.toInt())
                        SkeletonBlock(Sizes.dayRow.value.toInt())
                        SkeletonBlock(Sizes.dayRow.value.toInt())
                    }
                }
                return@Column
            }

            // One split, so the count and the two lists cannot disagree.
            val partition = remember(data) { Predicates.dayPartition(data) }
            val buckets = remember(data) { DayBuckets.of(data) }

            /*
             * The ribbon still draws on an empty day: the planned sleep/wake
             * times give it shape, because the day has a shape before anything
             * is on it.
             */
            val blocks = remember(data, settings) {
                data.timeline.ifEmpty {
                    PlannedDay.shape(settings.plannedWake, settings.plannedSleepStart)
                }
            }

            TwoPane(
                expanded = expanded,
                modifier = Modifier.fillMaxSize(),
                primary = {
                    LazyColumn(
                        modifier = Modifier.fillMaxSize(),
                        contentPadding = PaddingValues(
                            start = Spacing.lg,
                            end = Spacing.lg,
                            top = Spacing.sm,
                            // Clear of the FAB.
                            bottom = 96.dp,
                        ),
                        verticalArrangement = Arrangement.spacedBy(Spacing.md),
                    ) {
                        item(key = "ribbon") {
                            DayRibbon(blocks = blocks, timezone = data.lifeDay.timezone)
                        }
                        item(key = "legend") { RibbonLegend(blocks = blocks) }

                        if (!expanded) {
                            // One column: the agent's queue comes after the day.
                            needsYouBlock(
                                scope = this,
                                tasks = partition.needsYou,
                                onOpen = onOpenTask,
                                onComplete = onCompleteTask,
                                onDismiss = onDismissTask,
                            )
                        }

                        if (buckets.isEmpty()) {
                            item(key = "empty") {
                                Text(
                                    text = "Nothing scheduled. Your agent will put things here.",
                                    style = LifeOsType.body,
                                    color = p.muted,
                                )
                            }
                        }

                        buckets.forEach { bucket ->
                            item(key = "head-${bucket.label}") {
                                BucketHeader(bucket = bucket)
                            }
                            bucket.tasks.forEach { task ->
                                item(key = "task-${task.id}") {
                                    DayRow(
                                        task = task,
                                        timezone = data.lifeDay.timezone,
                                        onOpen = { onOpenTask(task) },
                                    )
                                }
                            }
                        }
                    }
                },
                secondary = {
                    if (expanded) {
                        LazyColumn(
                            modifier = Modifier.fillMaxHeight(),
                            contentPadding = PaddingValues(
                                end = Spacing.lg,
                                top = Spacing.sm,
                                bottom = 96.dp,
                            ),
                            verticalArrangement = Arrangement.spacedBy(Spacing.md),
                        ) {
                            needsYouBlock(
                                scope = this,
                                tasks = partition.needsYou,
                                onOpen = onOpenTask,
                                onComplete = onCompleteTask,
                                onDismiss = onDismissTask,
                            )
                        }
                    }
                },
            )
        }

        /*
         * The primary action: Log study. The one write that is genuinely the
         * user's and has no row to hang off. The FAB is chrome, so it does not
         * animate on scroll, on navigation or on data arriving.
         */
        ExtendedFloatingActionButton(
            onClick = onLogStudy,
            containerColor = p.accent,
            contentColor = p.bg,
            modifier = Modifier
                .align(Alignment.BottomEnd)
                .padding(Spacing.lg),
        ) {
            Icon(Icons.Filled.Add, contentDescription = null)
            Text("Log study", style = LifeOsType.label, modifier = Modifier.padding(start = Spacing.sm))
        }
    }
}

/**
 * **Needs you** (§3.2.2) — open reviews plus anything the agent queued with no
 * time, where [divergence 1] lands.
 *
 * The block pulses as a block until it is empty; its rows do not pulse
 * individually, because there is never more than one pulsing region on a screen.
 *
 * The list is [Predicates.dayPartition]'s `needsYou`, which is the same function
 * Today's "Needs you · N" counts. A count and the list it counts come from one
 * place, or the bug is already written.
 */
private fun needsYouBlock(
    scope: androidx.compose.foundation.lazy.LazyListScope,
    tasks: List<TaskDto>,
    onOpen: (TaskDto) -> Unit,
    onComplete: (String) -> Unit,
    onDismiss: (String) -> Unit,
) {
    if (tasks.isEmpty()) return
    scope.item(key = "needs-you") {
        NeedsYouBlock(
            tasks = tasks,
            onOpen = onOpen,
            onComplete = onComplete,
            onDismiss = onDismiss,
        )
    }
}

@Composable
private fun NeedsYouBlock(
    tasks: List<TaskDto>,
    onOpen: (TaskDto) -> Unit,
    onComplete: (String) -> Unit,
    onDismiss: (String) -> Unit,
) {
    val p = palette
    val shape = RoundedCornerShape(Radii.card)
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .clip(shape)
            .background(p.surface)
            .pulseBorder(p.accent, shape)
            .padding(Spacing.md),
        verticalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text("Needs you", style = LifeOsType.cardTitle, color = p.text)
            Mono(" · ${tasks.size}", color = p.accent)
        }
        tasks.forEach { task ->
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .heightIn(min = Sizes.dayRow)
                    .clip(RoundedCornerShape(Radii.tile))
                    .clickable(role = Role.Button) { onOpen(task) },
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
            ) {
                Text("◦", style = LifeOsType.body, color = p.faint)
                Column(modifier = Modifier.weight(1f)) {
                    Text(
                        text = task.title,
                        style = LifeOsType.body,
                        color = p.text,
                        maxLines = 2,
                        overflow = TextOverflow.Ellipsis,
                    )
                    if (!task.subtitle.isNullOrBlank()) {
                        Text(
                            text = task.subtitle,
                            style = LifeOsType.bodySmall,
                            color = p.muted,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                        )
                    }
                }
                // Complete and dismiss. No Start: nothing the agent scheduled
                // ever starts.
                GlyphButton("✓", p.positive) { onComplete(task.id) }
                GlyphButton("✕", p.muted) { onDismiss(task.id) }
            }
        }
    }
}

@Composable
private fun GlyphButton(glyph: String, tint: Color, onClick: () -> Unit) {
    Box(
        modifier = Modifier
            .size(Sizes.tickTouch)
            .clip(RoundedCornerShape(50))
            .clickable(role = Role.Button, onClick = onClick),
        contentAlignment = Alignment.Center,
    ) {
        Text(glyph, style = LifeOsType.cardTitle, color = tint)
    }
}

@Composable
private fun BucketHeader(bucket: DayBucket) {
    Row(
        modifier = Modifier.fillMaxWidth().padding(top = Spacing.sm),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        SectionHeader(bucket.label)
        Box(Modifier.weight(1f))
        Mono(" ${bucket.tasks.size}", color = palette.faint, style = LifeOsType.mono11)
    }
}

/**
 * One scheduled thing: 56dp, the time in mono, the title, the duration, the XP
 * as green text, a repeat badge and a bell.
 *
 * **No colour bar.** The 3px activity strip that used to lead this row is gone,
 * for the reason `mobile-frontend/app/AGENTS.md` gives and the agenda card now
 * obeys: at that width it reads as a divider between two rows rather than as a
 * mark on one. The row's own outline carries the activity colour instead.
 *
 * No tick: ticking belongs to Today, where the day is. Tapping opens the sheet,
 * which is where completing a planned thing lives.
 */
@Composable
private fun DayRow(task: TaskDto, timezone: String?, onOpen: () -> Unit) {
    val p = palette
    val activity = ActivityColors.of(task.activityTag, p.accent)
    val shape = RoundedCornerShape(Radii.tile)

    Row(
        modifier = Modifier
            .fillMaxWidth()
            .heightIn(min = Sizes.dayRow)
            .clip(shape)
            .border(1.dp, activity.copy(alpha = 0.18f), shape)
            .clickable(role = Role.Button, onClick = onOpen),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Row(
            modifier = Modifier
                .weight(1f)
                .padding(horizontal = Spacing.md, vertical = Spacing.sm),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
        ) {
            Mono(
                text = clock(Predicates.bucketInstant(task), timezone) ?: "—:—",
                color = p.muted,
                style = LifeOsType.mono13,
            )
            Column(modifier = Modifier.weight(1f)) {
                Text(
                    text = task.title,
                    style = LifeOsType.body,
                    color = p.text,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                Row(horizontalArrangement = Arrangement.spacedBy(Spacing.xs)) {
                    if (task.repeatRule != "none") {
                        Mono("↻ ${task.repeatRule}", color = p.faint, style = LifeOsType.mono11)
                    }
                    if (task.remindAt != null) {
                        Mono("🔔", color = p.faint, style = LifeOsType.mono11)
                    }
                }
            }
            task.durationMinutes?.let { Mono("${it}m", color = p.faint, style = LifeOsType.mono11) }
            if (task.xpOnComplete > 0) {
                Mono("+${task.xpOnComplete} XP", color = p.positive, style = LifeOsType.mono12)
            }
        }
    }
}

private val HHMM = DateTimeFormatter.ofPattern("HH:mm")

private fun clock(iso: String?, timezone: String?): String? {
    val instant = iso?.let { runCatching { Instant.parse(it) }.getOrNull() } ?: return null
    val zone = runCatching { ZoneId.of(timezone) }.getOrElse { ZoneId.systemDefault() }
    return instant.atZone(zone).format(HHMM)
}
