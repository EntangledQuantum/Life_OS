package com.lifeos.app.domain

import com.lifeos.app.data.api.GoalDto

/**
 * The celebration queue (UI_SPEC §3.4).
 *
 * A goal whose condition is true is not finished until the user has watched the
 * animation — that is the contract, and `celebration-seen` is what ends it. So:
 * one at a time, queued, oldest debt first, and nothing is ever marked seen
 * because it was rendered or because a timer ran out.
 *
 * Pure, because the ordering is the part that can be wrong in a way a screenshot
 * cannot show.
 */
data class Celebration(
    val goalId: String,
    /** The rung being celebrated, when the goal has a ladder. */
    val tierId: String?,
    val title: String,
    val emoji: String,
    val whyItMatters: String?,
    /** The tier's word — "Bronze", "Mythic" — shown above the title. */
    val tierLabel: String?,
    val themeColor: String?,
    /** For ordering, and so a sheet can say when it was earned. */
    val metAt: String?,
) {
    /**
     * What identifies this celebration while it is on screen.
     *
     * The tier when there is one: a five-rung goal owes the user five
     * animations, and keying on the goal would collapse them into one.
     */
    val key: String get() = tierId ?: goalId
}

object Celebrations {

    /**
     * The queue, oldest owed first.
     *
     * `pendingCelebrations` from the dashboard is already the server's answer to
     * "what does this user not yet know about", so this does not re-decide it.
     * What it does decide is **which rung** and **in what order**:
     *
     *  - a goal with a `pendingTier` celebrates that rung, not the goal;
     *  - ties break on the id, so the order is stable across polls and the
     *    dialog cannot swap under the user's thumb between two renders.
     *
     * [dismissed] holds the keys the user has already pressed **Nice** on. The
     * write is queued, so the next poll still reports them pending for a second
     * or two; without this the dialog would reappear the instant it closed.
     */
    fun queue(goals: List<GoalDto>, dismissed: Set<String> = emptySet()): List<Celebration> =
        goals
            .mapNotNull(::celebrationFor)
            .filter { it.key !in dismissed }
            .sortedWith(compareBy({ it.metAt ?: "" }, { it.key }))

    /** The one on screen, or none. */
    fun next(goals: List<GoalDto>, dismissed: Set<String> = emptySet()): Celebration? =
        queue(goals, dismissed).firstOrNull()

    private fun celebrationFor(goal: GoalDto): Celebration? {
        val tier = goal.pendingTier
        if (tier == null && !goal.celebrationPending) return null
        return Celebration(
            goalId = goal.id,
            tierId = tier?.id,
            // A rung may rename the goal for its own card; most do not.
            title = tier?.title?.takeIf { it.isNotBlank() } ?: goal.title,
            emoji = tier?.emoji?.takeIf { it.isNotBlank() } ?: goal.emoji,
            whyItMatters = tier?.description?.takeIf { it.isNotBlank() } ?: goal.whyItMatters,
            tierLabel = tier?.label?.takeIf { it.isNotBlank() },
            themeColor = tier?.themeColor ?: goal.themeColor,
            metAt = tier?.metAt ?: goal.conditionMetAt,
        )
    }
}

/** How loud the one loud moment is allowed to be. */
enum class CelebrationIntensity {
    /** Particles. */
    FULL,

    /** A single restrained bloom, no particles. */
    MINIMAL,

    /** None at all — and the dialog still appears and still needs dismissing. */
    OFF,
    ;

    companion object {
        fun of(value: String?): CelebrationIntensity = when (value) {
            "minimal" -> MINIMAL
            "off" -> OFF
            else -> FULL
        }
    }
}

/**
 * Goals on You, ordered for reading (§3.3).
 *
 * The goal nearest completion is first and drawn larger — it is the one thing on
 * the screen. Achieved goals sink: a finished goal is history, and leaving it at
 * the top means the screen stops answering "am I going anywhere".
 */
object GoalOrder {

    fun forYou(goals: List<GoalDto>): List<GoalDto> =
        goals.sortedWith(
            compareBy<GoalDto> { if (it.status == "achieved") 1 else 0 }
                .thenByDescending { it.progressPct }
                .thenBy { it.id },
        )

    /**
     * The rungs of a goal's ladder, bottom first, with whether each is reached.
     *
     * `rank` is the ladder's order and is authoritative when present; a server
     * that sends rungs with no rank at all gets the array order, which is the
     * documented bottom-first convention.
     */
    fun rungs(goal: GoalDto): List<Rung> {
        val ordered = if (goal.tiers.all { it.rank == 0 }) {
            goal.tiers
        } else {
            goal.tiers.sortedBy { it.rank }
        }
        val currentRank = goal.currentTier?.rank
        return ordered.mapIndexed { index, tier ->
            Rung(
                id = tier.id,
                label = tier.label,
                rank = if (tier.rank > 0) tier.rank else index + 1,
                progressPct = tier.progressPct,
                reached = tier.metAt != null ||
                    (currentRank != null && tier.rank in 1..currentRank),
                isNext = goal.nextTier?.id == tier.id,
            )
        }
    }

    data class Rung(
        val id: String,
        val label: String,
        val rank: Int,
        val progressPct: Double,
        val reached: Boolean,
        val isNext: Boolean,
    )
}
