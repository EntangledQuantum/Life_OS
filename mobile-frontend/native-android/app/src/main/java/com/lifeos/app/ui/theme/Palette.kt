package com.lifeos.app.ui.theme

import androidx.compose.ui.graphics.Color

/**
 * A theme swaps colours and nothing else (UI_SPEC §6.2).
 *
 * Fourteen colour fields and nothing else. This is enforced structurally rather
 * than by discipline: spacing, radii, the type scale, motion durations, leaf
 * thresholds and the seven activity colours live in separate objects with no
 * palette parameter, so a theme physically cannot reach them.
 *
 * Adding a non-colour field here is the mistake this class exists to prevent.
 */
data class Palette(
    val id: String,
    val label: String,
    val accent: Color,
    val accent2: Color,
    val bg: Color,
    val surface: Color,
    val surface2: Color,
    val border: Color,
    val text: Color,
    val muted: Color,
    val faint: Color,
    val positive: Color,
    val warning: Color,
    val neutralNeg: Color,
    val scrim: Color,
    val glow: Color,
)

/* The shared half of every palette. §6.4: text/muted/faint/positive/warning/
 * neutralNeg are the same in all eight, `border` is always white at 7%, and
 * `glow` is the palette's own accent at 12%. */
private val TEXT = Color(0xFFF6F4F8)
private val MUTED = Color(0xFFA8A3B4)
private val FAINT = Color(0xFF6E6A7C)

/** XP earned, positive deltas, and the "Improving" pulse. */
val POSITIVE = Color(0xFF34D399)

/** Overdue, stale, silenced, and the "Recovering" pulse. */
val WARNING = Color(0xFFFBBF24)

/**
 * Negative deltas, missed days and the "Drifting" pulse.
 *
 * The no-red rule lives here: a bad day is grey. Red (`#F87171`) is wired to
 * M3's `error` role and is reachable only from destructive confirmation.
 */
val NEUTRAL_NEG = Color(0xFF94A3B8)

private val BORDER = Color(0xFFFFFFFF).copy(alpha = 0.07f)
private val SCRIM = Color(0xFF060408).copy(alpha = 0.72f)

/** Destructive confirmation only. Never a bad day, a missed habit or a delta. */
val DESTRUCTIVE = Color(0xFFF87171)

private fun palette(
    id: String,
    label: String,
    accent: Long,
    accent2: Long,
    bg: Long,
    surface: Long,
    surface2: Long,
): Palette {
    val accentColor = Color(accent)
    return Palette(
        id = id,
        label = label,
        accent = accentColor,
        accent2 = Color(accent2),
        bg = Color(bg),
        surface = Color(surface),
        surface2 = Color(surface2),
        border = BORDER,
        text = TEXT,
        muted = MUTED,
        faint = FAINT,
        positive = POSITIVE,
        warning = WARNING,
        neutralNeg = NEUTRAL_NEG,
        scrim = SCRIM,
        glow = accentColor.copy(alpha = 0.12f),
    )
}

/**
 * The eight device-local palettes (§6.4), normative hex.
 *
 * Deliberately richer than the API's four `accentTheme` hues, and deliberately
 * *not* written from or to that server setting — the app's theme is the app's,
 * the server setting drives the website. Default `bloom`.
 */
object Palettes {
    val bloom = palette("bloom", "Bloom", 0xFFFF5FA2, 0xFFFFA0C9, 0xFF0D0910, 0xFF1A1220, 0xFF241829)
    val quantum = palette("quantum", "Quantum", 0xFFC77DFF, 0xFF8B6BFF, 0xFF0B0912, 0xFF171327, 0xFF211B33)
    val ember = palette("ember", "Ember", 0xFFFF7A6B, 0xFFFFC46B, 0xFF100B0B, 0xFF1E1414, 0xFF2A1C1A)
    val nebula = palette("nebula", "Nebula", 0xFF7C9CFF, 0xFFB69CFF, 0xFF090A12, 0xFF141728, 0xFF1D2134)
    val tide = palette("tide", "Tide", 0xFF2DD4BF, 0xFF38BDF8, 0xFF07100F, 0xFF0F1D1E, 0xFF16292B)
    val terminal = palette("terminal", "Terminal", 0xFF4ADE80, 0xFFA3E635, 0xFF080D0A, 0xFF111A15, 0xFF19261D)
    val sunset = palette("sunset", "Sunset", 0xFFFB923C, 0xFFF472B6, 0xFF0E0A08, 0xFF1B1410, 0xFF261B15)
    val amber = palette("amber", "Amber", 0xFFFFC857, 0xFFFF9E6B, 0xFF0E0C07, 0xFF1A160F, 0xFF251F15)

    /** The default is the product's identity, not an alphabetical accident. */
    val default = bloom

    val all: List<Palette> = listOf(bloom, quantum, ember, nebula, tide, terminal, sunset, amber)

    fun byId(id: String?): Palette = all.firstOrNull { it.id == id } ?: default
}
