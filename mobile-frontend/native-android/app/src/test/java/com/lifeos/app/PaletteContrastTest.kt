package com.lifeos.app

import androidx.compose.ui.graphics.Color
import com.lifeos.app.ui.theme.Palette
import com.lifeos.app.ui.theme.Palettes
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import kotlin.math.abs
import kotlin.math.pow

/**
 * Contrast, as a test over the palette table rather than a manual check (§6.4).
 *
 * "Every pairing must hold 4.5:1 for body text and 3:1 for 17sp+ and for the
 * active navigation indicator against its surface. A new palette ships only with
 * a passing contrast test." This is that test, so a ninth palette cannot be added
 * by eye.
 */
class PaletteContrastTest {

    /** WCAG relative luminance. */
    private fun luminance(color: Color): Double {
        fun channel(v: Float): Double {
            val c = v.toDouble()
            return if (c <= 0.03928) c / 12.92 else ((c + 0.055) / 1.055).pow(2.4)
        }
        return 0.2126 * channel(color.red) +
            0.7152 * channel(color.green) +
            0.0722 * channel(color.blue)
    }

    private fun ratio(fg: Color, bg: Color): Double {
        val a = luminance(fg)
        val b = luminance(bg)
        val lighter = maxOf(a, b)
        val darker = minOf(a, b)
        return (lighter + 0.05) / (darker + 0.05)
    }

    private fun assertAtLeast(min: Double, fg: Color, bg: Color, what: String) {
        val r = ratio(fg, bg)
        assertTrue("$what is %.2f:1, needs $min:1".format(r), r >= min)
    }

    @Test
    fun `body text holds 4_5 to 1 on every surface in every palette`() {
        for (p in Palettes.all) {
            for ((name, surface) in surfaces(p)) {
                assertAtLeast(4.5, p.text, surface, "${p.id}: text on $name")
                // `muted` carries body copy too — the card subtitle, the pulse
                // explanation — so it is held to the same bar.
                assertAtLeast(4.5, p.muted, surface, "${p.id}: muted on $name")
            }
        }
    }

    @Test
    fun `large text and the active indicator hold 3 to 1`() {
        for (p in Palettes.all) {
            for ((name, surface) in surfaces(p)) {
                // The accent is the active navigation indicator and the pulse
                // word for "Stable", both 17sp+.
                assertAtLeast(3.0, p.accent, surface, "${p.id}: accent on $name")
                assertAtLeast(3.0, p.accent2, surface, "${p.id}: accent2 on $name")
                assertAtLeast(3.0, p.positive, surface, "${p.id}: positive on $name")
                assertAtLeast(3.0, p.warning, surface, "${p.id}: warning on $name")
                // The no-red rule's colour has to be legible, or a negative delta
                // becomes invisible rather than merely unalarming.
                assertAtLeast(3.0, p.neutralNeg, surface, "${p.id}: neutralNeg on $name")
            }
        }
    }

    @Test
    fun `faint is reserved for non-essential text and is not held to 4_5`() {
        // Stated as a test so nobody "fixes" `faint` into `muted` and loses the
        // third tier the card meta line depends on.
        for (p in Palettes.all) {
            val r = ratio(p.faint, p.bg)
            assertTrue("${p.id}: faint should still clear 3:1, is %.2f".format(r), r >= 3.0)
        }
    }

    @Test
    fun `the eight palettes are the eight palettes`() {
        assertEquals(8, Palettes.all.size)
        assertEquals(
            listOf("bloom", "quantum", "ember", "nebula", "tide", "terminal", "sunset", "amber"),
            Palettes.all.map { it.id },
        )
        // The default is the product's identity, not an alphabetical accident.
        assertEquals("bloom", Palettes.default.id)
        assertEquals("bloom", Palettes.byId(null).id)
        assertEquals("bloom", Palettes.byId("not-a-palette").id)
    }

    @Test
    fun `bloom carries the normative hex from the spec`() {
        val b = Palettes.bloom
        assertEquals(0xFF5FA2, b.accent.rgb())
        assertEquals(0xFFA0C9, b.accent2.rgb())
        assertEquals(0x0D0910, b.bg.rgb())
        assertEquals(0x1A1220, b.surface.rgb())
        assertEquals(0x241829, b.surface2.rgb())
    }

    @Test
    fun `the shared half of every palette really is shared`() {
        val reference = Palettes.bloom
        for (p in Palettes.all) {
            assertEquals("${p.id}: text", reference.text, p.text)
            assertEquals("${p.id}: muted", reference.muted, p.muted)
            assertEquals("${p.id}: faint", reference.faint, p.faint)
            assertEquals("${p.id}: positive", reference.positive, p.positive)
            assertEquals("${p.id}: warning", reference.warning, p.warning)
            assertEquals("${p.id}: neutralNeg", reference.neutralNeg, p.neutralNeg)
            assertEquals("${p.id}: border", reference.border, p.border)
            // `glow` is the palette's own accent at 12%.
            assertEquals("${p.id}: glow hue", p.accent.rgb(), p.glow.rgb())
            // Compose packs an sRGB colour's alpha into 8 bits, so 0.12 comes
            // back as 31/255. Compare within one step rather than exactly.
            assertTrue("${p.id}: glow alpha", abs(p.glow.alpha - 0.12f) < 1f / 255f)
        }
    }

    @Test
    fun `there is no light colour anywhere in the table`() {
        // Dark only. A reviewer finding a light background value should delete
        // it; this is that reviewer.
        for (p in Palettes.all) {
            for ((name, surface) in surfaces(p)) {
                assertTrue(
                    "${p.id}: $name is not dark",
                    luminance(surface) < 0.05,
                )
            }
        }
    }

    private fun surfaces(p: Palette) = listOf(
        "bg" to p.bg,
        "surface" to p.surface,
        "surface2" to p.surface2,
    )

    private fun Color.rgb(): Int {
        fun c(v: Float) = (v * 255f + 0.5f).toInt()
        return (c(red) shl 16) or (c(green) shl 8) or c(blue)
    }
}
