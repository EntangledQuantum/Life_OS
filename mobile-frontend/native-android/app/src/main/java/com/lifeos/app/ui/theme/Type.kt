package com.lifeos.app.ui.theme

import androidx.compose.material3.Typography
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.sp
import com.lifeos.app.R

/**
 * §6.6. Three families, bundled rather than downloaded — a first run on a LAN
 * with no internet must still render correctly, and a downloadable-font
 * provider is a Play Services dependency this app does not take.
 */
object LifeOsFonts {
    /** Headings and anything with voice. */
    val display = FontFamily(
        Font(R.font.outfit_regular, FontWeight.Normal),
        Font(R.font.outfit_semibold, FontWeight.SemiBold),
        Font(R.font.outfit_bold, FontWeight.Bold),
    )

    /** Body and labels. */
    val body = FontFamily(
        Font(R.font.figtree_regular, FontWeight.Normal),
        Font(R.font.figtree_medium, FontWeight.Medium),
        Font(R.font.figtree_semibold, FontWeight.SemiBold),
    )

    /**
     * Every number, time, duration, percentage and id. Non-negotiable: it is
     * what stops figures jittering as a counter ticks.
     */
    val mono = FontFamily(
        Font(R.font.jetbrains_mono_regular, FontWeight.Normal),
        Font(R.font.jetbrains_mono_medium, FontWeight.Medium),
        Font(R.font.jetbrains_mono_bold, FontWeight.Bold),
    )
}

/**
 * Tabular figures, in one place.
 *
 * `"tnum"` is the OpenType feature; JetBrains Mono is monospaced anyway, but
 * stating it keeps the intent explicit for any family that is not.
 */
private const val TABULAR = "tnum"

object LifeOsType {
    /** The pulse word. 28sp Outfit SemiBold, coloured by the pulse. */
    val pulse = TextStyle(
        fontFamily = LifeOsFonts.display,
        fontWeight = FontWeight.SemiBold,
        fontSize = 28.sp,
        lineHeight = 34.sp,
    )

    val screenTitle = TextStyle(
        fontFamily = LifeOsFonts.display,
        fontWeight = FontWeight.SemiBold,
        fontSize = 22.sp,
        lineHeight = 28.sp,
    )

    val cardTitle = TextStyle(
        fontFamily = LifeOsFonts.body,
        fontWeight = FontWeight.SemiBold,
        fontSize = 17.sp,
        lineHeight = 22.sp,
    )

    val body = TextStyle(
        fontFamily = LifeOsFonts.body,
        fontWeight = FontWeight.Normal,
        fontSize = 15.sp,
        lineHeight = 21.sp,
    )

    val bodySmall = TextStyle(
        fontFamily = LifeOsFonts.body,
        fontWeight = FontWeight.Normal,
        fontSize = 13.sp,
        lineHeight = 18.sp,
    )

    val label = TextStyle(
        fontFamily = LifeOsFonts.body,
        fontWeight = FontWeight.Medium,
        fontSize = 12.sp,
        lineHeight = 16.sp,
    )

    /* ---- mono: every number ---- */

    val mono11 = mono(11)
    val mono12 = mono(12)
    val mono13 = mono(13)
    val mono14 = mono(14)
    val mono16 = mono(16)

    fun mono(size: Int, weight: FontWeight = FontWeight.Medium): TextStyle = TextStyle(
        fontFamily = LifeOsFonts.mono,
        fontWeight = weight,
        fontSize = size.sp,
        lineHeight = (size * 1.35f).sp,
        fontFeatureSettings = TABULAR,
    )
}

/**
 * The M3 `Typography` components want. Feature code should reach for
 * `LifeOsType` directly; this exists so a stock `Text` inside a Material
 * component is not Roboto.
 */
val LifeOsTypography = Typography(
    displayLarge = LifeOsType.pulse,
    displayMedium = LifeOsType.pulse,
    displaySmall = LifeOsType.pulse,
    headlineLarge = LifeOsType.screenTitle,
    headlineMedium = LifeOsType.screenTitle,
    headlineSmall = LifeOsType.screenTitle,
    titleLarge = LifeOsType.screenTitle,
    titleMedium = LifeOsType.cardTitle,
    titleSmall = LifeOsType.cardTitle,
    bodyLarge = LifeOsType.body,
    bodyMedium = LifeOsType.body,
    bodySmall = LifeOsType.bodySmall,
    labelLarge = LifeOsType.label,
    labelMedium = LifeOsType.label,
    labelSmall = LifeOsType.label,
)
