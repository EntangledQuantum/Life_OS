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

    /* ------------------------------------------------- guaranteed contrast */

    /**
     * The palest thing we draw over a picture, as WCAG relative luminance.
     *
     * `muted` (`#A8A3B4`) — the sub-line. It is the hardest case on the card:
     * the title is near-white and the XP is `#34D399`, and both have more room
     * against a dark background than this does. Sizing the scrim for the
     * weakest text means every other line clears the bar as a side effect.
     */
    const val WEAKEST_TEXT_LUMINANCE = 0.3779

    /** WCAG AA for body text. Not 3:1 — the sub-line is 13sp, which is not large. */
    const val TEXT_CONTRAST = 4.5

    /**
     * How far past the threshold the search actually aims.
     *
     * A bisection converges *onto* the line, and the panel then quantises the
     * blend to 8 bits per channel, which costs a few thousandths of a ratio —
     * enough to land a result computed at exactly 4.50 on 4.495 once it is
     * drawn. Aiming slightly past it means the pixels a person looks at clear
     * the bar, rather than the arithmetic clearing it.
     */
    private const val QUANTISATION_MARGIN = 0.1

    /** `#07080C`, the scrim's own colour, as sRGB fractions. */
    private val SCRIM = doubleArrayOf(7 / 255.0, 8 / 255.0, 12 / 255.0)

    /** sRGB transfer function, 0–255 to linear light. */
    fun toLinear(channel: Int): Double {
        val v = channel.coerceIn(0, 255) / 255.0
        return if (v <= 0.04045) v / 12.92 else Math.pow((v + 0.055) / 1.055, 2.4)
    }

    /** The inverse, linear light back to an sRGB fraction. */
    private fun toSrgb(linear: Double): Double {
        val v = linear.coerceIn(0.0, 1.0)
        return if (v <= 0.0031308) v * 12.92 else 1.055 * Math.pow(v, 1 / 2.4) - 0.055
    }

    /** WCAG relative luminance from linear-light channels. */
    fun luminance(rLinear: Double, gLinear: Double, bLinear: Double): Double =
        0.2126 * rLinear + 0.7152 * gLinear + 0.0722 * bLinear

    /**
     * How dark the scrim over *this particular picture* has to be.
     *
     * A fixed percentage cannot promise anything. 35% over a dark photograph is
     * more than enough and 35% over a blown-out one leaves white text on a white
     * sky — which is what shipped, and it was only ever correct by luck. §4.5's
     * rule is absolute, so this measures instead of hoping: take the picture's
     * mean luminance, composite the scrim over it, and darken until the palest
     * text on the card clears [TEXT_CONTRAST] against the result.
     *
     * [floor] is the agent's `artOverlay`. It is a **floor and never a cap**: an
     * agent may ask for a darker picture than legibility requires, and may not
     * ask for a lighter one. That asymmetry is the whole rule — an agent cannot
     * see the device the text will be read on, and a row whose name cannot be
     * read is broken however it was configured.
     *
     * Pure arithmetic on three numbers, so the thing that decides whether a card
     * is readable is a thing a test can check.
     */
    fun scrimAlpha(meanLinear: DoubleArray, floor: Float): Float {
        if (meanLinear.size < 3) return floor
        val picture = DoubleArray(3) { toSrgb(meanLinear[it]) }
        if (clears(picture, floor.toDouble())) return floor

        // Monotonic in alpha — a darker scrim never lowers the contrast — so a
        // bisection finds the lightest scrim that is still legible.
        var light = floor.toDouble()
        var dark = MAX_OVERLAY.toDouble()
        if (!clears(picture, dark)) return MAX_OVERLAY
        repeat(16) {
            val mid = (light + dark) / 2
            if (clears(picture, mid)) dark = mid else light = mid
        }
        return dark.toFloat().coerceIn(floor, MAX_OVERLAY)
    }

    private fun clears(picture: DoubleArray, alpha: Double): Boolean {
        val composited = DoubleArray(3) { alpha * SCRIM[it] + (1 - alpha) * picture[it] }
        val background = luminance(
            toLinearFraction(composited[0]),
            toLinearFraction(composited[1]),
            toLinearFraction(composited[2]),
        )
        val ratio = (WEAKEST_TEXT_LUMINANCE + 0.05) / (background + 0.05)
        return ratio >= TEXT_CONTRAST + QUANTISATION_MARGIN
    }

    private fun toLinearFraction(v: Double): Double {
        val c = v.coerceIn(0.0, 1.0)
        return if (c <= 0.04045) c / 12.92 else Math.pow((c + 0.055) / 1.055, 2.4)
    }

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
