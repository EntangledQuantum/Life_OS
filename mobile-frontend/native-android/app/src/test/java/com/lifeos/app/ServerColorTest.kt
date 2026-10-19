package com.lifeos.app

import androidx.compose.ui.graphics.Color
import com.lifeos.app.ui.theme.serverColor
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * Colours that arrive over the wire.
 *
 * This test exists because of a bug found by looking at the widget on a home
 * screen. The server sends its "Unlogged" timeline block as
 * `rgba(255,255,255,0.05)` — a CSS colour, not a hex one — and the app's only
 * parser was hex-only. It returned null, every caller fell back to
 * `palette.accent`, and the part of the day that had **not** been recorded drew
 * in the brightest colour in the theme. On the widget, and on Day's ribbon,
 * where it had been wrong since that screen shipped.
 *
 * A compile cannot catch that and a screenshot catches it only if you happen to
 * have an unlogged block. So it is pinned here.
 */
class ServerColorTest {

    @Test
    fun `the unlogged block parses, and is faint rather than loud`() {
        val colour = serverColor("rgba(255,255,255,0.05)")
        assertNotNull("rgba() must parse — this is what the server really sends", colour)
        val parsed = colour!!
        assertEquals(1f, parsed.red, 1e-3f)
        assertEquals(1f, parsed.green, 1e-3f)
        assertEquals(1f, parsed.blue, 1e-3f)
        // CSS alpha is a 0–1 fraction, not a byte. Reading 0.05 as a byte would
        // make this invisible instead of faint.
        assertEquals(0.05f, parsed.alpha, 1e-2f)
    }

    @Test
    fun `rgb without alpha is opaque`() {
        val colour = serverColor("rgb(110, 168, 255)")!!
        assertEquals(110f / 255f, colour.red, 1e-3f)
        assertEquals(168f / 255f, colour.green, 1e-3f)
        assertEquals(1f, colour.blue, 1e-3f)
        assertEquals(1f, colour.alpha, 1e-3f)
    }

    @Test
    fun `the three hex forms still work`() {
        // The activity colours and every themeColor are hex; this is the path
        // that was already working and must keep working.
        assertEquals(Color(0xFF6EA8FF), serverColor("#6EA8FF"))
        assertEquals(Color(0xFF6EA8FF), serverColor("6EA8FF"))
        assertEquals(Color(0xFFFFFFFF), serverColor("#fff"))
        assertEquals(Color(0x806EA8FF), serverColor("#806EA8FF"))
    }

    @Test
    fun `whitespace and spacing variants are tolerated`() {
        assertNotNull(serverColor("  #6EA8FF  "))
        assertNotNull(serverColor("rgba(255,255,255,0.05)"))
        assertNotNull(serverColor("rgba( 255 , 255 , 255 , 0.05 )"))
        assertNotNull(serverColor("RGBA(255,255,255,0.5)"))
    }

    @Test
    fun `anything unparseable is null so the caller keeps its fallback`() {
        // A colour this does not understand must cost one block's shade, never
        // the screen.
        assertNull(serverColor(null))
        assertNull(serverColor(""))
        assertNull(serverColor("   "))
        assertNull(serverColor("rebeccapurple"))
        assertNull(serverColor("#12345"))
        assertNull(serverColor("#ZZZZZZ"))
        assertNull(serverColor("rgb(1,2)"))
        assertNull(serverColor("rgba(1,2,3,4,5)"))
        assertNull(serverColor("rgb(a,b,c)"))
        assertNull(serverColor("rgb("))
    }

    @Test
    fun `out-of-range channels are clamped rather than wrapping`() {
        val colour = serverColor("rgba(300, -20, 128, 2.5)")!!
        assertEquals(1f, colour.red, 1e-3f)
        assertEquals(0f, colour.green, 1e-3f)
        assertEquals(1f, colour.alpha, 1e-3f)
    }
}
