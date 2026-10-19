package com.lifeos.app.widget

import android.content.Context
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import androidx.glance.GlanceId
import androidx.glance.GlanceModifier
import androidx.glance.GlanceTheme
import androidx.glance.Image
import androidx.glance.ImageProvider
import androidx.glance.LocalContext
import androidx.glance.LocalSize
import androidx.glance.action.actionStartActivity
import androidx.glance.action.clickable
import androidx.glance.appwidget.GlanceAppWidget
import androidx.glance.appwidget.SizeMode
import androidx.glance.appwidget.action.actionRunCallback
import androidx.glance.appwidget.cornerRadius
import androidx.glance.appwidget.provideContent
import androidx.glance.appwidget.updateAll
import androidx.glance.background
import androidx.glance.layout.Alignment
import androidx.glance.layout.Box
import androidx.glance.layout.Column
import androidx.glance.layout.Row
import androidx.glance.layout.Spacer
import androidx.glance.layout.fillMaxHeight
import androidx.glance.layout.fillMaxSize
import androidx.glance.layout.fillMaxWidth
import androidx.glance.layout.height
import androidx.glance.layout.padding
import androidx.glance.layout.size
import androidx.glance.layout.width
import androidx.glance.text.FontFamily
import androidx.glance.text.FontWeight
import androidx.glance.text.Text
import androidx.glance.text.TextStyle
import androidx.glance.unit.ColorProvider
import com.lifeos.app.LifeOsApp
import com.lifeos.app.MainActivity
import com.lifeos.app.data.TodayView
import com.lifeos.app.data.api.AgendaItemDto
import com.lifeos.app.domain.Predicates
import com.lifeos.app.domain.Ribbon
import com.lifeos.app.domain.RibbonCell
import com.lifeos.app.domain.WidgetTier
import com.lifeos.app.domain.WidgetTiers
import com.lifeos.app.ui.theme.ActivityColors
import com.lifeos.app.ui.theme.Palette
import com.lifeos.app.ui.theme.Palettes
import com.lifeos.app.ui.theme.serverColor
import kotlinx.coroutines.flow.first
import java.time.Instant
import java.time.format.DateTimeFormatter

/**
 * The home-screen widget (UI_SPEC §8.5).
 *
 * **It never fetches.** It reads the same Room snapshot the app reads and
 * renders instantly from cache; it is brought up to date by the same
 * `SyncWorker` that keeps the app current. A widget that makes its own network
 * call is a widget that shows a spinner on a home screen, and on a LAN server
 * that is asleep it shows one forever.
 *
 * ## The rule that governs every line of layout here
 *
 * **Never a fixed dp width for something meant to span.** The launcher hands out
 * a different box per device, per cell count, and again after every resize. So
 * spanning elements are `fillMaxWidth()` or `defaultWeight()`, never a computed
 * pixel width — and because Glance has no *fractional* weight, the ribbon is
 * quantised into equal cells by `Ribbon.cells` rather than being given
 * percentage widths. The two fixed sizes in this file are the ring bitmap and
 * the tick target, neither of which spans anything.
 *
 * The tier comes from `LocalSize.current`, which is the real box, read per
 * render. Elements are **dropped** rather than clipped.
 */
class LifeOsWidget : GlanceAppWidget() {

    /**
     * `SizeMode.Exact` so `LocalSize.current` is the box the launcher actually
     * gave us, rather than one of a set of sizes we declared in advance. The
     * tier decision is only as good as the number it is fed.
     */
    override val sizeMode: SizeMode = SizeMode.Exact

    override suspend fun provideGlance(context: Context, id: GlanceId) {
        val app = context.applicationContext as? LifeOsApp
        val view = app?.container?.repository?.today?.first()
        val palette = Palettes.byId(
            app?.container?.preferences?.prefs?.first()?.paletteId ?: "bloom",
        )

        provideContent {
            GlanceTheme {
                WidgetBody(view = view, palette = palette)
            }
        }
    }

    companion object {
        /** Called by `SyncWorker` after a refresh, and after a widget tick. */
        suspend fun refresh(context: Context) {
            runCatching { LifeOsWidget().updateAll(context) }
        }
    }
}

@Composable
private fun WidgetBody(view: TodayView?, palette: Palette) {
    val size = LocalSize.current
    val tier = WidgetTiers.of(size.width.value, size.height.value)
    val data = view?.data

    Column(
        modifier = GlanceModifier
            .fillMaxSize()
            .background(ColorProvider(palette.bg))
            .cornerRadius(20.dp)
            .padding(12.dp)
            // Tapping anywhere else opens Today (§8.5).
            .clickable(actionStartActivity<MainActivity>()),
        verticalAlignment = Alignment.Top,
    ) {
        if (data == null) {
            Text(
                text = "Life OS",
                style = TextStyle(color = ColorProvider(palette.muted), fontSize = 13.sp()),
            )
            Text(
                text = "Open the app to connect",
                style = TextStyle(color = ColorProvider(palette.faint), fontSize = 11.sp()),
            )
            return@Column
        }

        val progress = data.progress
        val fraction = (progress.efficiencyPct / 100.0).toFloat()

        /* ---- the meter, the figures, the pulse word ---- */
        Row(
            modifier = GlanceModifier.fillMaxWidth(),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            val ringPx = if (tier == WidgetTier.COMPACT) 96 else 120
            Image(
                provider = ImageProvider(
                    WidgetArt.ring(
                        sizePx = ringPx,
                        fraction = fraction,
                        accent = palette.accent,
                        track = palette.text,
                    ),
                ),
                contentDescription = "Today's progress",
                modifier = GlanceModifier.size(if (tier == WidgetTier.COMPACT) 32.dp else 40.dp),
            )
            Spacer(modifier = GlanceModifier.width(10.dp))
            Column(modifier = GlanceModifier.defaultWeight()) {
                Text(
                    // Never clipped: a 130% day prints 130%.
                    text = "${Math.round(progress.efficiencyPct)}%",
                    style = TextStyle(
                        color = ColorProvider(palette.text),
                        fontSize = if (tier == WidgetTier.COMPACT) 16.sp() else 20.sp(),
                        fontWeight = FontWeight.Medium,
                        fontFamily = FontFamily.Monospace,
                    ),
                )
                if (tier != WidgetTier.COMPACT) {
                    Text(
                        text = "${progress.dailyXp}/${progress.dailyXpTarget} XP",
                        style = TextStyle(
                            color = ColorProvider(palette.muted),
                            fontSize = 12.sp(),
                            fontFamily = FontFamily.Monospace,
                        ),
                    )
                }
            }
            /*
             * The pulse word, or a small hollow dot when the cache is stale
             * (§8.5). The dot is the widget's whole vocabulary for "this may be
             * out of date" — there is no spinner and no "Syncing…" on a home
             * screen.
             */
            if (tier != WidgetTier.COMPACT) {
                if (view.connection.showsStrip) {
                    Text(
                        text = "◦",
                        style = TextStyle(color = ColorProvider(palette.warning), fontSize = 14.sp()),
                    )
                } else {
                    Text(
                        text = data.pulse,
                        style = TextStyle(color = ColorProvider(palette.accent2), fontSize = 12.sp()),
                    )
                }
            }
        }

        /* ---- the ribbon, with the now-marker ---- */
        if (tier.showsRibbon) {
            Spacer(modifier = GlanceModifier.height(8.dp))
            WidgetRibbon(view = view, palette = palette)
        }

        /* ---- the next one or two things ---- */
        val next = Predicates.upNext(data, tier.agendaRows)
        if (next.isNotEmpty()) {
            Spacer(modifier = GlanceModifier.height(8.dp))
            next.forEach { item ->
                AgendaRow(
                    item = item,
                    palette = palette,
                    showTick = tier.showsTick,
                    timezone = data.lifeDay.timezone,
                )
            }
        }

        /* ---- up to three manual activity chips ---- */
        if (tier.showsChips) {
            Spacer(modifier = GlanceModifier.height(8.dp))
            Row(modifier = GlanceModifier.fillMaxWidth()) {
                // `ActivityColors.MANUAL` excludes Sleep and Break — the
                // schedule and the agent set those (§8.5). One definition,
                // shared with the session picker.
                ActivityColors.MANUAL.take(3).forEach { tag ->
                    Box(
                        modifier = GlanceModifier
                            .defaultWeight()
                            .padding(horizontal = 2.dp),
                        contentAlignment = Alignment.Center,
                    ) {
                        Box(
                            modifier = GlanceModifier
                                .fillMaxWidth()
                                .background(
                                    ColorProvider(
                                        ActivityColors.of(tag, palette.accent).copy(alpha = 0.18f),
                                    ),
                                )
                                .cornerRadius(10.dp)
                                .padding(vertical = 6.dp)
                                .clickable(
                                    actionRunCallback<WidgetSessionAction>(
                                        WidgetSessionAction.params(tag),
                                    ),
                                ),
                            contentAlignment = Alignment.Center,
                        ) {
                            Text(
                                text = tag,
                                maxLines = 1,
                                style = TextStyle(
                                    color = ColorProvider(ActivityColors.of(tag, palette.accent)),
                                    fontSize = 10.sp(),
                                ),
                            )
                        }
                    }
                }
            }
        }
    }
}

/**
 * The ribbon: `count` equal cells, every one of them `defaultWeight()`.
 *
 * This is the §8.5 rule made literal. Nothing here has a width — the row takes
 * the box the launcher gave it and the cells divide it, so the ribbon is correct
 * on a 4-cell widget, on a 5-cell widget, on a tablet, and after the user drags
 * the resize handle. `Ribbon.cells` is shared with Day's ribbon, so the shape is
 * the server's shape on both surfaces.
 */
@Composable
private fun WidgetRibbon(view: TodayView, palette: Palette) {
    val data = view.data ?: return
    val nowFraction = Ribbon.nowFraction(Instant.now(), data.lifeDay.timezone)
    val cells = Ribbon.cells(data.timeline, RIBBON_CELLS, nowFraction)

    /*
     * Two things here were found by looking at the widget on a home screen
     * rather than by reading the API, and both are Glance being `RemoteViews`
     * rather than Compose:
     *
     *  1. **A Glance container holds at most ten children.** Twenty-four cells
     *     in one `Row` did not throw — it silently drew the first few across
     *     the whole width, which looked like a solid bar with one seam. So the
     *     cells are chunked into groups: an outer `Row` of four equal groups,
     *     each an inner `Row` of six equal cells. Every level is within the
     *     limit, every child is `defaultWeight()`, and the arithmetic still
     *     comes out as twenty-four equal cells across whatever box the
     *     launcher gave us.
     *  2. **`fillMaxHeight()`, never `fillMaxSize()`.** A child with both
     *     `width=match_parent` and a weight makes `LinearLayout` distribute
     *     *excess* space, which is negative here, so the first cell took the
     *     row and the rest collapsed. Height is the only axis that may fill.
     */
    Row(modifier = GlanceModifier.fillMaxWidth().height(10.dp)) {
        cells.chunked(RIBBON_GROUP).forEach { group ->
            Row(modifier = GlanceModifier.defaultWeight().fillMaxHeight()) {
                group.forEach { cell ->
                    Box(
                        modifier = GlanceModifier
                            .defaultWeight()
                            .fillMaxHeight()
                            .background(ColorProvider(cellColour(cell, palette))),
                    ) {}
                }
            }
        }
    }
}

/**
 * Solid behind the now-marker for what was lived, dimmed ahead for the plan,
 * `done` dimmer still — the same treatment Day's ribbon gives, at hourly
 * resolution. The now cell is the accent, which is the marker.
 *
 * `serverColor` rather than a hex parse of its own: the server's "Unlogged"
 * block is `rgba(255,255,255,0.05)`, and a hex-only parser falls back to the
 * accent for it — which drew the *unrecorded* part of the day as the loudest
 * colour on the home screen, and hid the now-marker inside it.
 */
private fun cellColour(cell: RibbonCell, palette: Palette): Color {
    if (cell.isNow) return palette.accent
    val raw = cell.colorHex ?: return palette.text.copy(alpha = 0.08f)
    val parsed = serverColor(raw) ?: return palette.text.copy(alpha = 0.08f)
    return when {
        cell.done -> parsed.copy(alpha = parsed.alpha * 0.55f)
        cell.actual -> parsed
        else -> parsed.copy(alpha = parsed.alpha * 0.32f)
    }
}

@Composable
private fun AgendaRow(
    item: AgendaItemDto,
    palette: Palette,
    showTick: Boolean,
    timezone: String?,
) {
    Row(
        modifier = GlanceModifier.fillMaxWidth().padding(vertical = 2.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(
            text = item.at?.let { clock(it, timezone) } ?: "—",
            style = TextStyle(
                color = ColorProvider(palette.muted),
                fontSize = 11.sp(),
                fontFamily = FontFamily.Monospace,
            ),
        )
        Spacer(modifier = GlanceModifier.width(6.dp))
        Text(
            text = item.title,
            maxLines = 1,
            modifier = GlanceModifier.defaultWeight(),
            style = TextStyle(color = ColorProvider(palette.text), fontSize = 12.sp()),
        )
        if (showTick) {
            /*
             * 48dp of target, from open question #8 — a launcher cell is small
             * and a mis-tap completes a habit. On the tier where this does not
             * fit, the tick is not drawn at all and the row falls through to the
             * widget's own "open Today" click, because opening the app is
             * recoverable and a wrongly completed habit corrupts a streak.
             */
            Box(
                modifier = GlanceModifier
                    .size(48.dp)
                    .clickable(
                        actionRunCallback<WidgetTickAction>(
                            WidgetTickAction.params(item),
                        ),
                    ),
                contentAlignment = Alignment.Center,
            ) {
                Text(
                    text = "✓",
                    style = TextStyle(color = ColorProvider(palette.accent), fontSize = 16.sp()),
                )
            }
        }
    }
}

/**
 * Hourly. See `Ribbon.cells` for why the ribbon is quantised at all.
 *
 * `RIBBON_CELLS / RIBBON_GROUP` and `RIBBON_GROUP` must each stay at or under
 * ten, which is the most children a Glance container can hold. 24 = 4 groups of
 * 6, so both levels are four under the limit.
 */
private const val RIBBON_CELLS = 24
private const val RIBBON_GROUP = 6

private val HHMM = DateTimeFormatter.ofPattern("HH:mm")

private fun clock(instant: String, timezone: String?): String = runCatching {
    Instant.parse(instant)
        .atZone(com.lifeos.app.domain.LifeDays.resolveZone(timezone))
        .format(HHMM)
}.getOrDefault("—")

/** Glance text sizes are `TextUnit`; this keeps the call sites readable. */
private fun Int.sp() = androidx.compose.ui.unit.TextUnit(
    this.toFloat(),
    androidx.compose.ui.unit.TextUnitType.Sp,
)
