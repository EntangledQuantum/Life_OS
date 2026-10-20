package com.lifeos.app.domain

import com.lifeos.app.data.api.AgendaItemDto
import com.lifeos.app.data.api.DashboardTodayDto
import com.lifeos.app.data.api.TaskDto

/**
 * Every filtering and counting rule in the app, defined exactly once.
 *
 * This file exists because of a real bug in this codebase: the web client shows
 * a "2" badge on a nav tab pointing at a page that renders nothing, because the
 * badge counts every active task while the page filters pinned ones out. The
 * same rule, hand-written twice, drifted apart.
 *
 * So: a count and the list it counts must come from the same function here. If a
 * screen needs a predicate that is not in this file, it goes in this file — it
 * does not get written inline "just for this one place".
 */
/** Day's two lists: what wants an answer, and what is merely planned. */
data class DayPartition(
    val needsYou: List<TaskDto>,
    val scheduled: List<TaskDto>,
)

object Predicates {

    /* ------------------------------------------------------------ tasks */

    /**
     * Pinned as an agent card — slot 0 or 1.
     *
     * Mirrors `isPinned` in `packages/shared/src/tasks.ts`.
     */
    fun isPinned(task: TaskDto): Boolean = task.slot == 0 || task.slot == 1

    fun isOpen(task: TaskDto): Boolean = task.status == "active"

    /**
     * The two agent cards Today shows below the agenda, in slot order.
     *
     * The *same* predicate the "needs you" count excludes, which is the whole
     * point of this file.
     */
    fun agentCards(data: DashboardTodayDto): List<TaskDto> =
        data.tasks.filter { isOpen(it) && isPinned(it) }.sortedBy { it.slot ?: 9 }

    /**
     * "Needs you": open reviews, plus anything the agent queued with no time.
     *
     * Excludes pinned cards — they are presentation, drawn on Today — so this
     * list and its count can never disagree with what Day renders. Today's
     * "Needs you · N" link and Day's block both call this one function.
     */
    fun needsYou(data: DashboardTodayDto): List<TaskDto> =
        data.tasks.filter { task ->
            isOpen(task) &&
                !isPinned(task) &&
                (task.kind == "review" || untimed(task))
        }

    fun needsYouCount(data: DashboardTodayDto): Int = needsYou(data).size

    private fun untimed(task: TaskDto): Boolean =
        task.eventAt == null && task.remindAt == null && task.showAt == null

    /**
     * The day bucket a task belongs to on Day: `eventAt ?? remindAt ?? showAt`.
     * A task with none of the three is never dropped — it gets the "No time"
     * bucket, which is what this returning null means.
     */
    fun bucketInstant(task: TaskDto): String? = task.eventAt ?: task.remindAt ?: task.showAt

    /** Every visible task on Day, excluding what Today already draws as a card. */
    fun scheduled(data: DashboardTodayDto): List<TaskDto> =
        data.tasks.filter { isOpen(it) && !isPinned(it) }

    /**
     * Day's two lists, split once.
     *
     * Day draws "Needs you" above "Scheduled". Computing the two independently
     * is how a task ends up in both — a review with a time would appear twice,
     * and an untimed one would be counted by the link on Today and listed under
     * two headings on Day. So the split happens here, exactly once: Needs you
     * wins, and Scheduled is everything visible that Needs you did not take.
     *
     * The pair is therefore **disjoint and complete** by construction, and a
     * test asserts it: every task [scheduled] returns appears in exactly one of
     * the two, and Today's `Needs you · N` is the length of [DayPartition.needsYou].
     */
    fun dayPartition(data: DashboardTodayDto): DayPartition {
        val needs = needsYou(data)
        val claimed = needs.mapTo(HashSet()) { it.id }
        return DayPartition(
            needsYou = needs,
            scheduled = scheduled(data).filter { it.id !in claimed },
        )
    }

    /* ----------------------------------------------------------- agenda */

    /**
     * Sort: timed things in time order, then untimed, then done last.
     *
     * A port of `compareAgenda` from `packages/shared/src/agenda.ts`. The server
     * has already applied it; this exists so a *new* item arriving mid-epoch can
     * be inserted at its sorted position rather than appended blindly
     * (see [AgendaEpoch]).
     */
    fun compareAgenda(a: AgendaItemDto, b: AgendaItemDto): Int {
        if (a.done != b.done) return if (a.done) 1 else -1
        val at = a.at
        val bt = b.at
        if (at != null && bt != null) return at.compareTo(bt)
        if (at != null) return -1
        if (bt != null) return 1
        return a.title.compareTo(b.title)
    }

    /**
     * The next one or two things — what the widget shows (§8.5).
     *
     * Taken off `data.agenda`, which the server has already merged and already
     * ordered, so the widget's "next" is the same next the agenda card shows at
     * the top of Today. Writing "the soonest timed task" here instead would be
     * a second ordering rule, and the two would drift the first time the server
     * changed `compareAgenda`.
     */
    fun upNext(data: DashboardTodayDto, limit: Int): List<AgendaItemDto> =
        data.agenda.asSequence().filter { !it.done }.take(limit.coerceAtLeast(0)).toList()

    /** Habits only: the week strip comes from `data.habits[habitId].history7`. */
    fun habitFor(data: DashboardTodayDto, item: AgendaItemDto) =
        item.habitId?.let { id -> data.habits.firstOrNull { it.id == id } }

    /* ------------------------------------------------------------ writes */

    /**
     * Writes exempt from the life-day guard (§7.5).
     *
     * A settings patch, a celebration acknowledgement, a notification receipt and
     * a dismissal all mean the same thing whatever day it is. A habit or task
     * completion does not — that is the whole guard.
     */
    fun isDayIndependent(kind: WriteKind): Boolean = when (kind) {
        WriteKind.SETTINGS_PATCH,
        WriteKind.CELEBRATION_SEEN,
        WriteKind.TASK_NOTIFIED,
        WriteKind.TASK_DISMISS,
        -> true

        WriteKind.HABIT_COMPLETE,
        WriteKind.HABIT_UNDO,
        WriteKind.TASK_COMPLETE,
        WriteKind.SESSION_START,
        WriteKind.SESSION_STOP,
        WriteKind.STUDY_LOG,
        -> false
    }
}
