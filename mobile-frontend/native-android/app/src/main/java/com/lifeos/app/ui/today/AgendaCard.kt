package com.lifeos.app.ui.today

import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.material3.ripple
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
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
import com.lifeos.app.domain.Art
import com.lifeos.app.domain.ResolvedArt
import com.lifeos.app.ui.art.ArtBackground
import com.lifeos.app.ui.art.ArtIcon
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
import com.lifeos.app.ui.theme.craftedSurface
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

    /*
     * The row's art, resolved once. A habit row takes the habit's two slots; a
     * task row takes the single icon the server already resolved onto it. One
     * call, so this card cannot disagree with the sheet behind it about which
     * picture is which — see [Art].
     */
    val art = Art.of(item, habit)

    /*
     * The card's own interaction source, so the surface and the ripple are
     * driven by the same press rather than by two independent ones. The tone
     * comes up to meet the finger in the `instant` 100ms of §5.2 — a card you
     * can push, which is what a card is supposed to be.
     */
    val interaction = remember { MutableInteractionSource() }

    Box(
        modifier = modifier
            .fillMaxWidth()
            .heightIn(min = if (hasStrip) Sizes.agendaCardWithStrip else Sizes.agendaCard)
            .alpha(cardAlpha)
            // Tonal, never a shadow (§6.3): the top edge is lit by about two
            // values out of 255, which is the difference between a card that
            // reads as an object and an outline with text in it.
            .craftedSurface(shape = shape, base = p.surface, border = null, interactionSource = interaction)
            .let { base ->
                // `now` is the only card that pulses, and the pulse is the same
                // one Needs-you uses — one implementation, two places.
                if (state == "now" && !done) {
                    base.pulseBorder(activity, shape)
                } else {
                    base.border(1.dp, animatedBorder, shape)
                }
            }
            .clickable(
                interactionSource = interaction,
                indication = ripple(),
                role = Role.Button,
                onClick = onOpen,
            ),
    ) {
        /*
         * The habit's background picture, under its scrim. `matchParentSize` so
         * the picture fills the card and the card's height is still decided by
         * its text — §4.5's height is 88dp whatever the artwork is.
         */
        ArtBackground(art = art, modifier = Modifier.matchParentSize())

        /*
         * **No colour bar.** Not 3dp, not 4dp, not a "rule" — the element is
         * gone. `mobile-frontend/app/AGENTS.md` settled this: a strip of colour
         * down the left of a card reads as a divider between two things rather
         * than as a mark on one, whatever width it is given. The card's own
         * border carries the activity colour, and the `now` pulse carries it
         * louder; that is what is supposed to carry it.
         */
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = Spacing.md, vertical = Spacing.md),
            horizontalArrangement = Arrangement.spacedBy(Spacing.md),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            IconTile(item = item, habit = habit, art = art, activity = activity)

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
 * glyph.
 *
 * All three cases are 48dp square and clipped to the tile radius, so a poll
 * that adds or loses a picture changes what is *in* the tile and never the row's
 * layout. The tint stays underneath the picture too — an icon with transparency
 * then sits on the activity's colour rather than on a hole.
 */
@Composable
private fun IconTile(
    item: AgendaItemDto,
    habit: HabitWithTodayDto?,
    art: ResolvedArt,
    activity: Color,
) {
    ArtIcon(
        picture = art.icon,
        size = Sizes.iconTile,
        tint = activity.copy(alpha = 0.14f),
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

    val interaction = remember { MutableInteractionSource() }

    Box(
        modifier = Modifier
            .size(Sizes.tickTouch)
            .clickable(
                interactionSource = interaction,
                // Unbounded and sized to the touch target: a 44dp ring inside a
                // 48dp target gets a circle of acknowledgement rather than a
                // rectangle of one, which is the difference between a control
                // and a region of the card that happens to respond.
                indication = ripple(bounded = false, radius = Sizes.tickTouch / 2),
                role = Role.Checkbox,
                onClick = onTick,
            ),
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
