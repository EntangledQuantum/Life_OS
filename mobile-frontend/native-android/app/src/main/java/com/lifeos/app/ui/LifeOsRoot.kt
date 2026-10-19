package com.lifeos.app.ui

import android.content.Intent
import androidx.core.net.toUri
import androidx.compose.animation.Crossfade
import androidx.compose.animation.core.tween
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CalendarToday
import androidx.compose.material.icons.filled.Person
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material.icons.filled.WbSunny
import androidx.compose.material.icons.outlined.CalendarToday
import androidx.compose.material.icons.outlined.Person
import androidx.compose.material.icons.outlined.WbSunny
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.material3.adaptive.navigationsuite.NavigationSuiteScaffold
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.navigation.NavHostController
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.currentBackStackEntryAsState
import androidx.navigation.compose.rememberNavController
import com.lifeos.app.BuildConfig
import com.lifeos.app.data.AppContainer
import com.lifeos.app.data.ConnectionState
import com.lifeos.app.data.PollIntervals
import com.lifeos.app.data.api.ApiClient
import com.lifeos.app.ui.components.PendingCountBadge
import com.lifeos.app.ui.components.StatusStrip
import com.lifeos.app.ui.connect.ConnectScreen
import com.lifeos.app.ui.connect.PairStubScreen
import com.lifeos.app.ui.outdated.OutdatedScreen
import com.lifeos.app.ui.placeholders.PlaceholderScreen
import com.lifeos.app.ui.server.ServerScreen
import com.lifeos.app.ui.server.ServerViewModel
import com.lifeos.app.ui.settings.AboutScreen
import com.lifeos.app.ui.settings.AppearanceScreen
import com.lifeos.app.ui.settings.ConnectionSettingsScreen
import com.lifeos.app.ui.settings.PendingWritesScreen
import com.lifeos.app.ui.settings.SettingsIndexScreen
import com.lifeos.app.ui.theme.LifeOsType
import com.lifeos.app.ui.theme.LocalReducedMotion
import com.lifeos.app.ui.theme.Motion
import com.lifeos.app.ui.theme.palette
import com.lifeos.app.ui.today.TodayScreen
import kotlinx.coroutines.launch
import java.time.LocalDate
import java.time.format.DateTimeFormatter

private const val NETWORK_DOCS =
    "https://github.com/EntangledQuantum/Life_OS/blob/master/docs/NETWORK.md"

/**
 * The whole app, above the shell.
 *
 * `server`, `connect` and `outdated` sit **outside** the navigation shell: they
 * are the three states in which the shell has nothing to show, and putting them
 * inside it would mean a navigation bar offering Day and You while the app
 * cannot reach the server — which is the old app's error panel with extra steps.
 */
@Composable
fun LifeOsRoot(container: AppContainer) {
    val context = LocalContext.current
    val navController = rememberNavController()
    val viewModel: LifeOsViewModel = viewModel(
        factory = LifeOsViewModel.factory(container, context.applicationContext),
    )

    val connection by viewModel.connection.collectAsStateWithLifecycle()
    val prefsFlow = remember { container.preferences.prefs }
    val prefs by prefsFlow.collectAsStateWithLifecycle(
        initialValue = com.lifeos.app.data.AppPrefs(),
    )

    /*
     * `426` and `401` are reactive: they can arrive on any poll, so the gate is
     * an effect on the state rather than a decision made once at startup.
     */
    LaunchedEffect(connection) {
        when (connection) {
            is ConnectionState.Outdated -> navController.navigate(Routes.OUTDATED) {
                launchSingleTop = true
            }

            ConnectionState.Unauthorized, ConnectionState.Unconfigured -> {
                // The address is kept and prefilled; only the token was cleared.
                navController.navigate(Routes.CONNECT) { launchSingleTop = true }
            }

            else -> Unit
        }
    }

    NavHost(
        navController = navController,
        startDestination = if (prefs.baseUrl.isNullOrBlank()) Routes.CONNECT else Routes.TODAY,
    ) {
        /* ---- the three top-level destinations, inside the shell ---- */
        listOf(Routes.TODAY, Routes.DAY, Routes.YOU).forEach { route ->
            composable(route) {
                AppShell(
                    route = route,
                    navController = navController,
                    viewModel = viewModel,
                    container = container,
                    prefs = prefs,
                )
            }
        }

        /* ---- the three that work without the shell ---- */

        composable(Routes.CONNECT) {
            ConnectScreen(
                onScanQr = { navController.navigate(Routes.PAIR) },
                onEnterManually = { navController.navigate(Routes.SERVER) },
                onWhereDoIFindThis = { openUrl(context, NETWORK_DOCS) },
            )
        }

        composable(Routes.PAIR) {
            PairStubScreen(onEnterManually = { navController.navigate(Routes.SERVER) })
        }

        composable(Routes.SERVER) {
            val serverVm: ServerViewModel = viewModel(factory = ServerViewModel.factory(container))
            val serverState by serverVm.state.collectAsStateWithLifecycle()
            ServerScreen(
                state = serverState,
                onAddressChange = serverVm::onAddressChange,
                onTokenChange = serverVm::onTokenChange,
                onKeepTokenChange = serverVm::onKeepTokenChange,
                onToggleTokenVisible = serverVm::onToggleTokenVisible,
                onTest = serverVm::test,
                onSave = {
                    serverVm.save {
                        // Saving is the one thing that can get the app out of
                        // every error state, so it lands on Today and clears the
                        // stack behind it.
                        navController.navigate(Routes.TODAY) {
                            popUpTo(0)
                            launchSingleTop = true
                        }
                    }
                },
                onScanQr = { navController.navigate(Routes.PAIR) },
                onOpenNetworkDocs = { openUrl(context, NETWORK_DOCS) },
            )
        }

        composable(Routes.OUTDATED) {
            val state = connection
            OutdatedScreen(
                mismatch = (state as? ConnectionState.Outdated)?.mismatch
                    ?: com.lifeos.app.data.api.ProtocolMismatchDto(),
                clientProtocol = ApiClient.clientProtocol,
                onDownload = { url -> openUrl(context, url) },
                onChangeServer = { navController.navigate(Routes.SERVER) },
            )
        }

        /* ---- settings: a leaf graph behind the gear ---- */

        composable(Routes.SETTINGS) {
            SettingsIndexScreen(
                onOpen = { page ->
                    when (page) {
                        "appearance" -> navController.navigate(Routes.SETTINGS_APPEARANCE)
                        "connection" -> navController.navigate(Routes.SETTINGS_CONNECTION)
                        "about" -> navController.navigate(Routes.SETTINGS_ABOUT)
                        // Notifications, the day and the widget are later
                        // milestones; their rows say so rather than opening an
                        // empty screen.
                        else -> Unit
                    }
                },
            )
        }

        composable(Routes.SETTINGS_APPEARANCE) {
            val scope = androidx.compose.runtime.rememberCoroutineScope()
            AppearanceScreen(
                currentPaletteId = prefs.paletteId,
                reducedMotionLocal = prefs.reducedMotionLocal,
                onPickPalette = { id -> scope.launch { container.preferences.setPalette(id) } },
                onReducedMotionChange = { value ->
                    scope.launch { container.preferences.setReducedMotion(value) }
                },
            )
        }

        composable(Routes.SETTINGS_CONNECTION) {
            val state by viewModel.state.collectAsStateWithLifecycle()
            val scope = androidx.compose.runtime.rememberCoroutineScope()
            ConnectionSettingsScreen(
                address = prefs.baseUrl,
                state = connection,
                lifeDayDate = state.view?.data?.lifeDay?.lifeDay,
                pendingCount = state.view?.pendingCount ?: 0,
                protocol = ApiClient.clientProtocol,
                onChangeServer = { navController.navigate(Routes.SERVER) },
                onOpenPendingWrites = { navController.navigate(Routes.SETTINGS_PENDING) },
                onReconnect = viewModel::refresh,
                onDisconnect = {
                    scope.launch {
                        container.tokens.clear()
                        navController.navigate(Routes.CONNECT) { popUpTo(0) }
                    }
                },
            )
        }

        composable(Routes.SETTINGS_PENDING) {
            val writes by viewModel.pendingWrites.collectAsStateWithLifecycle()
            PendingWritesScreen(
                writes = writes,
                onRetryAll = viewModel::retryAllStranded,
                onDiscard = viewModel::discardStranded,
            )
        }

        composable(Routes.SETTINGS_ABOUT) {
            AboutScreen(
                versionName = BuildConfig.VERSION_NAME,
                protocol = ApiClient.clientProtocol,
                applicationId = BuildConfig.APPLICATION_ID,
            )
        }
    }
}

/**
 * The navigation shell (§2.4, §5.4).
 *
 * `NavigationSuiteScaffold` picks bar-vs-rail from `currentWindowAdaptiveInfo()`,
 * never from a device-type check, because Android resizes the app while it runs.
 *
 * **The bottom bar does not move.** The old app animated a critically-damped
 * pill the full width of five tabs, at the exact bottom edge where the thumb
 * already draws attention, carrying no information about the content that
 * changed. Here there are three items, the label is always visible so nothing
 * appears or disappears, and the icon cross-fades outlined → filled **in place**.
 * Total on-screen movement at the bottom edge per navigation: zero pixels.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun AppShell(
    route: String,
    navController: NavHostController,
    viewModel: LifeOsViewModel,
    container: AppContainer,
    prefs: com.lifeos.app.data.AppPrefs,
) {
    val context = LocalContext.current
    val p = palette
    val reduced = LocalReducedMotion.current

    val state by viewModel.state.collectAsStateWithLifecycle()
    val connection by viewModel.connection.collectAsStateWithLifecycle()
    val refreshLine by viewModel.refreshLineVisible.collectAsStateWithLifecycle()
    val emptyTimedOut by viewModel.emptyCacheTimedOut.collectAsStateWithLifecycle()

    // The poll belongs to the destination, and there is only ever one of it.
    LaunchedEffect(route) {
        viewModel.startPolling(
            when (route) {
                Routes.DAY -> PollIntervals.DAY_MS
                Routes.YOU -> PollIntervals.YOU_MS
                else -> PollIntervals.TODAY_MS
            },
        )
    }

    NavigationSuiteScaffold(
        navigationSuiteItems = {
            NavItem(
                route = Routes.TODAY,
                current = route,
                label = "Today",
                selectedIcon = Icons.Filled.WbSunny,
                unselectedIcon = Icons.Outlined.WbSunny,
                navController = navController,
                reduced = reduced,
            )
            NavItem(
                route = Routes.DAY,
                current = route,
                label = "Day",
                selectedIcon = Icons.Filled.CalendarToday,
                unselectedIcon = Icons.Outlined.CalendarToday,
                navController = navController,
                reduced = reduced,
            )
            NavItem(
                route = Routes.YOU,
                current = route,
                label = "You",
                selectedIcon = Icons.Filled.Person,
                unselectedIcon = Icons.Outlined.Person,
                navController = navController,
                reduced = reduced,
            )
        },
        containerColor = p.bg,
        contentColor = p.text,
    ) {
        Scaffold(
            containerColor = p.bg,
            topBar = {
                TopAppBar(
                    title = {
                        if (route == Routes.TODAY) {
                            // The date in mono, small — it is a figure, not a heading.
                            com.lifeos.app.ui.components.Mono(
                                text = LocalDate.now().format(DATE_LABEL),
                                style = LifeOsType.mono14,
                                color = p.text,
                            )
                        } else {
                            Text(
                                text = if (route == Routes.DAY) "Day" else "You",
                                style = LifeOsType.screenTitle,
                                color = p.text,
                            )
                        }
                    },
                    actions = {
                        PendingCountBadge(
                            count = state.view?.pendingCount ?: 0,
                            state = connection,
                        )
                        IconButton(onClick = { navController.navigate(Routes.SETTINGS) }) {
                            Icon(Icons.Filled.Settings, contentDescription = "Settings", tint = p.muted)
                        }
                    },
                    colors = TopAppBarDefaults.topAppBarColors(
                        containerColor = p.bg,
                        titleContentColor = p.text,
                    ),
                )
            },
        ) { padding ->
            Column(modifier = Modifier.padding(padding).fillMaxSize()) {
                // One strip, on every screen, directly under the app bar. It
                // participates in layout and pushes content down.
                StatusStrip(
                    state = connection,
                    fetchedAt = state.view?.fetchedAt,
                    strandedNotice = state.view?.strandedNotice,
                    silencedUntil = silencedUntil(state),
                    onRetry = viewModel::refresh,
                    onChangeServer = { navController.navigate(Routes.SERVER) },
                    onDismissStranded = viewModel::dismissStrandedNotice,
                    onSeeStranded = { navController.navigate(Routes.SETTINGS_PENDING) },
                )

                // Content cross-fades on a destination change; the chrome above
                // and below does not move.
                Crossfade(
                    targetState = route,
                    animationSpec = tween(if (reduced) Motion.REDUCED else Motion.MEDIUM),
                    label = "destination",
                    modifier = Modifier.fillMaxSize(),
                ) { current ->
                    when (current) {
                        Routes.TODAY -> TodayScreen(
                            state = state,
                            refreshLineVisible = refreshLine,
                            emptyCacheTimedOut = emptyTimedOut,
                            address = prefs.baseUrl,
                            onTick = viewModel::tick,
                            onOpenItem = { /* detail sheet: later milestone */ },
                            onOpenMeterDetail = { /* vsYesterday sheet: later milestone */ },
                            onOpenNeedsYou = { navController.navigate(Routes.DAY) },
                            onStartSessionPicker = { /* session picker: later milestone */ },
                            onStopSession = { /* session stop: later milestone */ },
                            onRetry = viewModel::refresh,
                            onChangeServer = { navController.navigate(Routes.SERVER) },
                            onArmEmptyTimeout = viewModel::armEmptyCacheTimeout,
                        )

                        Routes.DAY -> PlaceholderScreen(
                            title = "Day",
                            willHold = "The ribbon, Needs you, and everything the agent has " +
                                "queued, bucketed Today · Tomorrow · weekday · No time.",
                            liveFact = state.view?.data?.let {
                                "${com.lifeos.app.domain.Predicates.needsYouCount(it)} need you · " +
                                    "${it.timeline.size} timeline blocks"
                            },
                        )

                        Routes.YOU -> PlaceholderScreen(
                            title = "You",
                            willHold = "Goals, the last seven days, and vs. yesterday.",
                            liveFact = state.view?.data?.let {
                                "${it.goals.size} goals · ${it.xpSeries7.size} days of XP"
                            },
                        )
                    }
                }
            }
        }
    }
}

/**
 * One navigation item.
 *
 * `alwaysShowLabel = true` so nothing appears or disappears on selection, and the
 * icon is a `Crossfade` between the outlined and filled variants so the swap
 * happens in place with no travel and no spring.
 */
private fun androidx.compose.material3.adaptive.navigationsuite.NavigationSuiteScope.NavItem(
    route: String,
    current: String,
    label: String,
    selectedIcon: androidx.compose.ui.graphics.vector.ImageVector,
    unselectedIcon: androidx.compose.ui.graphics.vector.ImageVector,
    navController: NavHostController,
    reduced: Boolean,
) {
    val selected = route == current
    item(
        selected = selected,
        onClick = {
            if (!selected) {
                navController.navigate(route) {
                    // Switching destinations must not stack them: Today → Day →
                    // Today is one entry, not three.
                    popUpTo(Routes.TODAY) { saveState = true }
                    launchSingleTop = true
                    restoreState = true
                }
            }
        },
        icon = {
            Crossfade(
                targetState = selected,
                animationSpec = tween(if (reduced) Motion.REDUCED else Motion.SHORT),
                label = "nav-icon-$route",
            ) { isSelected ->
                Icon(
                    imageVector = if (isSelected) selectedIcon else unselectedIcon,
                    contentDescription = label,
                )
            }
        },
        label = { Text(label, style = LifeOsType.label) },
        alwaysShowLabel = true,
    )
}

/**
 * The silenced line's text, or null.
 *
 * DND and quiet hours are read here rather than computed per screen so the
 * strip's wording has exactly one source. Quiet hours wrap past midnight, which
 * is why the comparison is not a naive `start <= now <= end`.
 */
private fun silencedUntil(state: TodayUiState): String? {
    val settings = state.view?.data?.settings ?: return null
    if (settings.doNotDisturb) return "you turn it back on"
    if (!settings.quietHoursSilent) return null
    val now = java.time.LocalTime.now()
    val start = runCatching { java.time.LocalTime.parse(settings.quietHoursStart) }.getOrNull()
        ?: return null
    val end = runCatching { java.time.LocalTime.parse(settings.quietHoursEnd) }.getOrNull()
        ?: return null
    val inside = if (start <= end) now >= start && now < end else now >= start || now < end
    return if (inside) settings.quietHoursEnd else null
}

private val DATE_LABEL = DateTimeFormatter.ofPattern("EEE d MMM")

private fun openUrl(context: android.content.Context, url: String) {
    runCatching {
        context.startActivity(Intent(Intent.ACTION_VIEW, url.toUri()))
    }
}
