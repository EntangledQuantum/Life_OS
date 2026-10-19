package com.lifeos.app.domain

import com.lifeos.app.data.api.AgendaItemDto

/**
 * A row does not move when it is ticked (UI_SPEC §4.6).
 *
 * The server's `compareAgenda` puts `done` last, so a naive re-render on the
 * next poll *would* move the row the user just ticked — down the list, under
 * their finger, 200ms after they touched it. That is the single most important
 * interaction rule on the main screen, and it cannot be fixed in the view.
 *
 * So the list captures its order once per **epoch** and applies incoming items
 * into that order. Within an epoch nothing already on screen ever changes index.
 * A new epoch — a full re-sort — begins only on:
 *
 *  - a life-day change,
 *  - a cold process start,
 *  - an explicit pull-to-refresh.
 *
 * Anything genuinely new arriving mid-epoch is inserted at its sorted position
 * rather than appended, so an item the agent adds for 09:00 does not land at the
 * bottom under yesterday's leftovers.
 */
class AgendaEpoch(
    /** The life-day this epoch belongs to. A change in it ends the epoch. */
    val lifeDayDate: String,
    initialOrder: List<String> = emptyList(),
) {
    /** Row ids in the order they are drawn. */
    private val order: MutableList<String> = initialOrder.toMutableList()

    val currentOrder: List<String> get() = order.toList()

    /**
     * Apply a freshly-fetched list into this epoch's order.
     *
     * Items already known keep their index. Items that have vanished are
     * dropped. New items are inserted where [Predicates.compareAgenda] says they
     * belong relative to the items around them.
     */
    fun apply(incoming: List<AgendaItemDto>): List<AgendaItemDto> {
        val byId = incoming.associateBy { it.id }

        // Drop anything the server no longer sends; keep the rest in place.
        order.retainAll(byId.keys)

        val known = order.toHashSet()
        for (item in incoming) {
            if (item.id in known) continue
            order.add(insertionIndex(item, byId), item.id)
            known.add(item.id)
        }

        return order.mapNotNull(byId::get)
    }

    /**
     * Where a new item goes: before the first existing row it sorts ahead of.
     *
     * Compared against the *server's* ordering rule rather than against the
     * epoch's frozen one, because the frozen order is deliberately out of sorted
     * sequence wherever someone has ticked something.
     */
    private fun insertionIndex(item: AgendaItemDto, byId: Map<String, AgendaItemDto>): Int {
        for ((index, id) in order.withIndex()) {
            val existing = byId[id] ?: continue
            if (Predicates.compareAgenda(item, existing) < 0) return index
        }
        return order.size
    }

    companion object {
        /** Start a fresh epoch from a sorted payload. */
        fun from(lifeDayDate: String, items: List<AgendaItemDto>): AgendaEpoch =
            AgendaEpoch(lifeDayDate, items.map { it.id })
    }
}
