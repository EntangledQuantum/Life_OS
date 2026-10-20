package com.lifeos.app

import com.lifeos.app.data.api.AgendaItemDto
import com.lifeos.app.data.api.GoalDto
import com.lifeos.app.data.api.GoalTierDto
import com.lifeos.app.data.api.HabitWithTodayDto
import com.lifeos.app.data.api.TaskDto
import com.lifeos.app.domain.Art
import com.lifeos.app.domain.Celebrations
import com.lifeos.app.domain.GoalOrder
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Art resolution and the cache key.
 *
 * Two things are being defended. The first is **precedence**: `Art` is a
 * hand-copied port of `packages/shared/src/art.ts` and `tasks.ts` (this app
 * imports nothing from the workspace), and a copy that silently drifts is worse
 * than no copy — the two surfaces would disagree about which picture is the icon
 * and nothing would fail, it would just look wrong on one device.
 *
 * The second is the **key**, which is a performance contract and therefore the
 * kind of thing a screenshot cannot show. The art arrives as base64 inside a
 * payload that is re-fetched every eight seconds. If the key moved when the
 * picture had not, every row would re-decode its image six hundred times an
 * hour; if the key did not move when the picture did, an agent could never
 * change a habit's artwork.
 */
class ArtTest {

    private val icon = "data:image/png;base64,ICONICONICON"
    private val background = "data:image/jpeg;base64,BACKGROUNDBG"

    private fun habit(
        id: String = "h1",
        iconUrl: String? = null,
        iconData: String? = null,
        bgUrl: String? = null,
        bgData: String? = null,
        overlay: Double? = null,
    ) = HabitWithTodayDto(
        id = id,
        name = "Read",
        emoji = "📖",
        iconImageUrl = iconUrl,
        iconImageData = iconData,
        backgroundImageUrl = bgUrl,
        backgroundImageData = bgData,
        artOverlay = overlay,
    )

    /* ----------------------------------------------------------- precedence */

    @Test
    fun `no art is the normal case, not a failure`() {
        val art = Art.of(habit())
        assertNull(art.icon)
        assertNull(art.background)
        assertFalse(art.hasArt)
        // And it still hands the renderer a scrim it could draw, so there is no
        // branch anywhere that has to cope with "no overlay".
        assertEquals(Art.DEFAULT_OVERLAY, art.overlay, 0f)
    }

    @Test
    fun `a null habit resolves rather than throwing`() {
        // Every agenda row calls this, and a task row has no habit at all.
        assertFalse(Art.of(null as HabitWithTodayDto?).hasArt)
    }

    @Test
    fun `inline data wins over a URL, per slot independently`() {
        val art = Art.of(
            habit(
                iconUrl = "http://server/icon.png",
                iconData = icon,
                bgUrl = "http://server/bg.jpg",
                bgData = background,
            ),
        )
        // The data is already on the device and cannot fail to load, which is
        // the whole reason an agent is allowed to inline it.
        assertEquals(icon, art.icon?.source)
        assertEquals(background, art.background?.source)
    }

    @Test
    fun `a URL is used when there is no inline data`() {
        val art = Art.of(habit(iconUrl = "http://server/icon.png", bgUrl = "http://server/bg.jpg"))
        assertEquals("http://server/icon.png", art.icon?.source)
        assertEquals("http://server/bg.jpg", art.background?.source)
    }

    @Test
    fun `blank is not a picture`() {
        // A server that stores "" rather than null must not produce a request
        // for the empty string, which would fail and blank the emoji.
        val art = Art.of(habit(iconData = "  ", iconUrl = "", bgData = ""))
        assertFalse(art.hasArt)
    }

    @Test
    fun `an icon never becomes the background, and vice versa`() {
        val iconOnly = Art.of(habit(iconData = icon))
        assertNull(iconOnly.background)
        assertTrue(iconOnly.hasArt)

        val bgOnly = Art.of(habit(bgData = background))
        assertNull(bgOnly.icon)
        assertTrue(bgOnly.hasArt)
    }

    /* --------------------------------------------------------------- scrim */

    @Test
    fun `the scrim cannot be turned off`() {
        /*
         * The floor is the point. A habit whose name cannot be read over its own
         * photograph is a broken row, not a style choice, and an agent asking
         * for one has made a mistake it cannot see from where it sits.
         */
        assertEquals(Art.MIN_OVERLAY, Art.overlay(0.0), 0f)
        assertEquals(Art.MIN_OVERLAY, Art.overlay(-5.0), 0f)
    }

    @Test
    fun `the scrim cannot be turned up to opaque either`() {
        // A scrim at 1 is not a photograph, it is a black rectangle.
        assertEquals(Art.MAX_OVERLAY, Art.overlay(1.0), 0f)
    }

    @Test
    fun `a value that is not a number reads as nobody chose`() {
        assertEquals(Art.DEFAULT_OVERLAY, Art.overlay(null), 0f)
        assertEquals(Art.DEFAULT_OVERLAY, Art.overlay(Double.NaN), 0f)
        assertEquals(Art.DEFAULT_OVERLAY, Art.overlay(Double.POSITIVE_INFINITY), 0f)
    }

    @Test
    fun `a value inside the range is respected`() {
        assertEquals(0.7f, Art.overlay(0.7), 0.0001f)
    }

    @Test
    fun `an agent card sits a little darker than a habit row`() {
        // card-style.ts's default, because a card has a block of body text over
        // the picture rather than one title line.
        val card = Art.of(TaskDto(id = "t1", imageData = background))
        assertEquals(Art.DEFAULT_CARD_OVERLAY, card.overlay, 0f)
        assertTrue(Art.DEFAULT_CARD_OVERLAY > Art.DEFAULT_OVERLAY)
    }

    @Test
    fun `the floor and the default match the shared contract`() {
        // MIN_ART_OVERLAY and DEFAULT_ART_OVERLAY in packages/shared/src/art.ts.
        assertEquals(0.35f, Art.MIN_OVERLAY, 0f)
        assertEquals(0.58f, Art.DEFAULT_OVERLAY, 0f)
        assertEquals(0.92f, Art.MAX_OVERLAY, 0f)
        assertEquals(0.62f, Art.DEFAULT_CARD_OVERLAY, 0f)
    }

    /* ----------------------------------------------------------- the key */

    @Test
    fun `the key does not contain the base64 payload`() {
        /*
         * The reason this type exists. A `data:` URI is hundreds of kilobytes;
         * keyed on itself, every cache lookup walks all of it — on every row, on
         * every one of the eight-second polls — before discovering the bitmap
         * was already there.
         */
        val long = "data:image/png;base64," + "Q".repeat(50_000)
        val key = Art.cacheKey("h1", Art.SLOT_ICON, long)
        assertFalse(key.contains("QQQQ"))
        assertTrue("the key must stay small: was ${key.length}", key.length < 80)
    }

    @Test
    fun `the key is stable across polls that carry the same picture`() {
        // The same payload twice is the same key, so the request `remember`s and
        // the row cannot blink.
        val first = Art.of(habit(iconData = icon)).icon
        val second = Art.of(habit(iconData = icon)).icon
        assertEquals(first?.cacheKey, second?.cacheKey)
    }

    @Test
    fun `the key moves when the agent changes the picture`() {
        val before = Art.of(habit(iconData = icon)).icon!!.cacheKey
        val after = Art.of(habit(iconData = "data:image/png;base64,SOMETHINGELSE")).icon!!.cacheKey
        assertNotEquals(before, after)
    }

    @Test
    fun `the key separates the two slots of one item`() {
        // Otherwise an item whose icon and background are the same file gets one
        // cache entry, sized for whichever box asked first.
        val same = "data:image/png;base64,SAME"
        val art = Art.of(habit(iconData = same, bgData = same))
        assertNotEquals(art.icon!!.cacheKey, art.background!!.cacheKey)
    }

    @Test
    fun `the key separates two items that share a picture`() {
        val same = "data:image/png;base64,SAME"
        val one = Art.of(habit(id = "h1", iconData = same)).icon!!.cacheKey
        val two = Art.of(habit(id = "h2", iconData = same)).icon!!.cacheKey
        assertNotEquals(one, two)
    }

    @Test
    fun `a data fingerprint uses length and hash, a URL stays itself`() {
        assertTrue(Art.fingerprint("data:image/png;base64,ABCD").startsWith("d26."))
        assertEquals("uhttp://server/i.png", Art.fingerprint("http://server/i.png"))
    }

    /* ------------------------------------------------------ the agenda row */

    private fun row(id: String = "habit:h1", habitId: String? = "h1", iconImage: String? = null) =
        AgendaItemDto(
            id = id,
            source = "habit",
            refId = habitId ?: "t1",
            title = "Read 20 pages",
            habitId = habitId,
            iconImage = iconImage,
        )

    @Test
    fun `a habit row takes the habit's own art, background included`() {
        val art = Art.of(row(), habit(iconData = icon, bgData = background))
        assertEquals(icon, art.icon?.source)
        assertEquals(background, art.background?.source)
    }

    @Test
    fun `a row with no habit art falls back to what the server resolved`() {
        // `AgendaItem.iconImage` is the server's pre-resolved icon — which is all
        // a task row has, because a row never carries a background.
        val art = Art.of(row(iconImage = icon), habit())
        assertEquals(icon, art.icon?.source)
        assertNull(art.background)
    }

    @Test
    fun `a task row has no habit at all and still resolves`() {
        val art = Art.of(row(id = "task:t1", habitId = null, iconImage = icon), null)
        assertEquals(icon, art.icon?.source)
        assertNull(art.background)
    }

    @Test
    fun `a row with nothing anywhere draws the emoji`() {
        assertFalse(Art.of(row(), habit()).hasArt)
    }

    /* ----------------------------------------------- goals, tiers, the svg */

    private fun tier(
        id: String,
        rank: Int,
        iconData: String? = null,
        bgData: String? = null,
        metAt: String? = null,
    ) = GoalTierDto(
        id = id,
        goalId = "g1",
        rank = rank,
        label = "Bronze",
        iconImageData = iconData,
        backgroundImageData = bgData,
        metAt = metAt,
        celebrationPending = metAt != null,
    )

    @Test
    fun `a goal carries the same two slots as a habit`() {
        val art = Art.of(GoalDto(id = "g1", iconImageData = icon, backgroundImageUrl = "http://s/b.jpg"))
        assertEquals(icon, art.icon?.source)
        assertEquals("http://s/b.jpg", art.background?.source)
    }

    @Test
    fun `a celebration prefers the rung's art over the goal's`() {
        val goal = GoalDto(
            id = "g1",
            iconImageData = icon,
            tiers = listOf(tier("t1", 1, iconData = "data:image/png;base64,RUNG", metAt = "2026-10-01")),
            pendingTier = tier("t1", 1, iconData = "data:image/png;base64,RUNG", metAt = "2026-10-01"),
        )
        assertEquals("data:image/png;base64,RUNG", Art.forCelebration(goal).icon?.source)
    }

    @Test
    fun `a rung with no art of its own celebrates with the goal's`() {
        /*
         * Per object, not per slot: a rung that supplies a background and no
         * icon is making a statement about that rung, and filling the gap from
         * the goal would mix two pictures never meant to sit together.
         */
        val goal = GoalDto(
            id = "g1",
            iconImageData = icon,
            pendingTier = tier("t1", 1, metAt = "2026-10-01"),
        )
        assertEquals(icon, Art.forCelebration(goal).icon?.source)
    }

    @Test
    fun `the celebration queue carries the art it will draw`() {
        val goal = GoalDto(
            id = "g1",
            title = "Read twelve books",
            emoji = "📚",
            celebrationPending = true,
            backgroundImageData = background,
        )
        val next = Celebrations.next(listOf(goal))!!
        assertEquals(background, next.art.background?.source)
    }

    @Test
    fun `a rung's picture reaches the ladder`() {
        val rung = tier("t1", 1, iconData = icon, metAt = "2026-10-01")
        val goal = GoalDto(id = "g1", tiers = listOf(rung), currentTier = rung)
        val rungs = GoalOrder.rungs(goal)
        assertEquals(icon, rungs.single().icon?.source)
        assertTrue(rungs.single().reached)
    }

    @Test
    fun `a goal with no tier art leaves the ladder's dots alone`() {
        val goal = GoalDto(id = "g1", tiers = listOf(tier("t1", 1)))
        assertNull(GoalOrder.rungs(goal).single().icon)
    }

    @Test
    fun `a task's two pictures keep the server's own field names apart`() {
        // `imageUrl`/`imageData` is the card's media; `iconImage*` is its mark.
        val art = Art.of(
            TaskDto(
                id = "t1",
                imageData = background,
                iconImageUrl = "http://s/mark.png",
            ),
        )
        assertEquals("http://s/mark.png", art.icon?.source)
        assertEquals(background, art.background?.source)
    }

    @Test
    fun `blank markup is no artwork rather than an empty graphic box`() {
        assertNull(Art.svg("t1", null))
        assertNull(Art.svg("t1", "   "))
    }

    @Test
    fun `an svg keeps its markup and gets a key of its own`() {
        val markup = "<svg viewBox=\"0 0 10 10\"><circle r=\"4\"/></svg>"
        val art = Art.svg("t1", "  $markup  ")!!
        assertEquals(markup, art.svg)
        assertTrue(art.cacheKey.startsWith("t1/${Art.SLOT_SVG}/"))
        // Same rule as a picture: the key is not the payload.
        assertFalse(art.cacheKey.contains("circle"))
    }

    @Test
    fun `an svg's key moves with its markup`() {
        val one = Art.svg("t1", "<svg><circle r=\"4\"/></svg>")!!.cacheKey
        val two = Art.svg("t1", "<svg><circle r=\"5\"/></svg>")!!.cacheKey
        assertNotEquals(one, two)
    }

    /* ------------------------------------------------- where the token goes */

    /**
     * The token rule, which is the one thing here that is a security property
     * rather than a look.
     *
     * A picture hosted on the user's own Life OS needs the bearer header or it
     * comes back `401`. A picture an agent linked from anywhere else must never
     * see it — and an agent is free to put any URL in that field.
     */
    @Test
    fun `the token goes to the configured origin`() {
        val origin = com.lifeos.app.data.art.ArtOrigin()
        origin.set("http://192.168.1.4:8787")
        assertTrue(origin.matches("http://192.168.1.4:8787/art/icon.png"))
        assertTrue(origin.matches("http://192.168.1.4:8787/a/b/c.jpg?v=2"))
    }

    @Test
    fun `the token goes nowhere else`() {
        val origin = com.lifeos.app.data.art.ArtOrigin()
        origin.set("http://192.168.1.4:8787")

        // A different port is a different server.
        assertFalse(origin.matches("http://192.168.1.4:9999/icon.png"))
        // A different host, however much of the configured one it contains.
        assertFalse(origin.matches("http://192.168.1.4.evil.example/icon.png"))
        // A lookalike that a prefix test on the text would have let through.
        assertFalse(origin.matches("http://192.168.1.4:8787.evil.example/icon.png"))
        // A different scheme is a different origin, and downgrades matter.
        assertFalse(origin.matches("https://192.168.1.4:8787/icon.png"))
        assertFalse(origin.matches("not a url at all"))
    }

    @Test
    fun `with no server configured the token goes nowhere`() {
        val origin = com.lifeos.app.data.art.ArtOrigin()
        assertFalse(origin.matches("http://192.168.1.4:8787/icon.png"))
        // And a disconnect takes it back out again.
        origin.set("http://192.168.1.4:8787")
        origin.set(null)
        assertFalse(origin.matches("http://192.168.1.4:8787/icon.png"))
    }
}
