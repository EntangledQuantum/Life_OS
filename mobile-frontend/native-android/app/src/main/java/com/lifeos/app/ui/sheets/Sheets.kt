package com.lifeos.app.ui.sheets

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.lifeos.app.data.api.AgendaItemDto
import com.lifeos.app.data.api.DashboardTodayDto
import com.lifeos.app.data.api.HabitWithTodayDto
import com.lifeos.app.data.api.TaskDto
import com.lifeos.app.domain.AnalyticsModel
import com.lifeos.app.ui.components.Mono
import com.lifeos.app.ui.components.SectionHeader
import com.lifeos.app.ui.theme.ActivityColors
import com.lifeos.app.ui.theme.LifeOsType
import com.lifeos.app.ui.theme.Radii
import com.lifeos.app.ui.theme.Spacing
import com.lifeos.app.ui.theme.palette
import com.lifeos.app.ui.you.DeltaTile
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter

/**
 * The four sheets Milestone 1 wired but left inert, plus `study/log`.
 *
 * Every one of them obeys the same two rules: **one filled button per sheet**,
 * and nothing in a sheet waits on a socket — a sheet's action enqueues and
 * closes, exactly like a row's tick.
 *
 * `svg` is deliberately **not** rendered in any of them. The markup is untrusted
 * and must be sandboxed; drawing it to look finished would be the wrong trade.
 */

/* ------------------------------------------------------------ agenda/{id} */

/**
 * `agenda/{id}` — tapping an agenda card's body (§4.5).
 *
 * `body`, `purpose`, `resources` as link rows, the streak when `streaksEnabled`,
 * the repeat rule in words, and a **secondary** Undo when the thing is done. The
 * tick stays on the row; this sheet is for reading what the thing is.
 */
@Composable
fun AgendaDetailSheet(
    item: AgendaItemDto,
    habit: HabitWithTodayDto?,
    task: TaskDto?,
    streaksEnabled: Boolean,
    onUndo: () -> Unit,
    onComplete: () -> Unit,
    onOpenLink: (String) -> Unit,
) {
    val p = palette
    val activity = ActivityColors.of(item.activityTag, p.accent)

    SheetBody {
        Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(Spacing.md),
        ) {
            Text(
                text = item.emoji ?: habit?.emoji ?: "•",
                style = LifeOsType.screenTitle,
            )
            Column(modifier = Modifier.weight(1f)) {
                Text(item.title, style = LifeOsType.screenTitle, color = p.text)
                item.activityTag?.let {
                    Mono(it, color = activity, style = LifeOsType.mono12)
                }
            }
            Mono(
                text = if (item.done) "+${item.xp} XP ✓" else "+${item.xp} XP",
                color = p.positive,
            )
        }

        habit?.anchor?.takeIf { it.isNotBlank() }?.let {
            // The anchor is why the habit sticks, so it is surfaced rather than
            // hidden.
            Text(it, style = LifeOsType.body, color = p.muted)
        }

        task?.body?.takeIf { it.isNotBlank() }?.let {
            Text(it, style = LifeOsType.body, color = p.text)
        }

        task?.purpose?.takeIf { it.isNotBlank() }?.let {
            SectionHeader("Why")
            Text(it, style = LifeOsType.bodySmall, color = p.muted)
        }

        task?.ctaLink?.takeIf { it.isNotBlank() }?.let { link ->
            SectionHeader("Resources")
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(Radii.tile))
                    .clickable { onOpenLink(link) }
                    .padding(vertical = Spacing.sm),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(
                    text = task.ctaLabel?.takeIf { it.isNotBlank() } ?: link,
                    style = LifeOsType.body,
                    color = p.accent,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.weight(1f),
                )
                Text("›", style = LifeOsType.cardTitle, color = p.muted)
            }
        }

        if (streaksEnabled && habit != null) {
            HorizontalDivider(color = p.border)
            Row(horizontalArrangement = Arrangement.spacedBy(Spacing.xl)) {
                Column {
                    SectionHeader("Streak")
                    Mono("${habit.currentStreak}", color = p.text, style = LifeOsType.mono16)
                }
                Column {
                    SectionHeader("Longest")
                    Mono("${habit.longestStreak}", color = p.muted, style = LifeOsType.mono16)
                }
            }
        }

        task?.repeatRule?.takeIf { it != "none" }?.let {
            Mono("repeats $it", color = p.faint, style = LifeOsType.mono11)
        }

        if (task?.svg != null) {
            Text(
                text = "This item carries agent artwork. It is not drawn here yet: " +
                    "untrusted markup needs a sandbox.",
                style = LifeOsType.bodySmall,
                color = p.faint,
            )
        }

        if (item.done) {
            // Secondary, not filled: the thing is already done, and the one
            // filled button rule means undo does not compete with it.
            TextButton(onClick = onUndo) { Text("Undo", color = p.accent) }
        } else {
            Button(
                onClick = onComplete,
                colors = ButtonDefaults.buttonColors(
                    containerColor = p.accent,
                    contentColor = p.bg,
                ),
                modifier = Modifier.fillMaxWidth(),
            ) {
                Text("Done", style = LifeOsType.cardTitle)
            }
        }
    }
}

/* -------------------------------------------------------------- task/{id} */

/**
 * `task/{id}` — a Day row, a Needs-you row, or a notification tap.
 *
 * **No Start button.** A task has a target time and a done flag; it does not
 * run, and completing it does not change what activity you are in.
 */
@Composable
fun TaskSheet(
    task: TaskDto,
    timezone: String?,
    onComplete: () -> Unit,
    onDismiss: () -> Unit,
    onOpenLink: (String) -> Unit,
) {
    val p = palette
    val activity = ActivityColors.of(task.activityTag, p.accent)

    SheetBody {
        Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(Spacing.md),
        ) {
            Text(task.emoji ?: "•", style = LifeOsType.screenTitle)
            Column(modifier = Modifier.weight(1f)) {
                Text(task.title, style = LifeOsType.screenTitle, color = p.text)
                Mono(
                    text = listOfNotNull(
                        task.kind,
                        task.activityTag,
                        clock(task.eventAt ?: task.remindAt ?: task.showAt, timezone),
                    ).joinToString(" · "),
                    color = activity,
                    style = LifeOsType.mono12,
                )
            }
            if (task.xpOnComplete > 0) {
                Mono("+${task.xpOnComplete} XP", color = p.positive)
            }
        }

        task.subtitle?.takeIf { it.isNotBlank() }?.let {
            Text(it, style = LifeOsType.body, color = p.muted)
        }
        task.body?.takeIf { it.isNotBlank() }?.let {
            Text(it, style = LifeOsType.body, color = p.text)
        }
        task.purpose?.takeIf { it.isNotBlank() }?.let {
            SectionHeader("Why")
            Text(it, style = LifeOsType.bodySmall, color = p.muted)
        }

        task.ctaLink?.takeIf { it.isNotBlank() }?.let { link ->
            TextButton(onClick = { onOpenLink(link) }) {
                Text(task.ctaLabel?.takeIf { it.isNotBlank() } ?: link, color = p.accent)
            }
        }

        if (task.repeatRule != "none") {
            Mono("repeats ${task.repeatRule}", color = p.faint, style = LifeOsType.mono11)
        }
        task.remindAt?.let {
            Mono("reminder ${clock(it, timezone)}", color = p.faint, style = LifeOsType.mono11)
        }

        Button(
            onClick = onComplete,
            colors = ButtonDefaults.buttonColors(
                containerColor = p.accent,
                contentColor = p.bg,
            ),
            modifier = Modifier.fillMaxWidth(),
        ) {
            Text("Done", style = LifeOsType.cardTitle)
        }
        // Putting it away is not the same as doing it, and it is not the primary
        // action — so it is a text button, not a second filled one.
        TextButton(onClick = onDismiss) { Text("Dismiss", color = p.muted) }
    }
}

/* ------------------------------------------------- the meter's detail sheet */

/**
 * Everything cut from Today, one tap deep behind the meter (§4.3).
 *
 * `improvementPct` as percentage **points**, `yesterdayEfficiencyPct`, the five
 * `vsYesterday` figures, and lifetime XP in small mono at the bottom. One tap,
 * no tab — and nothing here is on Today, because a number that contradicts the
 * pulse must not sit next to it.
 */
@Composable
fun MeterDetailSheet(data: DashboardTodayDto) {
    val p = palette
    val vs = data.vsYesterday

    SheetBody {
        Text("Today, in detail", style = LifeOsType.screenTitle, color = p.text)

        Row(horizontalArrangement = Arrangement.spacedBy(Spacing.xl)) {
            Column {
                SectionHeader("Improvement")
                Mono(
                    text = AnalyticsModel.points(data.progress.improvementPct),
                    color = if (data.progress.improvementPct >= 0) p.positive else p.muted,
                    style = LifeOsType.mono16,
                )
            }
            Column {
                SectionHeader("Yesterday")
                Mono(
                    text = "${Math.round(data.progress.yesterdayEfficiencyPct)}%",
                    color = p.muted,
                    style = LifeOsType.mono16,
                )
            }
        }

        HorizontalDivider(color = p.border)
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

        HorizontalDivider(color = p.border)
        // Lifetime XP: small, mono, at the bottom, and nowhere else in the app.
        Mono("lifetime ${data.progress.totalXp} XP", color = p.faint, style = LifeOsType.mono11)
    }
}

/* --------------------------------------------------------- session/picker */

/**
 * `session/picker` — the seven activity chips (§4.4).
 *
 * A **closed set**. Nothing invents a tag: the seven buckets are what the
 * ribbon, the aggregates and the widget all depend on, and an eighth would make
 * one of them wrong.
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun SessionPickerSheet(onPick: (String) -> Unit) {
    val p = palette
    SheetBody {
        Text("What are you doing?", style = LifeOsType.screenTitle, color = p.text)
        FlowRow(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
            verticalArrangement = Arrangement.spacedBy(Spacing.sm),
        ) {
            ActivityColors.ALL.forEach { tag ->
                val colour = ActivityColors.of(tag, p.accent)
                Row(
                    modifier = Modifier
                        .clip(RoundedCornerShape(Radii.tile))
                        .background(colour.copy(alpha = 0.16f))
                        .clickable { onPick(tag) }
                        .padding(horizontal = Spacing.md, vertical = Spacing.md),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
                ) {
                    Box(
                        modifier = Modifier
                            .size(8.dp)
                            .clip(RoundedCornerShape(50))
                            .background(colour),
                    )
                    Text(tag, style = LifeOsType.body, color = p.text)
                }
            }
        }
        Text(
            text = "A session is the only running thing in Life OS. Nothing your agent " +
                "scheduled ever starts.",
            style = LifeOsType.bodySmall,
            color = p.faint,
        )
    }
}

/* -------------------------------------------------------------- study/log */

/** The five quality flags. The last three carry multipliers; they are not cosmetic. */
private val QUALITY_FLAGS = listOf("normal", "struggle", "inspired", "feynman", "retrieval")

/**
 * `study/log` — Day's FAB (§3.2).
 *
 * Title, minutes and a quality flag, and one filled **Log** button. The flags
 * `inspired`, `feynman` and `retrieval` carry XP multipliers, which is why they
 * are offered as chips rather than hidden behind "advanced": choosing the wrong
 * one quietly mis-pays the day.
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun StudyLogSheet(onLog: (String, Int, String) -> Unit) {
    val p = palette
    var title by remember { mutableStateOf("") }
    var minutes by remember { mutableStateOf("") }
    var flag by remember { mutableStateOf("normal") }

    val parsedMinutes = minutes.toIntOrNull()
    val valid = title.isNotBlank() && parsedMinutes != null && parsedMinutes > 0

    SheetBody {
        Text("Log study", style = LifeOsType.screenTitle, color = p.text)

        OutlinedTextField(
            value = title,
            onValueChange = { title = it },
            label = { Text("What did you study?") },
            singleLine = true,
            modifier = Modifier.fillMaxWidth(),
        )

        OutlinedTextField(
            value = minutes,
            onValueChange = { minutes = it.filter(Char::isDigit).take(4) },
            label = { Text("Minutes") },
            singleLine = true,
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
            modifier = Modifier.fillMaxWidth(),
        )

        SectionHeader("Quality")
        FlowRow(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
            verticalArrangement = Arrangement.spacedBy(Spacing.sm),
        ) {
            QUALITY_FLAGS.forEach { candidate ->
                val selected = candidate == flag
                Box(
                    modifier = Modifier
                        .clip(RoundedCornerShape(Radii.tile))
                        .background(if (selected) p.accent.copy(alpha = 0.18f) else p.surface2)
                        .clickable { flag = candidate }
                        .padding(horizontal = Spacing.md, vertical = Spacing.sm),
                ) {
                    Text(
                        text = candidate,
                        style = LifeOsType.label,
                        color = if (selected) p.accent else p.muted,
                    )
                }
            }
        }
        Text(
            text = "inspired · feynman · retrieval carry XP multipliers.",
            style = LifeOsType.bodySmall,
            color = p.faint,
        )

        Button(
            onClick = { onLog(title.trim(), parsedMinutes ?: 0, flag) },
            enabled = valid,
            colors = ButtonDefaults.buttonColors(
                containerColor = p.accent,
                contentColor = p.bg,
            ),
            modifier = Modifier.fillMaxWidth(),
        ) {
            Text("Log", style = LifeOsType.cardTitle)
        }
    }
}

/* ---------------------------------------------------------------- shared */

/**
 * The inside of every sheet: 560dp cap, 24dp radius at the top from the host,
 * scrollable, and clear of the navigation bar.
 */
@Composable
private fun SheetBody(content: @Composable () -> Unit) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .verticalScroll(rememberScrollState())
            .navigationBarsPadding()
            .padding(horizontal = Spacing.xl, vertical = Spacing.lg),
        verticalArrangement = Arrangement.spacedBy(Spacing.md),
    ) {
        content()
    }
}

private val HHMM = DateTimeFormatter.ofPattern("HH:mm")

private fun clock(iso: String?, timezone: String?): String? {
    val instant = iso?.let { runCatching { Instant.parse(it) }.getOrNull() } ?: return null
    val zone = runCatching { ZoneId.of(timezone) }.getOrElse { ZoneId.systemDefault() }
    return instant.atZone(zone).format(HHMM)
}
