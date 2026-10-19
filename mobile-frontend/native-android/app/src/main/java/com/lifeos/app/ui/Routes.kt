package com.lifeos.app.ui

/**
 * Every route in the app, named once.
 *
 * Three top-level destinations and a handful of leaves. The two things worth
 * noticing:
 *
 *  - `SERVER` is **top-level**, not a child of settings, because it has to work
 *    with no token and no connection and be reachable from five places (§7.6).
 *  - `SETTINGS` is a leaf behind a gear, not a destination. A permanent 20% of
 *    the navigation bar spent on a screen opened once a month is why the old bar
 *    needed five slots and why the five looked crowded (§2.1).
 */
object Routes {
    const val TODAY = "today"
    const val DAY = "day"
    const val YOU = "you"

    const val CONNECT = "connect"
    const val PAIR = "connect/pair"
    const val SERVER = "server"
    const val OUTDATED = "outdated"

    const val SETTINGS = "settings"
    const val SETTINGS_APPEARANCE = "settings/appearance"
    const val SETTINGS_NOTIFICATIONS = "settings/notifications"
    const val SETTINGS_DAY = "settings/day"
    const val SETTINGS_CONNECTION = "settings/connection"
    const val SETTINGS_PENDING = "settings/connection/pending"
    const val SETTINGS_WIDGET = "settings/widget"
    const val SETTINGS_ABOUT = "settings/about"

    /*
     * The sheets of §2.3 — `agenda/{id}`, `task/{id}`, the meter's detail,
     * `session/picker` and `study/log` — are **not** in this list, and that is
     * a stated divergence. `navigation-compose` has no bottom-sheet destination
     * type, and a `ModalBottomSheet` is an overlay over the screen underneath
     * rather than a place you go: the screen behind it keeps its scroll and
     * keeps polling. They are state on the view model (`AppSheet`), dismissed
     * by the sheet's own back handling, which includes predictive back.
     */

    /** The three that get a navigation item. Nothing else does. */
    val topLevel = listOf(TODAY, DAY, YOU)
}
