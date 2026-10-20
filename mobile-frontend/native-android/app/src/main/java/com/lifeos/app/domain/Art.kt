package com.lifeos.app.domain

import com.lifeos.app.data.api.AgendaItemDto
import com.lifeos.app.data.api.GoalDto
import com.lifeos.app.data.api.GoalTierDto
import com.lifeos.app.data.api.HabitWithTodayDto
import com.lifeos.app.data.api.TaskDto

/**
 * Pictures on habits, tasks, goals and rarity tiers — resolved exactly once.
 *
 * Ported from `packages/shared/src/art.ts` (`resolveArt`, `MIN_ART_OVERLAY`,
 * `DEFAULT_ART_OVERLAY`) and `tasks.ts` (`cardImages`), with the same
 * precedence and the same clamp. **Copied, not imported** — this folder is a
 * standalone Gradle build (see the isolation contract in the README) — so it is
 * a copy that something has to keep honest, which is what `ArtTest` is for.
 *
 * Two slots, never interchangeable:
 *
 *  - **icon** — what marks the thing in a list. Square, drawn where the emoji
 *    would go.
 *  - **background** — what the thing is *about*. Landscape, cover-cropped,
 *    always under a scrim.
 *
 * Both are optional everywhere and **no art is the normal case, not a
 * fallback**: a habit with neither field renders exactly as it did before any
 * of this existed, which is the shape most of them should stay.
 */

/**
 * One picture to draw, plus the key it is cached under.
 *
 * The key is the reason this type exists rather than a bare `String`. The
 * inline forms of these pictures are base64 `data:` URIs that ride along in
 * the dashboard payload, and that payload arrives **every eight seconds**.
 * Keyed on the source text, the cache would hash a few hundred kilobytes of
 * base64 per picture per poll before discovering it already had the bitmap; and
 * a cache miss would decode the image again, which is a dropped frame on the
 * one list the user looks at every morning.
 *
 * So the key is `<item id>/<slot>/<fingerprint>` and the fingerprint is the
 * data's *length and hash*, never the data. Short, cheap to compare, stable
 * across polls that carry the same picture, and different the moment the agent
 * changes one.
 */
data class ArtPicture(
    /** What the loader fetches: an `http(s)://` URL or a `data:` URI. */
    val source: String,
    val cacheKey: String,
)

/**
 * An agent's inline SVG, as a picture.
 *
 * Its own type so that it can only ever reach the SVG decoder — the markup is
 * decoded to a bitmap and handed to `Image`, and there is nothing anywhere in
 * this app that could execute it, fetch from it or navigate to it. The server
 * sanitises it hard before it is ever stored (`docs/API.md`, "SVG sanitizing"),
 * and this is the second half of that bargain: even a vector the sanitiser
 * missed has no interpreter to reach on this side.
 */
data class ArtSvg(
    val svg: String,
    val cacheKey: String,
)

/** What a card actually draws: up to two pictures and the scrim's strength. */
data class ResolvedArt(
    val icon: ArtPicture?,
    val background: ArtPicture?,
    /** Already clamped. A renderer draws this; it does not get to re-decide it. */
    val overlay: Float,
) {
    /** True when there is any picture at all. */
    val hasArt: Boolean get() = icon != null || background != null

    companion object {
        val NONE = ResolvedArt(icon = null, background = null, overlay = Art.DEFAULT_OVERLAY)
    }
}

object Art {

    /**
     * The floor is the point.
     *
     * A habit whose name cannot be read over its own photograph is a broken
     * row, not a style choice, and an agent asking for a lighter scrim has made
     * a mistake it cannot see from where it sits. `MIN_ART_OVERLAY` in art.ts.
     */
    const val MIN_OVERLAY = 0.35f

    /** `DEFAULT_ART_OVERLAY` in art.ts — what a null `artOverlay` means. */
    const val DEFAULT_OVERLAY = 0.58f

    /** A scrim at 1 is not a photograph, it is a black rectangle. */
    const val MAX_OVERLAY = 0.92f

    /**
     * `resolveCardStyle`'s default in card-style.ts.
     *
     * An agent card's picture is atmosphere behind a block of body text rather
     * than behind one title line, so it sits a little darker. The native client
     * deliberately implements **one** card layout — the legible one — rather
     * than the four-word `layout` vocabulary; see §4.5.
     */
    const val DEFAULT_CARD_OVERLAY = 0.62f

    /* --------------------------------------------------------------- slots */

    const val SLOT_ICON = "icon"
    const val SLOT_BACKGROUND = "bg"
    const val SLOT_MEDIA = "media"
    const val SLOT_SVG = "svg"

    /**
     * Clamp whatever the agent sent, including nothing.
     *
     * A value that is not a number — which `artOverlay: NaN` is, and which an
     * older or newer server could produce — reads as "nobody chose" rather than
     * as zero. Zero would mean no scrim, which is the one answer that is never
     * allowed.
     */
    fun overlay(raw: Double?, default: Float = DEFAULT_OVERLAY): Float {
        if (raw == null || raw.isNaN() || raw.isInfinite()) return default
        return raw.toFloat().coerceIn(MIN_OVERLAY, MAX_OVERLAY)
    }

    /**
     * The fingerprint of a source, for the cache key.
     *
     * A `data:` URI collapses to its length and hash: the point is that the key
     * is small and that comparing two keys never walks a base64 payload. A URL
     * is already short, already stable and already identifies the bytes, so it
     * is kept as it is — a key that can be read in a log is worth something,
     * and a URL is not a secret (the token never appears in one).
     */
    fun fingerprint(source: String): String =
        if (source.startsWith("data:")) {
            "d${source.length}.${source.hashCode().toUInt().toString(16)}"
        } else {
            "u$source"
        }

    /**
     * `<id>/<slot>/<fingerprint>` — stable while the picture is, new when it
     * changes.
     *
     * The slot is in the key because one item carries two pictures and they are
     * not interchangeable: without it a goal whose icon and background were the
     * same file would get one cache entry sized for whichever box asked first.
     */
    fun cacheKey(id: String, slot: String, source: String): String =
        "$id/$slot/${fingerprint(source)}"

    /**
     * One slot, resolved. **Inline data wins over a URL**, per slot
     * independently: the data is already on the device and cannot fail to load,
     * which is the whole reason an agent is allowed to inline it.
     */
    fun picture(id: String, slot: String, data: String?, url: String?): ArtPicture? {
        val source = data?.takeIf { it.isNotBlank() } ?: url?.takeIf { it.isNotBlank() } ?: return null
        return ArtPicture(source = source, cacheKey = cacheKey(id, slot, source))
    }

    /**
     * An inline SVG, resolved.
     *
     * Blank markup is no artwork rather than an empty graphic box — the server
     * already treats a sanitised-to-nothing `<svg></svg>` that way, and a client
     * that drew it anyway would put a hole in the card.
     */
    fun svg(id: String, svg: String?): ArtSvg? {
        val markup = svg?.trim()?.takeIf { it.isNotEmpty() } ?: return null
        return ArtSvg(svg = markup, cacheKey = cacheKey(id, SLOT_SVG, "data:$markup"))
    }

    /* ------------------------------------------------------- per DTO shape */

    fun of(habit: HabitWithTodayDto?): ResolvedArt {
        if (habit == null) return ResolvedArt.NONE
        return ResolvedArt(
            icon = picture(habit.id, SLOT_ICON, habit.iconImageData, habit.iconImageUrl),
            background = picture(habit.id, SLOT_BACKGROUND, habit.backgroundImageData, habit.backgroundImageUrl),
            overlay = overlay(habit.artOverlay),
        )
    }

    fun of(goal: GoalDto): ResolvedArt = ResolvedArt(
        icon = picture(goal.id, SLOT_ICON, goal.iconImageData, goal.iconImageUrl),
        background = picture(goal.id, SLOT_BACKGROUND, goal.backgroundImageData, goal.backgroundImageUrl),
        overlay = overlay(goal.artOverlay),
    )

    fun of(tier: GoalTierDto): ResolvedArt = ResolvedArt(
        icon = picture(tier.id, SLOT_ICON, tier.iconImageData, tier.iconImageUrl),
        background = picture(tier.id, SLOT_BACKGROUND, tier.backgroundImageData, tier.backgroundImageUrl),
        overlay = overlay(tier.artOverlay),
    )

    /**
     * A task card's two pictures — `cardImages` in tasks.ts.
     *
     * The field names differ from a habit's and that is the server's model, not
     * a slip: a task's `imageUrl`/`imageData` is the card's *media*, which this
     * client draws in the background slot because that is the arrangement that
     * keeps the body text readable.
     */
    fun of(task: TaskDto): ResolvedArt = ResolvedArt(
        icon = picture(task.id, SLOT_ICON, task.iconImageData, task.iconImageUrl),
        background = picture(task.id, SLOT_MEDIA, task.imageData, task.imageUrl),
        overlay = overlay(task.artOverlay, default = DEFAULT_CARD_OVERLAY),
    )

    /**
     * An agenda row's art: the habit's if the row has one, else what the server
     * already resolved onto the row.
     *
     * The precedence is deliberate and it is the same one the web client uses.
     * `AgendaItem.iconImage` is a **pre-resolved icon only** — a row never
     * carries a background, because `data.habits` already carries it and
     * copying a `data:` URI onto every agenda item would resend the same
     * picture on every poll. So a habit row gets the habit's full art, and a
     * task row gets the one icon the server resolved for it.
     */
    fun of(item: AgendaItemDto, habit: HabitWithTodayDto?): ResolvedArt {
        val fromHabit = of(habit)
        if (fromHabit.hasArt) return fromHabit
        return ResolvedArt(
            icon = picture(item.id, SLOT_ICON, item.iconImage, null),
            background = null,
            overlay = DEFAULT_OVERLAY,
        )
    }

    /**
     * What a celebration draws — the rung's art if the rung has any, else the
     * goal's.
     *
     * Per *object*, not per slot: a tier that supplies a background and no icon
     * is making a statement about that rung, and filling the gap from the goal
     * would mix two pictures that were never meant to sit together. Same rule
     * as [Celebrations], which takes the title and the emoji the same way.
     */
    fun forCelebration(goal: GoalDto): ResolvedArt {
        val tier = goal.pendingTier ?: goal.currentTier
        val fromTier = tier?.let(::of) ?: ResolvedArt.NONE
        return if (fromTier.hasArt) fromTier else of(goal)
    }
}
