package com.lifeos.app.ui.art

import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.Dp
import android.graphics.Bitmap
import coil3.BitmapImage
import coil3.Image as CoilImage
import coil3.compose.AsyncImagePainter
import coil3.compose.rememberAsyncImagePainter
import coil3.request.ImageRequest
import coil3.request.allowHardware
import com.lifeos.app.domain.Art
import com.lifeos.app.domain.ArtPicture
import com.lifeos.app.domain.ArtSvg
import com.lifeos.app.domain.ResolvedArt
import com.lifeos.app.ui.theme.Radii
import com.lifeos.app.ui.theme.palette
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/**
 * The two pictures a habit, a task, a goal or a tier can carry.
 *
 * One file rather than the same twenty lines in five places. The icon falls
 * back to the emoji, the background is always under a scrim with a floor, and
 * every request is keyed so the eight-second poll costs nothing. Getting any of
 * those subtly different between an agenda card and a goal card is how two
 * surfaces of the same app end up looking like two apps — which is exactly what
 * happened between this client and the web one until now.
 *
 * **Nothing here ever shows a spinner or an empty box.** A picture that has not
 * arrived, or cannot, draws the thing it replaced: the emoji, the glyph, or in
 * the background's case nothing at all. Art is never required and its absence is
 * not a failure state.
 */

/**
 * The scrim's own colour.
 *
 * `rgb(7,8,12)` — the same near-black the web client's `ArtBackground` uses, so
 * a photograph reads the same on the phone as on the dashboard. Not a palette
 * field: a theme swaps colours, and this is the shadow a picture sits under
 * rather than a colour the theme gets to choose (§6.2).
 */
private val SCRIM = Color(0xFF07080C)

/**
 * The scrim deepens toward the foot of the card and never lightens.
 *
 * The web client's formula started its gradient at `overlay × 0.86`, which is
 * *lighter* than the floor the floor exists to guarantee — fine on a tall card
 * where the text sits low, wrong on an 88dp row where it sits in the middle.
 * Here the measured alpha is the value at the top and the only direction is
 * darker.
 */
private const val SCRIM_BOTTOM_LIFT = 0.12f
private const val SCRIM_MAX = 0.96f

/** The square the picture is averaged over. 64 pixels is plenty for a mean. */
private const val SAMPLE = 8

/**
 * The background layer: the picture, cover-cropped, under a measured scrim.
 *
 * Draws **nothing at all** when there is no picture, which is the normal case.
 * Meant to be the first child of the card's `Box`, passed
 * `Modifier.matchParentSize()`, so that it fills the card without being allowed
 * to decide how big the card is — a 1200×800 picture measured as content would
 * make an 88dp row 800px tall.
 *
 * **The scrim is measured, not assumed.** A fixed percentage is only ever
 * correct by luck: 35% over a dark photograph is more than it needs and 35% over
 * a blown-out one leaves white text on a white sky. So the picture's own mean
 * luminance is read once, and `Art.scrimAlpha` returns the lightest scrim that
 * still clears 4.5:1 for the palest text on the card. The agent's `artOverlay`
 * is the floor of that — it can ask for darker, never for lighter.
 */
@Composable
fun ArtBackground(art: ResolvedArt, modifier: Modifier = Modifier) {
    val picture = art.background ?: return
    val loaded = rememberArt(picture.source, picture.cacheKey, ContentScale.Crop)

    /*
     * Until the picture has been measured the scrim is the agent's floor, which
     * is also what it stays at if the measurement cannot be made. Keyed on the
     * cache key, so the eight-second poll re-measures nothing: the same picture
     * keeps the alpha it was already given.
     */
    var scrim by remember(picture.cacheKey) { mutableFloatStateOf(art.overlay) }
    LaunchedEffect(picture.cacheKey, loaded.ready) {
        val bitmap = (loaded.image as? BitmapImage)?.bitmap ?: return@LaunchedEffect
        val mean = withContext(Dispatchers.Default) { meanLinear(bitmap) } ?: return@LaunchedEffect
        scrim = Art.scrimAlpha(mean, art.overlay)
    }

    Box(modifier = modifier) {
        Image(
            painter = loaded.painter,
            contentDescription = null,
            contentScale = ContentScale.Crop,
            modifier = Modifier.fillMaxSize(),
        )
        /*
         * The scrim only exists once the picture does.
         *
         * Drawing it while the picture is loading, or after it has failed, would
         * darken a card for no reason — which offline, with a URL that cannot be
         * reached, would be every card with art, every time. The scrim is there
         * to make text readable over a photograph; with no photograph there is
         * nothing to make readable.
         */
        if (loaded.ready) {
            Box(
                modifier = Modifier
                    .fillMaxSize()
                    .background(
                        Brush.verticalGradient(
                            listOf(
                                SCRIM.copy(alpha = scrim),
                                SCRIM.copy(alpha = minOf(SCRIM_MAX, scrim + SCRIM_BOTTOM_LIFT)),
                            ),
                        ),
                    ),
            )
        }
    }
}

/**
 * The picture's mean colour, in linear light.
 *
 * Averaged in **linear** light rather than in sRGB: sRGB is a perceptual
 * encoding, and averaging in it under-weights exactly the bright pixels that
 * make text unreadable. An 8×8 downscale is enough for a mean and costs a
 * fraction of a millisecond; it happens once per picture, off the main thread,
 * never per frame and never per poll.
 *
 * Null when the bitmap cannot be read — a hardware bitmap has no pixels on the
 * CPU side — and the caller then keeps the agent's floor.
 */
private fun meanLinear(bitmap: Bitmap): DoubleArray? {
    if (bitmap.width <= 0 || bitmap.height <= 0) return null
    val small = runCatching { Bitmap.createScaledBitmap(bitmap, SAMPLE, SAMPLE, true) }
        .getOrNull() ?: return null
    val pixels = IntArray(SAMPLE * SAMPLE)
    val read = runCatching { small.getPixels(pixels, 0, SAMPLE, 0, 0, SAMPLE, SAMPLE) }.isSuccess
    if (small !== bitmap) small.recycle()
    if (!read) return null

    var r = 0.0
    var g = 0.0
    var b = 0.0
    for (pixel in pixels) {
        r += Art.toLinear((pixel shr 16) and 0xFF)
        g += Art.toLinear((pixel shr 8) and 0xFF)
        b += Art.toLinear(pixel and 0xFF)
    }
    val n = pixels.size.toDouble()
    return doubleArrayOf(r / n, g / n, b / n)
}

/**
 * The icon tile: the resolved picture, else whatever [fallback] draws.
 *
 * The tile's size and shape are held whether or not there is a picture, so a
 * poll that adds or removes art cannot re-layout the row. That is the whole
 * reason the tint and the clip live out here rather than inside each branch.
 */
@Composable
fun ArtIcon(
    picture: ArtPicture?,
    size: Dp,
    tint: Color,
    modifier: Modifier = Modifier,
    fallback: @Composable () -> Unit,
) {
    Box(
        modifier = modifier
            .size(size)
            .clip(RoundedCornerShape(Radii.tile))
            .background(tint),
        contentAlignment = Alignment.Center,
    ) {
        if (picture == null) {
            fallback()
        } else {
            Picture(
                source = picture.source,
                cacheKey = picture.cacheKey,
                contentScale = ContentScale.Crop,
                fallback = fallback,
            )
        }
    }
}

/**
 * An agent's inline SVG, drawn as a picture.
 *
 * Safe because it is only ever a picture: the server sanitises the markup hard
 * before storing it, and on this side it goes through the SVG decoder into a
 * bitmap — there is no WebView, no `<img>` and no document anywhere on the
 * path, so even a vector the sanitiser missed has nothing to execute, nothing to
 * fetch and nowhere to navigate.
 *
 * A vector that fails to decode draws [fallback] — a broken box would be the
 * one outcome worse than no artwork.
 */
@Composable
fun ArtSvgImage(
    art: ArtSvg?,
    modifier: Modifier = Modifier,
    contentScale: ContentScale = ContentScale.Fit,
    fallback: @Composable () -> Unit = {},
) {
    if (art == null) {
        fallback()
        return
    }
    Box(modifier = modifier, contentAlignment = Alignment.Center) {
        Picture(
            source = art,
            cacheKey = art.cacheKey,
            contentScale = contentScale,
            fallback = fallback,
        )
    }
}

/**
 * A rounded media block — the background picture drawn as content rather than as
 * atmosphere, for a sheet, where there is no text over it to protect.
 */
@Composable
fun ArtMedia(picture: ArtPicture?, modifier: Modifier = Modifier, shape: Shape = RoundedCornerShape(Radii.tile)) {
    val p = palette
    if (picture == null) return
    Box(modifier = modifier.clip(shape).background(p.surface2)) {
        Picture(
            source = picture.source,
            cacheKey = picture.cacheKey,
            contentScale = ContentScale.Crop,
        )
    }
}

/* ------------------------------------------------------------------ plumbing */

/** A painter, whether it has something to draw yet, and what it drew. */
private class LoadedArt(
    val painter: AsyncImagePainter,
    val ready: Boolean,
    /** The decoded image, for the one caller that has to measure it. */
    val image: CoilImage?,
)

/**
 * One request per picture, built once per **cache key**, and always drawn.
 *
 * Two things here are load-bearing and neither is obvious.
 *
 * `remember(cacheKey)` is not a micro-optimisation: the dashboard poll replaces
 * every DTO every eight seconds, so without it each poll would hand the painter
 * a fresh `ImageRequest` and restart the load — the row would blink even though
 * the picture had not changed. Keyed on the fingerprint, an unchanged picture is
 * literally the same request object and the painter never learns a poll
 * happened.
 *
 * And the painter has to be **drawn** or it never loads. An `AsyncImagePainter`
 * has no layout node of its own, so it takes its target size from the draw
 * scope; a painter that is composed but never handed to an `Image` sits waiting
 * for a size that will never arrive. So every caller draws the image
 * unconditionally and puts the fallback *over* it until there is something
 * underneath — rather than drawing one or the other, which deadlocks.
 */
@Composable
private fun rememberArt(source: Any, cacheKey: String, contentScale: ContentScale): LoadedArt {
    val context = LocalContext.current
    val request = remember(cacheKey) {
        ImageRequest.Builder(context)
            .data(source)
            // Both keys explicit, and short. The default key for a `data:` URI
            // is the URI itself — hundreds of kilobytes of base64 hashed on
            // every poll before the cache can tell us it already had the bitmap.
            .memoryCacheKey(cacheKey)
            .diskCacheKey(cacheKey)
            // The background's scrim is computed from the picture's own pixels,
            // and a hardware bitmap has none on the CPU side. The images here
            // are already decoded down to the box they are drawn in, so what
            // this gives up is small beside a card that cannot be read.
            .allowHardware(false)
            .build()
    }
    val painter = rememberAsyncImagePainter(model = request, contentScale = contentScale)
    val state by painter.state.collectAsState()
    val success = state as? AsyncImagePainter.State.Success
    return LoadedArt(painter, success != null, success?.result?.image)
}

/**
 * Draw the picture, with [fallback] over it until there is a picture to draw.
 *
 * Deliberately not a loading state: there is no spinner on a row (§3), and a
 * half-drawn tile is worse than the emoji it replaced. Offline, with a URL that
 * is not cached, this settles on the fallback and stays there — which is the
 * honest answer.
 */
@Composable
private fun Picture(
    source: Any,
    cacheKey: String,
    contentScale: ContentScale,
    fallback: @Composable () -> Unit = {},
) {
    val loaded = rememberArt(source, cacheKey, contentScale)
    Image(
        painter = loaded.painter,
        contentDescription = null,
        contentScale = contentScale,
        modifier = Modifier.fillMaxSize(),
    )
    if (!loaded.ready) fallback()
}
