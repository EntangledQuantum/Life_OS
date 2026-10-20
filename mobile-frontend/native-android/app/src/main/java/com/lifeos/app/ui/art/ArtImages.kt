package com.lifeos.app.ui.art

import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.Dp
import coil3.compose.AsyncImagePainter
import coil3.compose.rememberAsyncImagePainter
import coil3.request.ImageRequest
import com.lifeos.app.domain.ArtPicture
import com.lifeos.app.domain.ArtSvg
import com.lifeos.app.domain.ResolvedArt
import com.lifeos.app.ui.theme.Radii
import com.lifeos.app.ui.theme.palette

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

/** The web client's two stops: `overlay * 0.86` at the top, `overlay + 0.24` at the foot. */
private const val SCRIM_TOP = 0.86f
private const val SCRIM_BOTTOM_LIFT = 0.24f
private const val SCRIM_BOTTOM_MAX = 0.96f

/**
 * The background layer: the picture, cover-cropped, under a vertical scrim.
 *
 * Draws **nothing at all** when there is no picture, which is the normal case.
 * Meant to be the first child of the card's `Box`, passed
 * `Modifier.matchParentSize()`, so that it fills the card without being allowed
 * to decide how big the card is — a 1200×800 picture measured as content would
 * make an 88dp row 800px tall.
 *
 * The scrim is not optional and it is what makes the title and the XP readable.
 * `Art.overlay` has already clamped it; this only draws it. A gradient rather
 * than a flat wash because the text sits low on these cards and a photograph's
 * own bright areas are usually at the top — a flat scrim dark enough for the
 * bottom line makes the whole picture mud.
 */
@Composable
fun ArtBackground(art: ResolvedArt, modifier: Modifier = Modifier) {
    val picture = art.background ?: return
    val loaded = rememberArt(picture.source, picture.cacheKey, ContentScale.Crop)

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
         * Drawing it while the picture is loading, or after it has failed,
         * would darken a card for no reason — which offline, with a URL that
         * cannot be reached, would be every card with art, every time. The
         * scrim is there to make text readable over a photograph; with no
         * photograph there is nothing to make readable.
         */
        if (loaded.ready) {
            Box(
                modifier = Modifier
                    .fillMaxSize()
                    .background(
                        Brush.verticalGradient(
                            listOf(
                                SCRIM.copy(alpha = art.overlay * SCRIM_TOP),
                                SCRIM.copy(
                                    alpha = minOf(SCRIM_BOTTOM_MAX, art.overlay + SCRIM_BOTTOM_LIFT),
                                ),
                            ),
                        ),
                    ),
            )
        }
    }
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

/** A painter and whether it has something to draw yet. */
private class LoadedArt(val painter: AsyncImagePainter, val ready: Boolean)

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
            .build()
    }
    val painter = rememberAsyncImagePainter(model = request, contentScale = contentScale)
    val state by painter.state.collectAsState()
    return LoadedArt(painter, state is AsyncImagePainter.State.Success)
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
