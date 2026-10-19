package com.lifeos.app.ui.theme

import androidx.compose.ui.graphics.Color

/**
 * A colour the **server** sent, parsed in one place.
 *
 * Every colour that arrives over the wire — a habit's `themeColor`, a goal's, a
 * timeline block's `color` — goes through this. One function, because the
 * alternative is what was here before: a hex-only parser used by the day
 * ribbon, the growth meter, the celebration and You, with no one place to fix
 * when the server turned out to send something else.
 *
 * And it does. This was found by looking at the widget on a home screen: the
 * server's "Unlogged" timeline block is `rgba(255,255,255,0.05)`, a CSS colour
 * string rather than a hex one. The old hex-only parser returned null for it,
 * every caller fell back to `palette.accent`, and the part of the day that had
 * **not** been recorded drew in the brightest colour in the theme — on the
 * widget *and* on Day's ribbon, where it had been wrong since that screen
 * shipped. A faint grey "nothing happened here" was rendering as the loudest
 * thing on the screen.
 *
 * Accepts `#rgb`, `#rrggbb`, `#aarrggbb`, `rgb(r, g, b)` and
 * `rgba(r, g, b, a)`. Returns null for anything else, so callers keep their
 * fallback — a colour this does not understand must cost one block's shade,
 * never the screen.
 */
fun serverColor(value: String?): Color? {
    val text = value?.trim() ?: return null
    if (text.isEmpty()) return null
    return if (text.startsWith("rgb", ignoreCase = true)) cssRgb(text) else hex(text)
}

private fun hex(value: String): Color? {
    val text = value.removePrefix("#")
    val full = when (text.length) {
        3 -> text.map { "$it$it" }.joinToString("")
        6, 8 -> text
        else -> return null
    }
    val parsed = full.toLongOrNull(16) ?: return null
    return if (full.length == 8) Color(parsed) else Color(parsed or 0xFF000000L)
}

/**
 * `rgb(r, g, b)` / `rgba(r, g, b, a)`.
 *
 * `a` is a 0–1 fraction in CSS, not a byte — `rgba(255,255,255,0.05)` is a 5%
 * white, and reading that `0.05` as an alpha byte would produce an invisible
 * colour rather than a faint one.
 */
private fun cssRgb(value: String): Color? {
    val inside = value.substringAfter('(', "").substringBefore(')', "")
    if (inside.isBlank()) return null
    val parts = inside.split(',').map { it.trim() }
    if (parts.size !in 3..4) return null

    val r = parts[0].toFloatOrNull()?.takeIf { it.isFinite() } ?: return null
    val g = parts[1].toFloatOrNull()?.takeIf { it.isFinite() } ?: return null
    val b = parts[2].toFloatOrNull()?.takeIf { it.isFinite() } ?: return null
    val a = if (parts.size == 4) parts[3].toFloatOrNull() ?: return null else 1f

    return Color(
        red = (r / 255f).coerceIn(0f, 1f),
        green = (g / 255f).coerceIn(0f, 1f),
        blue = (b / 255f).coerceIn(0f, 1f),
        alpha = a.coerceIn(0f, 1f),
    )
}
