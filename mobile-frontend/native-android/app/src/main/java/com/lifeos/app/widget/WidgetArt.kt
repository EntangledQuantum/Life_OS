package com.lifeos.app.widget

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.RectF
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.toArgb
import androidx.core.graphics.createBitmap

/**
 * The growth meter, as a bitmap.
 *
 * Glance has no `Canvas`: a widget is `RemoteViews`, and the only way to draw an
 * arbitrary shape into one is to hand it an image. So the ring is rendered with
 * `android.graphics` and passed to Glance as an `ImageProvider`.
 *
 * A fixed pixel size is correct **here and only here**. §8.5's rule is that
 * nothing *meant to span* the widget may have a computed width — the ribbon and
 * the XP bar span, and they use weights. The ring does not span: it is a fixed
 * square badge in the corner of the box, and it keeps its aspect ratio at any
 * launcher size.
 *
 * **The ghosted 100% contract holds here too** (§4.3): the full circle is always
 * drawn at low alpha, so the ring shows what a finished day looks like even on a
 * day that is nowhere near it. A progress arc with no reference is a number with
 * no units.
 */
internal object WidgetArt {

    fun ring(
        sizePx: Int,
        fraction: Float,
        accent: Color,
        track: Color,
    ): Bitmap {
        val size = sizePx.coerceAtLeast(24)
        val bitmap = createBitmap(size, size)
        val canvas = Canvas(bitmap)

        val stroke = size * 0.11f
        val inset = stroke / 2f + size * 0.02f
        val box = RectF(inset, inset, size - inset, size - inset)

        val paint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            style = Paint.Style.STROKE
            strokeWidth = stroke
            strokeCap = Paint.Cap.ROUND
        }

        // The ghost: the whole day, always present.
        paint.color = track.copy(alpha = 0.22f).toArgb()
        canvas.drawArc(box, 0f, 360f, false, paint)

        // What has actually happened. Clamped for the arc only — a 130% day
        // still prints its figure beside this, never clipped.
        val swept = fraction.coerceIn(0f, 1f) * 360f
        if (swept > 0f) {
            paint.color = accent.toArgb()
            canvas.drawArc(box, START_ANGLE, swept, false, paint)
        }

        return bitmap
    }

    /** Twelve o'clock, so the ring reads as a clock face rather than a gauge. */
    private const val START_ANGLE = -90f
}
