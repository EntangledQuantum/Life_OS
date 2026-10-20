package com.lifeos.app.ui

import android.content.Intent
import androidx.activity.compose.BackHandler
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
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.material3.adaptive.currentWindowAdaptiveInfo
import androidx.compose.material3.adaptive.navigationsuite.NavigationSuiteScaffold
import androidx.compose.material3.adaptive.navigationsuite.NavigationSuiteScaffoldDefaults
import androidx.compose.material3.adaptive.navigationsuite.NavigationSuiteType
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.window.core.layout.WindowWidthSizeClass
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
import com.lifeos.app.domain.CelebrationIntensity
import com.lifeos.app.domain.QuietHours
import com.lifeos.app.ui.celebration.CelebrationOverlay
import com.lifeos.app.ui.components.BlockScaffold
import com.lifeos.app.ui.components.NotificationPermissionPrompt
import com.lifeos.app.ui.components.PendingCountBadge
import com.lifeos.app.ui.components.SecondaryScaffold
import com.lifeos.app.ui.components.StatusStrip
import com.lifeos.app.ui.components.UndoSnackbar
import com.lifeos.app.ui.connect.ConnectScreen
import com.lifeos.app.ui.connect.PairStubScreen
import com.lifeos.app.ui.day.DayScreen
import com.lifeos.app.ui.outdated.OutdatedScreen
import com.lifeos.app.ui.server.ServerScreen
import com.lifeos.app.ui.server.ServerViewModel
import com.lifeos.app.ui.settings.AboutScreen
import com.lifeos.app.ui.settings.AppearanceScreen
import com.lifeos.app.ui.settings.ConnectionSettingsScreen
import com.lifeos.app.ui.settings.DaySettingsScreen
import com.lifeos.app.ui.settings.NotificationsRoute
import com.lifeos.app.ui.settings.PendingWritesScreen
import com.lifeos.app.ui.settings.SettingsIndexScreen
import com.lifeos.app.ui.settings.WidgetSettingsScreen
import com.lifeos.app.ui.sheets.AgendaDetailSheet
import com.lifeos.app.ui.sheets.MeterDetailSheet
import com.lifeos.app.ui.sheets.SessionPickerSheet
import com.lifeos.app.ui.sheets.StudyLogSheet
import com.lifeos.app.ui.sheets.TaskSheet
import com.lifeos.app.ui.theme.LifeOsType
import com.lifeos.app.ui.theme.LocalReducedMotion
import com.lifeos.app.ui.theme.Motion
import com.lifeos.app.ui.theme.palette
import com.lifeos.app.ui.today.TodayScreen
import com.lifeos.app.ui.you.YouScreen
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
fun LifeOsRoot(
    container: AppContainer,
    /** `type.key to targetId` from the notification that opened the app, if any. */
    pendingTap: Pair<String, String>? = null,
    onTapRead: () -> Unit = {},
) {
    val context = LocalContext.current
    val navController = rememberNavController()
    val viewModel: LifeOsViewModel = viewModel(
        factory = LifeOsViewModel.factory(container, context.applicationContext),
    )

    /*
     * Which of the three pages is showing, hoisted above the NavHost.
     *
     * Above it, because a notification tap or a Needs-you link has to be able
     * to land on Day from anywhere — including from Settings, where the shell
     * is not even composed — and because the pager's position must survive a
     * trip into a settings screen and back.
     */
    val tabs = rememberHomeTabsState()
    val reduced = LocalReducedMotion.current

    val connection by viewModel.connection.collectAsStateWithLifecycle()
    val prefsFlow = remember { container.preferences.prefs }
    val prefs by prefsFlow.collectAsStateWithLifecycle(
        initialValue = com.lifeos.app.data.AppPrefs(),
    )
    val rootState by viewModel.state.collectAsStateWithLifecycle()
    val celebration by viewModel.celebration.collectAsStateWithLifecycle()

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

    /*
     * The notification tap (§8.4), handled in exactly one place.
     *
     * The Activity collects both the cold-start intent and `onNewIntent` into
     * one value; this turns it into a destination plus a sheet. A reminder opens
     * Today with the row's sheet expanded, a Needs-you opens Day, and a
     * Goal-ready opens nothing because the celebration is already a global
     * overlay over every destination.
     */
    LaunchedEffect(pendingTap) {
        val tap = pendingTap ?: return@LaunchedEffect
        viewModel.onNotificationTap(tap.first, tap.second)
        onTapRead()
    }

    val tap by viewModel.notificationTap.collectAsStateWithLifecycle()
    LaunchedEffect(tap) {
        val current = tap ?: return@LaunchedEffect
        when (current.type) {
            // A sync problem is the one tap that lands outside the shell.
            com.lifeos.app.domain.NotificationType.SYNC_PROBLEM ->
                navController.navigate(Routes.SETTINGS_PENDING) { launchSingleTop = true }

            else -> {
                val tab = if (current.type == com.lifeos.app.domain.NotificationType.NEEDS_YOU) {
                    HomeTab.DAY
                } else {
                    HomeTab.TODAY
                }
                navController.navigate(Routes.TODAY) { launchSingleTop = true }
                tabs.jumpTo(tab, reduced)
            }
        }
        viewModel.consumeNotificationTap(current)
    }

    NavHost(
        navController = navController,
        startDestination = if (prefs.baseUrl.isNullOrBlank()) Routes.CONNECT else Routes.TODAY,
    ) {
        /* ---- the three top-level destinations: one route, three pages ---- */
        composable(Routes.TODAY) {
            AppShell(
                tabs = tabs,
                navController = navController,
                viewModel = viewModel,
                container = container,
                prefs = prefs,
            )
        }

        /* ---- the three that work without the shell ---- */

        composable(Routes.CONNECT) {
            BlockScaffold {
                ConnectScreen(
                    onScanQr = { navController.navigate(Routes.PAIR) },
                    onEnterManually = { navController.navigate(Routes.SERVER) },
                    onWhereDoIFindThis = { openUrl(context, NETWORK_DOCS) },
                )
            }
        }

        composable(Routes.PAIR) {
            SecondaryScaffold(title = "Pair", onBack = navController::popBackStack) {
                PairStubScreen(onEnterManually = { navController.navigate(Routes.SERVER) })
            }
        }

        composable(Routes.SERVER) {
            val serverVm: ServerViewModel = viewModel(factory = ServerViewModel.factory(container))
            val serverState by serverVm.state.collectAsStateWithLifecycle()
            SecondaryScaffold(
                title = "Server",
                // `server` is reachable from five places, including states with
                // nothing behind it on the stack. Popping to nothing would leave
                // a blank window, so an empty stack lands on Today.
                onBack = { if (!navController.popBackStack()) navController.navigate(Routes.TODAY) },
            ) {
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
        }

        composable(Routes.OUTDATED) {
            val state = connection
            BlockScaffold {
                OutdatedScreen(
                    mismatch = (state as? ConnectionState.Outdated)?.mismatch
                        ?: com.lifeos.app.data.api.ProtocolMismatchDto(),
                    clientProtocol = ApiClient.clientProtocol,
                    onDownload = { url -> openUrl(context, url) },
                    onChangeServer = { navController.navigate(Routes.SERVER) },
                )
            }
        }

        /* ---- settings: a leaf graph behind the gear ---- */

        composable(Routes.SETTINGS) {
            SecondaryScaffold(title = "Settings", onBack = navController::popBackStack) {
                SettingsIndexScreen(
                    onOpen = { page ->
                        when (page) {
                            "appearance" -> navController.navigate(Routes.SETTINGS_APPEARANCE)
                            "notifications" -> navController.navigate(Routes.SETTINGS_NOTIFICATIONS)
                            "day" -> navController.navigate(Routes.SETTINGS_DAY)
                            "connection" -> navController.navigate(Routes.SETTINGS_CONNECTION)
                            "widget" -> navController.navigate(Routes.SETTINGS_WIDGET)
                            "about" -> navController.navigate(Routes.SETTINGS_ABOUT)
                            else -> Unit
                        }
                    },
                )
            }
        }

        composable(Routes.SETTINGS_DAY) {
            val state by viewModel.state.collectAsStateWithLifecycle()
            SecondaryScaffold(title = "The day", onBack = navController::popBackStack) {
                DaySettingsScreen(
                    settings = state.view?.settings
                        ?: com.lifeos.app.data.api.SettingsDto(),
                    onPatchString = viewModel::patchSetting,
                    onPatchInt = viewModel::patchSetting,
                )
            }
        }

        composable(Routes.SETTINGS_NOTIFICATIONS) {
            val state by viewModel.state.collectAsStateWithLifecycle()
            SecondaryScaffold(title = "Notifications", onBack = navController::popBackStack) {
                NotificationsRoute(
                    container = container,
                    settings = state.view?.settings ?: com.lifeos.app.data.api.SettingsDto(),
                    onPatchBool = viewModel::patchSetting,
                    onPatchString = viewModel::patchSetting,
                )
            }
        }

        composable(Routes.SETTINGS_WIDGET) {
            SecondaryScaffold(title = "Home screen widget", onBack = navController::popBackStack) {
                WidgetSettingsScreen()
            }
        }

        composable(Routes.SETTINGS_APPEARANCE) {
            val scope = androidx.compose.runtime.rememberCoroutineScope()
            SecondaryScaffold(title = "Appearance", onBack = navController::popBackStack) {
                AppearanceScreen(
                    currentPaletteId = prefs.paletteId,
                    reducedMotionLocal = prefs.reducedMotionLocal,
                    onPickPalette = { id -> scope.launch { container.preferences.setPalette(id) } },
                    onReducedMotionChange = { value ->
                        scope.launch { container.preferences.setReducedMotion(value) }
                    },
                )
            }
        }

        composable(Routes.SETTINGS_CONNECTION) {
            val state by viewModel.state.collectAsStateWithLifecycle()
            val scope = androidx.compose.runtime.rememberCoroutineScope()
            SecondaryScaffold(title = "Connection", onBack = navController::popBackStack) {
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
        }

        composable(Routes.SETTINGS_PENDING) {
            val writes by viewModel.pendingWrites.collectAsStateWithLifecycle()
            SecondaryScaffold(title = "Pending writes", onBack = navController::popBackStack) {
                PendingWritesScreen(
                    writes = writes,
                    onRetryAll = viewModel::retryAllStranded,
                    onDiscard = viewModel::discardStranded,
                )
            }
        }

        composable(Routes.SETTINGS_ABOUT) {
            SecondaryScaffold(title = "About", onBack = navController::popBackStack) {
                AboutScreen(
                    versionName = BuildConfig.VERSION_NAME,
                    protocol = ApiClient.clientProtocol,
                    applicationId = BuildConfig.APPLICATION_ID,
                )
            }
        }
    }

    /*
     * The celebration (§3.4): **global**, outside the NavHost.
     *
     * Outside, not inside a screen, for two reasons. It must fire on Today, on
     * Day, on You, in Settings and on cold start — anywhere the user happens to
     * be when the goal lands. And it must cover the navigation bar: a
     * celebration with a reachable nav item behind it would let the user leave a
     * goal unwitnessed, and the goal is not finished until they have seen it.
     */
    celebration?.let {
        CelebrationOverlay(
            celebration = it,
            intensity = CelebrationIntensity.of(rootState.view?.settings?.celebrationIntensity),
            onDismiss = viewModel::dismissCelebration,
        )
    }
}

/**
 * The navigation shell (§2.4, §5.4).
 *
 * Bar-vs-rail still comes from `currentWindowAdaptiveInfo()`, never from a
 * device-type check, because Android resizes the app while it runs.
 *
 * **The bottom bar still does not travel on its own.** The old app animated a
 * critically-damped pill the full width of five tabs at the exact bottom edge
 * where the thumb already draws attention, carrying no information about the
 * content that changed. A tap here moves the pages instantly and the indicator
 * cross-fades in place: zero pixels of travel, as before.
 *
 * What is new in milestone 4 is that a **swipe** moves the pages under the
 * finger, and the indicator goes with them — continuously, as they move. That
 * is not the same thing as the old pill: there the chrome animated by itself
 * after a tap; here the user is dragging it. §5.4 now says so explicitly.
 *
 * The compact bar is `TrackingNavigationBar` rather than a standard item list,
 * because a `NavigationBarItem` cannot be told where to put its indicator. The
 * rail keeps the standard items — there is no horizontal page to track against
 * a vertical rail, and the swipe still works underneath it.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun AppShell(
    tabs: HomeTabsState,
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
    val analytics by viewModel.analytics.collectAsStateWithLifecycle()
    val sheet by viewModel.sheet.collectAsStateWithLifecycle()
    val undoPrompt by viewModel.undoPrompt.collectAsStateWithLifecycle()

    /*
     * §2.4: the content columns come from the window, not from a device check —
     * Android resizes the app while it runs (split screen, free-form,
     * unfolding), so this is read per composition rather than decided once.
     */
    val adaptiveInfo = currentWindowAdaptiveInfo()
    val expanded = adaptiveInfo.windowSizeClass.windowWidthSizeClass ==
        WindowWidthSizeClass.EXPANDED

    val suiteType = NavigationSuiteScaffoldDefaults.calculateFromAdaptiveInfo(adaptiveInfo)
    val bottomBar = suiteType == NavigationSuiteType.NavigationBar

    val route = tabs.current

    /*
     * The poll belongs to the destination, and there is only ever one of it.
     *
     * Keyed to the **settled** page rather than the nearest one, or a single
     * swipe across the app would start and stop three polls on its way.
     */
    LaunchedEffect(tabs.settled) {
        viewModel.startPolling(
            when (tabs.settled) {
                HomeTab.DAY -> PollIntervals.DAY_MS
                HomeTab.YOU -> PollIntervals.YOU_MS
                else -> PollIntervals.TODAY_MS
            },
        )
    }

    // Back from a page is back to Today, which is what the old
    // `popUpTo(TODAY) { saveState }` navigation produced. On Today it is not
    // handled here at all, so back leaves the app as it always did.
    BackHandler(enabled = route != HomeTab.TODAY) {
        tabs.jumpTo(HomeTab.TODAY, reduced)
    }

    NavigationSuiteScaffold(
        // On a phone the bar is ours (it has to track the gesture); the rail
        // for wider windows is the standard one.
        layoutType = if (bottomBar) NavigationSuiteType.None else suiteType,
        navigationSuiteItems = {
            if (!bottomBar) {
                HomeTab.all.forEach { tab ->
                    RailItem(
                        tab = tab,
                        current = route,
                        reduced = reduced,
                        onSelect = { tabs.jumpTo(tab, reduced) },
                    )
                }
            }
        },
        containerColor = p.bg,
        contentColor = p.text,
    ) {
        Scaffold(
            containerColor = p.bg,
            bottomBar = {
                if (bottomBar) {
                    TrackingNavigationBar(
                        state = tabs,
                        reduced = reduced,
                        icon = { tab, filled ->
                            Icon(
                                imageVector = tabIcon(tab, filled),
                                contentDescription = tab.label,
                            )
                        },
                        onSelect = { tabs.jumpTo(it, reduced) },
                    )
                }
            },
            topBar = {
                TopAppBar(
                    title = {
                        if (route == HomeTab.TODAY) {
                            // The date in mono, small — it is a figure, not a heading.
                            com.lifeos.app.ui.components.Mono(
                                text = LocalDate.now().format(DATE_LABEL),
                                style = LifeOsType.mono14,
                                color = p.text,
                            )
                        } else {
                            Text(
                                text = route.label,
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
            Box(modifier = Modifier.padding(padding).fillMaxSize()) {
            Column(modifier = Modifier.fillMaxSize()) {
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

                /*
                 * The notification permission, asked in context (§8.2) — and
                 * here rather than on Today because it is chrome: it belongs
                 * wherever the user happens to be when the day first has
                 * something scheduled in it. It draws nothing at all unless
                 * there is a reminder to be had and permission is missing.
                 */
                val promptScope = androidx.compose.runtime.rememberCoroutineScope()
                NotificationPermissionPrompt(
                    data = state.view?.data,
                    leadMinutes = state.view?.settings?.reminderLeadMinutes
                        ?: com.lifeos.app.domain.Reminders.DEFAULT_LEAD_MINUTES,
                    alreadyAsked = prefs.notificationPermissionAsked,
                    onAsked = {
                        promptScope.launch {
                            container.preferences.setNotificationPermissionAsked(true)
                        }
                    },
                )

                /*
                 * The three pages.
                 *
                 * A tap still cross-fades them with the chrome standing still
                 * (§5.3). A swipe moves them under the finger instead, and the
                 * bar's indicator goes with them (§5.4). Both live in
                 * `HomeTabPager`.
                 */
                HomeTabPager(
                    state = tabs,
                    reduced = reduced,
                    modifier = Modifier.fillMaxSize(),
                ) { current ->
                    when (current) {
                        HomeTab.TODAY -> TodayScreen(
                            state = state,
                            refreshLineVisible = refreshLine,
                            emptyCacheTimedOut = emptyTimedOut,
                            address = prefs.baseUrl,
                            expanded = expanded,
                            onTick = viewModel::tick,
                            onOpenItem = { viewModel.openSheet(AppSheet.Agenda(it.id)) },
                            onOpenMeterDetail = { viewModel.openSheet(AppSheet.MeterDetail) },
                            onOpenNeedsYou = { tabs.jumpTo(HomeTab.DAY, reduced) },
                            onStartSessionPicker = {
                                viewModel.openSheet(AppSheet.SessionPicker)
                            },
                            onStopSession = viewModel::stopSession,
                            onRetry = viewModel::refresh,
                            onChangeServer = { navController.navigate(Routes.SERVER) },
                            onArmEmptyTimeout = viewModel::armEmptyCacheTimeout,
                        )

                        HomeTab.DAY -> DayScreen(
                            state = state,
                            refreshLineVisible = refreshLine,
                            emptyCacheTimedOut = emptyTimedOut,
                            address = prefs.baseUrl,
                            expanded = expanded,
                            onOpenTask = { viewModel.openSheet(AppSheet.Task(it.id)) },
                            onCompleteTask = viewModel::completeTask,
                            onDismissTask = viewModel::dismissTask,
                            onLogStudy = { viewModel.openSheet(AppSheet.StudyLog) },
                            onRetry = viewModel::refresh,
                            onChangeServer = { navController.navigate(Routes.SERVER) },
                            onArmEmptyTimeout = viewModel::armEmptyCacheTimeout,
                        )

                        HomeTab.YOU -> YouScreen(
                            state = state,
                            analytics = analytics,
                            refreshLineVisible = refreshLine,
                            emptyCacheTimedOut = emptyTimedOut,
                            address = prefs.baseUrl,
                            onToggleAnalytics = viewModel::toggleAnalytics,
                            onSelectRange = viewModel::selectRange,
                            onRetry = viewModel::refresh,
                            onChangeServer = { navController.navigate(Routes.SERVER) },
                            onArmEmptyTimeout = viewModel::armEmptyCacheTimeout,
                        )
                    }
                }
            }

            /*
             * The 5-second undo snackbar (§4.6) — the only transient surface on
             * Today. It insets above the navigation bar rather than covering it.
             */
            val prompt = undoPrompt
            UndoSnackbar(
                visible = prompt != null,
                message = prompt?.let { "${it.item.title} done" } ?: "",
                promptKey = prompt?.item?.refId,
                onUndo = { prompt?.let { viewModel.undo(it.item) } },
                onTimeout = viewModel::dismissUndoPrompt,
                modifier = Modifier.align(Alignment.BottomCenter),
            )
            }
        }
    }

    /* ---- the sheets, hosted once for all three destinations ---- */

    SheetHost(
        sheet = sheet,
        state = state,
        viewModel = viewModel,
        onOpenLink = { openUrl(context, it) },
    )
}

/**
 * The five sheets of §2.3, hosted once.
 *
 * One host rather than one per screen, because `agenda/{id}` opens from Today,
 * `task/{id}` opens from Day *and* from a Needs-you row *and* (later) from a
 * notification tap, and three copies of the same sheet is three places for it
 * to drift.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun SheetHost(
    sheet: AppSheet?,
    state: TodayUiState,
    viewModel: LifeOsViewModel,
    onOpenLink: (String) -> Unit,
) {
    if (sheet == null) return
    val data = state.view?.data ?: return
    val p = palette

    ModalBottomSheet(
        onDismissRequest = viewModel::closeSheet,
        containerColor = p.surface,
        contentColor = p.text,
        scrimColor = p.scrim,
    ) {
        when (sheet) {
            is AppSheet.Agenda -> {
                val item = data.agenda.firstOrNull { it.id == sheet.id }
                    ?: data.anytime.firstOrNull { it.id == sheet.id }
                if (item == null) {
                    viewModel.closeSheet()
                } else {
                    AgendaDetailSheet(
                        item = item,
                        habit = com.lifeos.app.domain.Predicates.habitFor(data, item),
                        task = data.tasks.firstOrNull { it.id == item.refId },
                        streaksEnabled = state.view.settings.streaksEnabled,
                        onUndo = {
                            viewModel.undo(item)
                            viewModel.closeSheet()
                        },
                        onComplete = {
                            viewModel.tick(item)
                            viewModel.closeSheet()
                        },
                        onOpenLink = onOpenLink,
                    )
                }
            }

            is AppSheet.Task -> {
                val task = data.tasks.firstOrNull { it.id == sheet.id }
                if (task == null) {
                    viewModel.closeSheet()
                } else {
                    TaskSheet(
                        task = task,
                        timezone = data.lifeDay.timezone,
                        onComplete = {
                            viewModel.completeTask(task.id)
                            viewModel.closeSheet()
                        },
                        onDismiss = {
                            viewModel.dismissTask(task.id)
                            viewModel.closeSheet()
                        },
                        onOpenLink = onOpenLink,
                    )
                }
            }

            AppSheet.MeterDetail -> MeterDetailSheet(data = data)

            AppSheet.SessionPicker -> SessionPickerSheet(onPick = viewModel::startSession)

            AppSheet.StudyLog -> StudyLogSheet(onLog = viewModel::logStudy)
        }
    }
}

/**
 * The icon for a tab, filled or outlined.
 *
 * One mapping, read by the bottom bar and the rail, so the two cannot end up
 * showing different pictures of the same destination.
 */
private fun tabIcon(tab: HomeTab, filled: Boolean) = when (tab) {
    HomeTab.TODAY -> if (filled) Icons.Filled.WbSunny else Icons.Outlined.WbSunny
    HomeTab.DAY -> if (filled) Icons.Filled.CalendarToday else Icons.Outlined.CalendarToday
    HomeTab.YOU -> if (filled) Icons.Filled.Person else Icons.Outlined.Person
}

/**
 * One rail item, for windows wide enough to get a rail instead of a bar.
 *
 * `alwaysShowLabel = true` so nothing appears or disappears on selection, and
 * the icon is a `Crossfade` between the outlined and filled variants so the
 * swap happens in place with no travel and no spring. The rail does not track
 * the swipe: it is vertical, and there is nothing sideways for it to follow.
 */
private fun androidx.compose.material3.adaptive.navigationsuite.NavigationSuiteScope.RailItem(
    tab: HomeTab,
    current: HomeTab,
    reduced: Boolean,
    onSelect: () -> Unit,
) {
    val selected = tab == current
    item(
        selected = selected,
        onClick = { if (!selected) onSelect() },
        icon = {
            Crossfade(
                targetState = selected,
                animationSpec = tween(if (reduced) Motion.REDUCED else Motion.SHORT),
                label = "nav-icon-${tab.name}",
            ) { isSelected ->
                Icon(
                    imageVector = tabIcon(tab, isSelected),
                    contentDescription = tab.label,
                )
            }
        },
        label = { Text(tab.label, style = LifeOsType.label) },
        alwaysShowLabel = true,
    )
}

/**
 * The silenced line's text, or null.
 *
 * The comparison itself lives in `domain/QuietHours` and is **not** written
 * here. It used to be: this function had its own `LocalTime` version of the
 * wrap-past-midnight rule, and the notification layer was about to grow a
 * second one. One predicate, one definition — the strip and the notifier now
 * disagree only if the shared function is wrong, in which case a test fails.
 */
private fun silencedUntil(state: TodayUiState): String? {
    val settings = state.view?.settings ?: return null
    val now = java.time.LocalTime.now()
    return QuietHours.silencedUntil(settings, now.hour * 60 + now.minute)
}

private val DATE_LABEL = DateTimeFormatter.ofPattern("EEE d MMM")

private fun openUrl(context: android.content.Context, url: String) {
    runCatching {
        context.startActivity(Intent(Intent.ACTION_VIEW, url.toUri()))
    }
}
