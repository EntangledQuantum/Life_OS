package com.lifeos.app.domain

import com.lifeos.app.data.api.AgendaItemDto
import com.lifeos.app.data.api.DashboardTodayDto

/**
 * The optimistic overlay (UI_SPEC §7.1, §4.6).
 *
 * A tap gets a response in the same frame. The write goes into `pending_writes`
 * and this function paints its effect onto whatever the last snapshot said, so
 * the row is done before the socket has been opened.
 *
 * What it deliberately does **not** do is patch aggregates. A single write can
 * award XP, move efficiency, flip the pulse, schedule the next occurrence and
 * complete a goal; rebuilding that client-side drifts from what the server will
 * actually say. So the meter, the percentages and the pulse are left alone and
 * animate to the real value when the refetch lands (§4.6 step 3). Offline, the
 * row is done and the meter honestly holds its cached value with the stale strip
 * showing.
 *
 * Pure, so the behaviour is unit-tested rather than inferred from a screenshot.
 */
object Overlay {

    /**
     * Apply the pending writes to a snapshot.
     *
     * Only `PENDING` writes count. A stranded write's overlay is dropped at the
     * moment it strands, so the row returns to undone and the UI stops lying —
     * which is why this takes the writes already filtered rather than deciding
     * here.
     */
    fun apply(data: DashboardTodayDto, writes: List<PendingWrite>): DashboardTodayDto {
        if (writes.isEmpty()) return data

        val completed = HashSet<String>()
        val undone = HashSet<String>()
        for (write in writes) {
            when (write.kind) {
                WriteKind.HABIT_COMPLETE, WriteKind.TASK_COMPLETE -> {
                    completed += write.targetId
                    undone -= write.targetId
                }

                WriteKind.HABIT_UNDO -> {
                    undone += write.targetId
                    completed -= write.targetId
                }

                else -> Unit
            }
        }
        if (completed.isEmpty() && undone.isEmpty()) return data

        fun overlay(items: List<AgendaItemDto>) = items.map { item ->
            when (item.refId) {
                // `state: "done"` as well as `done: true`: the card's treatment is
                // driven by the state, so setting only the flag would tick the row
                // without dimming it.
                in completed -> if (item.done) item else item.copy(done = true, state = "done")
                in undone -> if (!item.done) item else item.copy(done = false, state = "upcoming")
                else -> item
            }
        }

        return data.copy(
            agenda = overlay(data.agenda),
            // `anytime` is a convenience subset of the same rows; leaving it
            // un-overlaid would make the same item disagree with itself.
            anytime = overlay(data.anytime),
            habits = data.habits.map { habit ->
                when (habit.id) {
                    in completed -> if (habit.completedToday) habit else habit.copy(completedToday = true)
                    in undone -> if (!habit.completedToday) habit else habit.copy(completedToday = false)
                    else -> habit
                }
            },
            tasks = data.tasks.map { task ->
                if (task.id in completed && task.status == "active") task.copy(status = "done") else task
            },
        )
    }

    /**
     * Which rows show the pending dot (§7.5): `+12 XP ◌`.
     *
     * A set of `refId`s with an unsent completion against them. The tick is
     * already filled, because the user did the thing; this is the whole
     * indication, and it is static.
     */
    fun pendingTargets(writes: List<PendingWrite>): Set<String> =
        writes.asSequence()
            .filter {
                it.kind == WriteKind.HABIT_COMPLETE ||
                    it.kind == WriteKind.TASK_COMPLETE ||
                    it.kind == WriteKind.HABIT_UNDO
            }
            .map { it.targetId }
            .toSet()
}
