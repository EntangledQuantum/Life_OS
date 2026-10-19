package com.lifeos.app.ui.today

import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.scale
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.lifeos.app.data.api.AgendaItemDto
import com.lifeos.app.data.api.HabitWithTodayDto
import com.lifeos.app.ui.components.Mono
import com.lifeos.app.ui.components.PendingDot
import com.lifeos.app.ui.components.pulseBorder
import com.lifeos.app.ui.theme.ActivityColors
import com.lifeos.app.ui.theme.LifeOsType
import com.lifeos.app.ui.theme.LocalReducedMotion
import com.lifeos.app.ui.theme.Motion
import com.lifeos.app.ui.theme.Radii
import com.lifeos.app.ui.theme.Sizes
import com.lifeos.app.ui.theme.Spacing
import com.lifeos.app.ui.theme.palette
import java.time.Duration
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import kotlin.math.abs

/**
 * One card per `AgendaItem` (§4.5).
 *
 * The agenda arrives already merged and already ordered. **This card does not
 * know whether it is a habit or a task** beyond which endpoint a tick hits —
 * that is the whole point of the merged list, and re-splitting it has read as
 * duplication both times it was tried.
 *
 * The habit is passed in by the screen and looked up by `habitId`, because an
 * `AgendaItem` deliberately does not carry the art or `history7`: copying a
 * `data:` URI onto every agenda item would resend the same picture every poll.
 */
@Composable
fun AgendaCard(
    item: AgendaItemDto,
    habit: HabitWithTodayDto?,
    pending: Boolean,
    streaksEnabled: Boolean,
    onTick: () -> Unit,
    onOpen: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val p = palette
    val reduced = LocalReducedMotion.current
    val activity = ActivityColors.of(item.activityTag, p.accent)
    val shape = RoundedCornerShape(Radii.card)

    val done = item.done
    val state = item.state

    /* Per-state treatment (§4.5). Amber for overdue, never red. */
    val borderColour = when {
        done -> activity.copy(alpha = 0.10f)
        state == "now" -> activity.copy(alpha = 0.40f)
        state == "overdue" -> p.warning.copy(alpha = 0.40f)
        state == "anytime" -> activity.copy(alpha = 0.10f)
        else -> activity.copy(alpha = 0.18f)
    }

    val animatedBorder by animateColorAsState(
        targetValue = borderColour,
        animationSpec = tween(if (reduced) Motion.REDUCED else Motion.MEDIUM, easing = Motion.emphasized),
        label = "card-border",
    )

    // `done` takes the whole card to 55% alpha. No strikethrough: it reads as
    // deletion, and the thing was done, not cancelled.
    val cardAlpha by animateFloatAsState(
        targetValue = if (done) 0.55f else 1f,
        animationSpec = tween(if (reduced) Motion.REDUCED else Motion.MEDIUM, easing = Motion.emphasized),
        label = "card-alpha",
    )

    val hasStrip = habit != null && habit.history7.isNotEmpty()

    Row(
        modifier = modifier
            .fillMaxWidth()
            .heightIn(min = if (hasStrip) Sizes.agendaCardWithStrip else Sizes.agendaCard)
            .alpha(cardAlpha)
            .clip(shape)
            .background(p.surface)
            .let { base ->
                // `now` is the only card that pulses, and the pulse is the same
                // one Needs-you uses — one implementation, two places.
                if (state == "now" && !done) {
                    base.pulseBorder(activity, shape)
                } else {
                    base.border(1.dp, animatedBorder, shape)
                }
            }
            .clickable(role = Role.Button, onClick = onOpen),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        /* 4dp leading rule, full height, the activity colour at 100%. There is
         * no 3dp colour bar inside the card — at three pixels it read as a
         * divider rather than as a mark. */
        Box(
            modifier = Modifier
                .width(Sizes.leadingRule)
                .fillMaxHeight()
                .background(activity.copy(alpha = if (done) 0.30f else 1f)),
        )

        Row(
            modifier = Modifier
                .weight(1f)
                .padding(horizontal = Spacing.md, vertical = Spacing.md),
            horizontalArrangement = Arrangement.spacedBy(Spacing.md),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            IconTile(item = item, habit = habit, activity = activity)

            Column(
                modifier = Modifier.weight(1f),
                verticalArrangement = Arrangement.spacedBy(2.dp),
            ) {
                MetaLine(item = item)

                Text(
                    text = item.title,
                    style = LifeOsType.cardTitle,
                    color = p.text,
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis,
                )

                // For a habit the sub line is the **anchor** — it is why the
                // habit sticks, so it is surfaced rather than hidden in a sheet.
                val sub = item.subtitle ?: habit?.anchor
                if (!sub.isNullOrBlank()) {
                    Text(
                        text = sub,
                        style = LifeOsType.bodySmall,
                        color = p.muted,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                }

                if (hasStrip && streaksEnabled) {
                    WeekStrip(history7 = habit.history7, activity = activity)
                }
            }

            Column(
                horizontalAlignment = Alignment.End,
                verticalArrangement = Arrangement.spacedBy(Spacing.sm),
            ) {
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
                ) {
                    // A pending write shows a static hollow dot in the XP slot's
                    // left margin. That is the whole indication — the tick is
                    // already filled, because the user did the thing.
                    if (pending) PendingDot()
                    // A reward indicator, not a button.
                    Mono(
                        text = if (done) "+${item.xp} XP ✓" else "+${item.xp} XP",
                        color = p.positive,
                    )
                }
                Tick(done = done, activity = activity, onTick = onTick)
            }
        }
    }
}

/**
 * The 48dp icon tile: the resolved picture, else the emoji, else the activity
 * glyph. Never a photographic background behind text.
 */
@Composable
private fun IconTile(item: AgendaItemDto, habit: HabitWithTodayDto?, activity: Color) {
    Box(
        modifier = Modifier
            .size(Sizes.iconTile)
            .clip(RoundedCornerShape(Radii.tile))
            .background(activity.copy(alpha = 0.14f)),
        contentAlignment = Alignment.Center,
    ) {
        val emoji = item.emoji ?: habit?.emoji
        Text(
            text = emoji?.takeIf { it.isNotBlank() } ?: glyph(item.activityTag),
            fontSize = 24.sp,
        )
    }
}

/** A stand-in when a row has no emoji. Shapes, so no bucket needs a legend. */
private fun glyph(activityTag: String?): String = when (activityTag) {
    ActivityColors.DEEP_WORK -> "◆"
    ActivityColors.STUDY -> "▲"
    ActivityColors.SLEEP -> "☾"
    ActivityColors.EXERCISE -> "●"
    ActivityColors.BREAK -> "○"
    ActivityColors.LIFE_ADMIN -> "■"
    ActivityColors.EXPLORATION -> "✦"
    else -> "•"
}

/**
 * `07:30 · in 12m`, in mono.
 *
 * Omitted entirely for `anytime` — a row with no time must not be given a blank
 * where a time would be, because an empty slot reads as missing data.
 */
@Composable
private fun MetaLine(item: AgendaItemDto) {
    if (item.state == "anytime" || item.at.isNullOrBlank()) return
    val p = palette
    val instant = runCatching { Instant.parse(item.at) }.getOrNull() ?: return
    val clock = instant.atZone(ZoneId.systemDefault()).format(HHMM)
    val relative = relative(instant)
    val overdue = item.state == "overdue"

    Mono(
        text = if (relative != null) "$clock · $relative" else clock,
        color = if (overdue) p.warning else p.faint,
    )
}

private val HHMM = DateTimeFormatter.ofPattern("HH:mm")

/** `in 12m` ahead, `40m ago` behind. Null when it is further off than an hour. */
private fun relative(at: Instant): String? {
    val minutes = Duration.between(Instant.now(), at).toMinutes()
    return when {
        minutes in 1..59 -> "in ${minutes}m"
        minutes == 0L -> "now"
        minutes < 0 && abs(minutes) <= 180 -> "${abs(minutes)}m ago"
        else -> null
    }
}

/**
 * Seven marks, oldest first. Done is the activity colour; missed is white at 8%.
 *
 * **A missed day is never red.** No broken hearts, no "you lost 12 days".
 */
@Composable
private fun WeekStrip(history7: List<Boolean>, activity: Color) {
    Row(
        horizontalArrangement = Arrangement.spacedBy(3.dp),
        modifier = Modifier.padding(top = 2.dp),
    ) {
        history7.takeLast(7).forEach { done ->
            Box(
                modifier = Modifier
                    .size(Sizes.weekMark)
                    .clip(RoundedCornerShape(2.dp))
                    .background(if (done) activity else Color.White.copy(alpha = 0.08f)),
            )
        }
    }
}

/**
 * The one primary action on the surface.
 *
 * Ring → fill over 100ms with a single `spring.snap` scale punch. This is the
 * app's signature micro-interaction and it is allowed to be crisp. It does not
 * move the row, and it never shows a spinner — the local database is what the
 * screen is drawn from, so there is nothing to wait for.
 */
@Composable
private fun Tick(done: Boolean, activity: Color, onTick: () -> Unit) {
    val p = palette
    val reduced = LocalReducedMotion.current

    val punch by animateFloatAsState(
        targetValue = if (done) 1f else 0f,
        animationSpec = if (reduced) {
            tween(Motion.REDUCED)
        } else {
            spring(dampingRatio = Motion.SNAP_DAMPING, stiffness = Motion.SNAP_STIFFNESS)
        },
        label = "tick-punch",
    )

    Box(
        modifier = Modifier
            .size(Sizes.tickTouch)
            .clickable(role = Role.Checkbox, onClick = onTick),
        contentAlignment = Alignment.Center,
    ) {
        Box(
            modifier = Modifier
                .size(Sizes.tick)
                // 1.0 → 1.12 → 1.0. The spring overshoot is the punch.
                .scale(1f + punch * 0.12f * (1f - punch))
                .clip(RoundedCornerShape(50))
                .background(if (done) activity else Color.Transparent)
                .border(
                    width = 2.dp,
                    color = if (done) activity else p.border.copy(alpha = 0.35f),
                    shape = RoundedCornerShape(50),
                ),
            contentAlignment = Alignment.Center,
        ) {
            if (done) {
                Text("✓", color = p.bg, style = LifeOsType.cardTitle)
            }
        }
    }
}
