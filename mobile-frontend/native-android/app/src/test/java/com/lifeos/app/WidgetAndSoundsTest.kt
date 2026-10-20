package com.lifeos.app

import com.lifeos.app.data.api.AgendaItemDto
import com.lifeos.app.data.api.DashboardTodayDto
import com.lifeos.app.data.api.TimelineBlockDto
import com.lifeos.app.domain.Predicates
import com.lifeos.app.domain.Ribbon
import com.lifeos.app.domain.WidgetTier
import com.lifeos.app.domain.WidgetTiers
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File
import java.nio.ByteBuffer
import java.nio.ByteOrder

/**
 * The widget's two decisions, and the committed audio.
 *
 * Both are things a compile cannot check and a screenshot checks only on the
 * one device in front of you: which content tier a box gets, and whether the
 * sounds in `res/raw` are the sounds the web client plays.
 */
class WidgetAndSoundsTest {

    /* ------------------------------------------------------ the tiers */

    @Test
    fun `a four by two box gets the ribbon but has no room for chips`() {
        // 366 x 203dp is the real 4x2 box on the test device.
        val tier = WidgetTiers.of(widthDp = 366f, heightDp = 203f)
        assertEquals(WidgetTier.FULL, tier)
        assertTrue(tier.showsRibbon)
        assertTrue(tier.showsTick)
        assertEquals(2, tier.agendaRows)
        /*
         * Measured, not guessed: on hardware the meter, ribbon and two agenda
         * rows come to about 180dp of the 203 available, so the chips had
         * nowhere to go and were being dropped by the Column overflowing. That
         * is the right outcome reached by accident; this makes it a decision.
         */
        assertFalse(tier.showsChips)
    }

    @Test
    fun `a four by three box gets the chips too`() {
        val tier = WidgetTiers.of(widthDp = 366f, heightDp = 300f)
        assertEquals(WidgetTier.TALL, tier)
        assertTrue(tier.showsRibbon)
        assertTrue(tier.showsChips)
        assertEquals(2, tier.agendaRows)
    }

    @Test
    fun `a short box drops the ribbon and the chips rather than clipping them`() {
        val tier = WidgetTiers.of(widthDp = 320f, heightDp = 120f)
        assertEquals(WidgetTier.WIDE_SHORT, tier)
        // §8.5: "below ~150dp tall, drop the ribbon and the chips rather than
        // clipping them."
        assertFalse(tier.showsRibbon)
        assertFalse(tier.showsChips)
        // The tick still fits, so the row is still completable.
        assertTrue(tier.showsTick)
        assertEquals(1, tier.agendaRows)
    }

    @Test
    fun `the smallest box has no tick at all`() {
        val tier = WidgetTiers.of(widthDp = 150f, heightDp = 150f)
        assertEquals(WidgetTier.COMPACT, tier)
        /*
         * Open question #8, decided: a launcher cell is small and a mis-tap
         * completes a habit. Opening the app is recoverable; a wrongly completed
         * habit corrupts a streak, so the row opens the app instead.
         */
        assertFalse(tier.showsTick)
    }

    @Test
    fun `the tier is read from the box and nothing else`() {
        // Same height, different widths: the launcher's box is the only input,
        // because it changes per device, per cell count and after every resize.
        assertEquals(WidgetTier.COMPACT, WidgetTiers.of(219f, 400f))
        assertEquals(WidgetTier.TALL, WidgetTiers.of(220f, 400f))
        assertEquals(WidgetTier.WIDE_SHORT, WidgetTiers.of(220f, 149f))
        assertEquals(WidgetTier.FULL, WidgetTiers.of(220f, 150f))
        assertEquals(WidgetTier.FULL, WidgetTiers.of(220f, 229f))
        assertEquals(WidgetTier.TALL, WidgetTiers.of(220f, 230f))
        // A zero-sized box during a launcher reload must not throw.
        assertEquals(WidgetTier.COMPACT, WidgetTiers.of(0f, 0f))
    }

    @Test
    fun `width wins over height, so a tall narrow box is still compact`() {
        // There is no room for a figure beside the ring below ~220dp, however
        // tall the box is.
        assertEquals(WidgetTier.COMPACT, WidgetTiers.of(150f, 600f))
        assertFalse(WidgetTiers.of(150f, 600f).showsTick)
    }

    /* ----------------------------------------------------- the ribbon */

    private val blocks = listOf(
        TimelineBlockDto(
            id = "sleep",
            category = "Sleep",
            startHour = 0.0,
            endHour = 7.0,
            color = "#5C6BC0",
            actual = true,
        ),
        TimelineBlockDto(
            id = "work",
            category = "Deep Work",
            startHour = 9.0,
            endHour = 12.0,
            color = "#6EA8FF",
            actual = true,
            status = "done",
        ),
        TimelineBlockDto(
            id = "study",
            category = "Study",
            startHour = 20.0,
            endHour = 22.0,
            color = "#B57BFF",
            actual = false,
        ),
    )

    @Test
    fun `the quantised ribbon has exactly the cells asked for`() {
        assertEquals(24, Ribbon.cells(blocks, 24, 0.5f).size)
        assertEquals(48, Ribbon.cells(blocks, 48, 0.5f).size)
        assertTrue(Ribbon.cells(blocks, 0, 0.5f).isEmpty())
    }

    @Test
    fun `a cell takes the colour of the block covering it`() {
        val cells = Ribbon.cells(blocks, 24, nowFraction = 0.99f)
        // Hour 3 is inside sleep, hour 10 inside work, hour 21 inside study.
        assertEquals("#5C6BC0", cells[3].colorHex)
        assertEquals("#6EA8FF", cells[10].colorHex)
        assertEquals("#B57BFF", cells[21].colorHex)
        // Hour 8 is covered by nothing: an empty track, not a gap.
        assertNull(cells[8].colorHex)
    }

    @Test
    fun `lived, planned and done survive the quantisation`() {
        val cells = Ribbon.cells(blocks, 24, nowFraction = 0.99f)
        assertTrue(cells[3].actual)
        assertTrue(cells[10].done)
        assertFalse(cells[21].actual)
    }

    @Test
    fun `the now-marker lands in the cell the clock is in`() {
        // 13:00 of 24h = 0.5417 → cell 13.
        val cells = Ribbon.cells(blocks, 24, nowFraction = 13f / 24f)
        assertEquals(1, cells.count { it.isNow })
        assertTrue(cells[13].isNow)
    }

    @Test
    fun `the marker stays inside the ribbon at both ends of the day`() {
        // Midnight and the last instant before it: an out-of-range index here
        // would be an exception on a home screen, which is unrecoverable.
        assertTrue(Ribbon.cells(blocks, 24, 0f)[0].isNow)
        assertTrue(Ribbon.cells(blocks, 24, 1f)[23].isNow)
        assertEquals(1, Ribbon.cells(blocks, 24, 1.4f).count { it.isNow })
    }

    @Test
    fun `the widget's ribbon is the same ribbon Day draws`() {
        /*
         * `cells` reads `segments`, so a server that moves a block moves both
         * surfaces. This asserts the shared derivation rather than the
         * coincidence of two similar-looking numbers.
         */
        val segments = Ribbon.segments(blocks)
        val cells = Ribbon.cells(blocks, 24, 0.99f)
        val coveredHours = (0 until 24).count { cells[it].colorHex != null }
        val segmentHours = segments.sumOf { Math.round(it.width * 24.0).toInt() }
        assertEquals(segmentHours, coveredHours)
    }

    /* ------------------------------------------------------- up next */

    @Test
    fun `up next takes the server's order and skips what is done`() {
        val data = DashboardTodayDto(
            agenda = listOf(
                AgendaItemDto(id = "a", title = "Done thing", done = true),
                AgendaItemDto(id = "b", title = "Next thing"),
                AgendaItemDto(id = "c", title = "Later thing"),
                AgendaItemDto(id = "d", title = "Later still"),
            ),
        )
        assertEquals(listOf("b", "c"), Predicates.upNext(data, 2).map { it.id })
        assertEquals(listOf("b"), Predicates.upNext(data, 1).map { it.id })
        assertTrue(Predicates.upNext(data, 0).isEmpty())
    }

    /* ------------------------------------------------------- the WAVs */

    /**
     * Durations implied by the note tables in `scripts/build-sounds.mjs`, which
     * are copies of the tables in `apps/web/src/lib/notify.ts`:
     * `max(at + dur) + 0.05` of tail.
     */
    private val expectedSeconds = mapOf(
        "chime" to 0.55,
        "bell" to 1.55,
        "marimba" to 0.69,
        "pulse" to 0.29,
        "alert" to 0.77,
    )

    @Test
    fun `every sound id has a committed file in res raw`() {
        /*
         * A build must not depend on having run the generator, so this fails
         * when a file is missing rather than when someone forgets to run a
         * script. It also catches the opposite mistake: a `SoundId` added
         * without its audio, which would be a channel with a sound URI that
         * does not resolve — silent, with nothing in the log.
         */
        for (id in expectedSeconds.keys) {
            val file = raw("$id.wav")
            assertTrue("missing res/raw/$id.wav — run node scripts/build-sounds.mjs", file.isFile)
            assertTrue(file.length() > 1000)
        }
    }

    @Test
    fun `each file is the 16-bit mono PCM Android is happiest with`() {
        for (id in expectedSeconds.keys) {
            val bytes = raw("$id.wav").readBytes()
            val buffer = ByteBuffer.wrap(bytes).order(ByteOrder.LITTLE_ENDIAN)

            assertEquals("RIFF", String(bytes, 0, 4))
            assertEquals("WAVE", String(bytes, 8, 4))
            assertEquals("fmt ", String(bytes, 12, 4))
            assertEquals(1, buffer.getShort(20).toInt()) // PCM, uncompressed
            assertEquals(1, buffer.getShort(22).toInt()) // mono
            assertEquals(44100, buffer.getInt(24))
            assertEquals(16, buffer.getShort(34).toInt())
            assertEquals("data", String(bytes, 36, 4))
            // The declared data size is the real one; a truncated file plays as
            // a click.
            assertEquals(bytes.size - 44, buffer.getInt(40))
        }
    }

    @Test
    fun `each file is as long as its note table says`() {
        /*
         * This is what pins the committed audio to the shared design. Change a
         * note table in `apps/web/src/lib/notify.ts` without re-running the
         * generator and this fails — which is the point, because a stale
         * `res/raw` means "chime" is no longer the same chime on both surfaces.
         *
         * A frame of tolerance: the renderer's `ceil` lands on either side of a
         * sample boundary depending on floating-point addition, and that is not
         * a drifted design.
         */
        for ((id, seconds) in expectedSeconds) {
            val bytes = raw("$id.wav").readBytes()
            val frames = (bytes.size - 44) / 2
            val actual = frames / 44100.0
            assertEquals("$id.wav duration", seconds, actual, 0.01)
        }
    }

    /**
     * `res/raw`, whichever directory the test runner starts in.
     *
     * AGP runs unit tests from the module directory, but that is a default
     * rather than a promise, and a test that silently passes because it could
     * not find the files would be worse than no test.
     */
    private fun raw(name: String): File {
        val candidates = listOf(
            File("src/main/res/raw/$name"),
            File("app/src/main/res/raw/$name"),
            File("../app/src/main/res/raw/$name"),
        )
        return candidates.firstOrNull { it.isFile } ?: candidates.first()
    }
}
