package com.lifeos.app.ui.theme

import androidx.compose.foundation.LocalIndication
import androidx.compose.material3.ColorScheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.ripple
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.ProvidableCompositionLocal
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.compositeOver

/** The palette in scope. Feature code reads colour from here. */
val LocalPalette: ProvidableCompositionLocal<Palette> =
    staticCompositionLocalOf { Palettes.default }

/**
 * Whether motion is reduced — the OR of `settings.reducedMotion` and the OS
 * animator scale (§5.6). Provided once so no component re-derives it; see the
 * "one predicate" rule.
 */
val LocalReducedMotion: ProvidableCompositionLocal<Boolean> =
    staticCompositionLocalOf { false }

/** Layer a colour over another at an alpha, so §6.3's "@18% over surface" is literal. */
fun Color.over(base: Color, alpha: Float): Color = copy(alpha = alpha).compositeOver(base)

private fun Color.lift(amount: Float): Color =
    Color(
        red = (red + amount).coerceAtMost(1f),
        green = (green + amount).coerceAtMost(1f),
        blue = (blue + amount).coerceAtMost(1f),
        alpha = 1f,
    )

/**
 * §6.3: build a dark `ColorScheme` from the palette rather than exposing both to
 * feature code.
 *
 * Elevation in M3 dark is tonal, not shadow: surfaces step by colour
 * (`bg → surface → surface2`). The only shadow in the app is the FAB's.
 */
fun Palette.toColorScheme(): ColorScheme = darkColorScheme(
    primary = accent,
    onPrimary = bg,
    primaryContainer = accent.over(surface, 0.18f),
    onPrimaryContainer = text,
    secondary = accent2,
    onSecondary = bg,
    secondaryContainer = accent2.over(surface, 0.16f),
    onSecondaryContainer = text,
    tertiary = accent2,
    onTertiary = bg,
    background = bg,
    onBackground = text,
    surface = bg,
    onSurface = text,
    surfaceVariant = surface2,
    onSurfaceVariant = muted,
    surfaceContainerLowest = bg,
    surfaceContainerLow = surface,
    surfaceContainer = surface.lift(0.02f),
    surfaceContainerHigh = surface2,
    surfaceContainerHighest = surface2.lift(0.03f),
    outline = border,
    outlineVariant = border.copy(alpha = border.alpha * 0.5f),
    scrim = scrim,
    // Destructive confirmation only. Never a bad day, a missed habit, a broken
    // streak or a negative delta — those are `neutralNeg`.
    error = DESTRUCTIVE,
    onError = bg,
    errorContainer = DESTRUCTIVE.over(surface, 0.18f),
    onErrorContainer = text,
    inverseSurface = text,
    inverseOnSurface = bg,
)

/**
 * Dark only (§6.1). `isSystemInDarkTheme()` is never called, there is no
 * `values-night/`, and no dynamic colour (§6.5) — the accent is load-bearing art
 * that the growth meter, the bloom and the celebration are drawn from, and three
 * surfaces (phone, widget, web) have to agree on it.
 */
@Composable
fun LifeOsTheme(
    palette: Palette = Palettes.default,
    reducedMotion: Boolean = false,
    content: @Composable () -> Unit,
) {
    /*
     * **The press state for the whole app, provided once.**
     *
     * Material 3 1.3 decoupled the ripple from the theme: `MaterialTheme` no
     * longer provides `LocalIndication`, and a `clickable` that is not handed an
     * indication explicitly falls back to Foundation's
     * `DefaultDebugIndication` — a flat **black at 30%** rectangle on press.
     * That is what every card, row and chip in 2.0.0 was using. On a near-black
     * theme it darkens a surface toward the page instead of lifting it toward
     * the finger, so a press read as the thing briefly disappearing. It is a
     * large part of why the app felt unfinished, and it was invisible in code
     * review because the call sites all look correct.
     *
     * One provider fixes every call site at once, including the ones that pass
     * no indication at all, and the handful that want a tone instead still opt
     * out with `indication = null` plus `pressTone`.
     */
    val indication = ripple()

    CompositionLocalProvider(
        LocalPalette provides palette,
        LocalReducedMotion provides reducedMotion,
        LocalIndication provides indication,
    ) {
        MaterialTheme(
            colorScheme = palette.toColorScheme(),
            typography = LifeOsTypography,
            content = content,
        )
    }
}

/** Shorthand so screens read `palette.accent` without a local lookup each time. */
val palette: Palette
    @Composable get() = LocalPalette.current
