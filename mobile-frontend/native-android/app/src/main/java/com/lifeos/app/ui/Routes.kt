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
    const val SETTINGS_CONNECTION = "settings/connection"
    const val SETTINGS_PENDING = "settings/connection/pending"
    const val SETTINGS_ABOUT = "settings/about"

    /** The three that get a navigation item. Nothing else does. */
    val topLevel = listOf(TODAY, DAY, YOU)
}
