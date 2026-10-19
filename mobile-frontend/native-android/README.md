# Life OS for Android

A native Android client for Life OS: Kotlin, Jetpack Compose, Material 3, dark only.
This replaces the Expo/React-Native app in `mobile-frontend/app/`, which stays in the
repository and keeps working as a fallback. Nothing here touches it.

Product and interaction decisions live in [`docs/UI_SPEC.md`](docs/UI_SPEC.md). That file is
the source of truth; this one is how to build and how the code is arranged.

**Milestone 4** — three things the user asked for after living with the app on their phone,
and the gap milestone 3 flagged: the growth meter is centred and its glow is no longer
clipped, a horizontal swipe moves between Today · Day · You with the navigation bar's
indicator tracking the finger, and the widget presents itself properly in the launcher's
picker. What is and is not built is listed under [Status](#status).

Earlier: **milestone 3** — background reliability: notifications with per-type sounds and
real channels, `AlarmManager`-seeded reminders, periodic background sync, and the Glance
home screen widget.

---

## Build

The toolchain is pinned, and the combination matters: AGP 8.x must not run on Gradle 9.

| Thing | Version |
|---|---|
| JDK | 17 |
| Gradle (wrapper) | 8.13 |
| Android Gradle Plugin | 8.9.1 |
| Kotlin | 2.1.20 (+ Compose compiler plugin) |
| Compose BOM | 2025.04.01 |
| Room | 2.7.1 |
| Glance (app widget) | 1.1.1 |
| compileSdk / targetSdk / minSdk | 35 / 35 / 26 |

```powershell
# from mobile-frontend/native-android
$env:JAVA_HOME = "C:\Users\<you>\AppData\Local\Programs\Microsoft\jdk-17.0.10.7-hotspot"
$env:ANDROID_HOME = "C:\Android\sdk"

.\gradlew assembleDebug      # app/build/outputs/apk/debug/app-debug.apk
.\gradlew assembleRelease    # unsigned; this is where the cleartext trap hides
.\gradlew test               # unit tests — no device, no server
.\gradlew lint               # reports; does not gate the build
```

The build needs no `local.properties`: `ANDROID_HOME` is enough. It builds from a cold clone
with no other setup — **including the notification sounds**, which are committed WAVs in
`app/src/main/res/raw/`. `scripts/build-sounds.mjs` regenerates them from the note tables in
`apps/web/src/lib/notify.ts`, and is run by hand when a sound design changes:

```powershell
node scripts\build-sounds.mjs   # rewrites app/src/main/res/raw/*.wav — commit the output
```

A build must never depend on having run it. `WidgetAndSoundsTest` pins the committed files
against the durations those note tables imply, so a stale `res/raw` fails `test` rather than
shipping a chime that is no longer the web client's chime. The five files are byte-identical
to the Expo app's `assets/sounds/`, which is the same renderer over the same tables.

> **If Gradle says `Plugin [id: 'com.android.application'] was not found`** and claims it only
> searched the Gradle Central Plugin Repository, check that nothing — not even a comment —
> precedes `pluginManagement { }` in `settings.gradle.kts`. Gradle enforces "pluginManagement
> must be first" textually, and a leading block comment silently discards the whole
> `repositories` block. This cost a build here.

## Install to a device

```powershell
adb install -r app\build\outputs\apk\debug\app-debug.apk
```

The debug build has `applicationIdSuffix = ".dev"` and the label **Life OS dev**, so it
installs **alongside** a release/Play build of `com.lifeos.app` instead of replacing it. That
is deliberate: this app is tested on a daily-driver phone, and a dev install must not clobber
the real one.

On first launch: **Enter the address manually** → the address (e.g. `192.168.1.4` — the
scheme and port `8787` are filled in for you) and the `API_TOKEN` from your Life OS `.env`
→ **Test** → **Save**.

To see the server's address as the phone must reach it, run Life OS and read the boot banner,
or `GET /api/v1/pair/reachability`. If **Test** reports `lan: false`, the server is bound to
loopback only and no phone can reach it — see [`docs/NETWORK.md`](../../docs/NETWORK.md).

To place the widget: long-press the home screen → **Widgets** → **Life OS**. It has no
settings of its own — it follows the app's palette, reads the same cache, and is refreshed by
the same background sync.

---

## Architecture

The UI reads **only** Room; the network is a background concern that catches up. A cold start
renders the cached snapshot in the first frame, and a tap is a row of `pending_writes` plus
an optimistic overlay, never a request the user waits on. `LifeOsRepository` is the single
seam: it owns the connection state machine (§7.2), stores each
`GET /api/v1/dashboard/today` into the one-row `snapshot` table, and drains the write queue
in enqueue order through `WorkManager` with backoff. Writes are stamped at tap time with the
life-day that was then current, and the **life-day guard** (`LifeDayGuard`) refuses to send
one whose stamp no longer matches the server's life-day — it strands instead, surfaces once,
and is never re-dated, because a habit tick replayed after the 04:00 reset silently corrupts
a streak and losing the write is the lesser harm. Above that, one `LifeOsViewModel` owns the
poll (8s/10s/15s by destination, never started from a composition) and the agenda's ordering
**epoch**, which freezes row order so a ticked row cannot move; Compose screens are pure
functions of the state it emits. There is no DI framework — `AppContainer` wires a dozen
objects by constructor — and no telemetry, analytics or crash-reporting SDK anywhere.

```
Compose  ──reads──►  Room  ◄──writes──  LifeOsRepository ──► OkHttp/Retrofit
Widget   ──reads──►   ▲ ▲                      ▲
Reminders──reads──►   │ │                      │ SyncWorker (WorkManager)
   │ tap              │ │                      └─ life-day guard
   └─► pending_writes ┘ └─ fired_notifications ◄── ReminderCoordinator ──► AlarmManager
```

The widget and the notification layer are **readers**, exactly like the UI: they collect the
same Room snapshot and neither of them fetches. That is what keeps one seam — a widget with
its own network call is a widget showing a spinner on a home screen, and a notification layer
with its own fetch is a second connection state machine to keep in agreement with the first.

**Two reads, not one.** `GET /api/v1/dashboard/today` carries no `settings` key — the
server does not put one there — so settings are a second request on the same poll, cached in
their own one-row table (`server_settings`, database version 2, hand-written migration). They
are deliberately separate rows because either request can fail on its own: a settings fetch
that fails must not discard a dashboard that succeeded, and an app that has never reached
`/settings` still has to draw Today. Milestone 1 modelled `settings` as a field on the
dashboard DTO with defaults, which meant `streaksEnabled`, `celebrationIntensity` and the
quiet hours looked wired while always reading the default; that field is gone.

The **one** screen-specific network read is `GET /api/v1/analytics`, and only for 30d/90d/all.
`7d` is drawn from `xpSeries7` in the snapshot the whole app already has, so it renders
offline and costs no request. Analytics is never polled and never cached in Room: it is a
question the user asked by tapping a chip.

| Package | Holds |
|---|---|
| `domain` | Pure Kotlin, no Android: the life-day, the guard, the overlay, the agenda epoch, the growth geometry, the notification derivation rules, the widget's tier rule, and **every filtering/counting predicate** |
| `data` | Room, Retrofit/OkHttp, the token store, preferences, the repository, the sync worker |
| `notify` | Channels, posting, `AlarmManager` seeding, the three receivers, and the runner |
| `widget` | The Glance app widget and its two actions |
| `ui` | Compose. `theme` holds the palettes and the non-themed token objects |

### Notifications (§8.1–§8.4)

The arithmetic is in `domain/Reminders.kt` and has no Android in it: the derived time
(`remindAt ?? eventAt - reminderLeadMinutes`), the window (`eventAt + durationMinutes`,
which an item leaves whether or not it was completed), the quiet-hours comparison that
**wraps past midnight**, the once-only rule, and which sound a type resolves to. That is the
part four separate bugs lived in, so it is the part with tests.

`notify/` is the thin Android layer above it. Three things in it are deliberate:

**One channel per sound, with the sound in the id.** A channel's sound is fixed when it is
created and the OS owns it from then on. Sharing a channel across sounds is not a shortcut,
it is a picker that silently does nothing — which the old app shipped for its whole life. So
ids are `lifeos-<type>-<soundId>`, changing a sound creates the new channel and deletes the
old one, and adding a sixth sound later touches no existing channel. The Settings page also
links out to `ACTION_CHANNEL_NOTIFICATION_SETTINGS` for the live channel, because once the OS
owns the sound, the OS's own screen is the authority and ours is a convenience.

**The runner is not owned by a screen.** `ReminderCoordinator` is created by `AppContainer`
and started from `LifeOsApp.onCreate`, and it collects Room. In the old app the equivalent
was mounted by the Today screen, so if the app opened anywhere else — which includes every
notification tap — nothing was ever registered with the OS.

**The once-only set is a table, and the claim is an `INSERT OR IGNORE`.** `fired_notifications`
(database version 3) survives the process, so a reminder does not say itself again on the next
cold start; and SQLite decides who wins, so the alarm receiver and the in-app poll racing
cannot both fire. `POST /tasks/:id/notified` is enqueued **before** anything about audio or
visuals is decided, so it still happens under DND and quiet hours — that is a contract, not an
optimisation, and skipping it means every suppressed reminder arrives the instant DND ends.

Taps go through one handler fed by **both** `onCreate`'s intent and `onNewIntent`. The
listener alone misses the cold start, which is the common case because the notification is why
the app is opening.

### What background delivery actually guarantees

Stated plainly, because the alternative is promising something the platform will not deliver.

| Mechanism | What it is for | What Android actually promises |
|---|---|---|
| `AlarmManager` alarms, seeded from the derived times | The reminders themselves | **Strong.** `setExactAndAllowWhileIdle` when the user has allowed exact alarms — to the minute, through Doze. `setAndAllowWhileIdle` when they have not: still escapes Doze, but the OS may batch it, and in deep Doze that can be several minutes late |
| `WorkManager` periodic sync, 15 min | Keeping the cache and the widget current | **Weak, and best-effort.** Fifteen minutes is a floor, not a schedule. In Doze it is deferred to maintenance windows, hours apart on an idle phone overnight; OEM battery management (ColorOS, which this is tested on, among the stricter) can defer or drop it until the app is next opened |
| The foreground poll | The screen you are looking at | Exact, and irrelevant the moment the app is backgrounded |

So **nothing the user must hear depends on the periodic work.** It is a freshener. The things
that must arrive are alarms, which is a much stronger promise, and they are re-seeded on every
poll, on `BOOT_COMPLETED`, on a timezone change and on `MY_PACKAGE_REPLACED` — all four of
which clear what the OS was holding.

`SCHEDULE_EXACT_ALARM` is declared; `USE_EXACT_ALARM` is **not**, and will not be. The latter
cannot be revoked and is reserved by policy for alarm clocks and calendars; a habit tracker
claiming it is what gets an app flagged. On the Android 16 test device exact alarms are **not**
granted by default, so the inexact path is the one that actually runs — Settings →
Notifications says so in words and links to the screen that grants it. There is no foreground
service and no persistent notification.

### Two rules the code enforces structurally

**A theme swaps colours and nothing else.** `Palette` is a data class of fourteen colour
fields and nothing else. Spacing, radii, the type scale, motion durations, the leaf
thresholds and the seven `ActivityColors` live in separate objects that take no palette, so a
theme physically cannot reach them. `ActivityColors` in particular is not part of a palette:
the seven day buckets must mean the same colour in every theme, on the phone, in the widget
and on the web, or the ribbon needs a legend.

**One predicate, one definition.** `domain/Predicates.kt` is the only place a filtering or
counting rule is written. This exists because of a real bug in this repository: the web client
shows a "2" badge on a nav tab pointing at a page that renders nothing, because the badge
counts every active task while the page filters pinned ones out — the same rule, hand-written
twice, drifted apart. Today's "Needs you · N" and Day's list call the same function, and a
test asserts the count equals the length of the list it counts. If a count and a list can
disagree, the bug is already written.

Day makes that structural rather than careful: `Predicates.dayPartition` splits the visible
tasks into **Needs you** and **Scheduled** in one pass, so the two are disjoint and complete
by construction, and `DayBuckets` buckets only what the partition handed it. A test asserts
both halves: nothing appears in both lists, and together they are exactly what
`Predicates.scheduled` returns.

Milestone 3 added three surfaces that could each have grown their own copy of a rule, and
did not: the notification layer's "needs you" **is** `Predicates.needsYou` (a notification
about a review Day does not list is the same bug with a sound on it), the widget's next-up
**is** the server's own agenda order, and the widget's ribbon **is** `Ribbon.segments`,
quantised. It also removed a copy that had already appeared: the status strip's quiet-hours
comparison was hand-written in `LifeOsRoot` and the notifier was about to write a second one,
so both now call `domain/QuietHours` — which is the comparison that wraps past midnight, and
therefore exactly the kind nobody wants two of.

---

## Isolation contract

This folder is a **standalone Gradle build**. The contract from
[`mobile-frontend/README.md`](../README.md) applies in full:

- It is **never** added to the pnpm workspace. It has its own toolchain and its own lockfile
  semantics, and `pnpm -r` must not reach it.
- It **never** imports from `apps/*` or `packages/*`. Its only contact with the rest of Life
  OS is HTTP to `http://<host>:8787/api/v1/...`.
- Constants and geometry are **copied on purpose and must stay copies.** Three of them are
  load-bearing, so each copy is pinned by a unit test rather than by good intentions:

  | Copied from | To | Pinned by |
  |---|---|---|
  | `packages/shared/src/protocol.ts` (`PROTOCOL_VERSION`) | `buildConfigField LIFEOS_PROTOCOL` | `AddressInputTest` |
  | `packages/shared/src/{growth,journey}.ts` | `domain/Growth.kt`, `ui/theme/GrowthTokens` | `GrowthGeometryTest` |
  | `packages/shared/src/agenda.ts` (`compareAgenda`), `tasks.ts` (`isPinned`) | `domain/Predicates.kt` | `OverlayAndEpochTest` |
  | `mobile-frontend/app/lib/theme.ts` (`ACTIVITY_COLORS`) | `ui/theme/ActivityColors` | — |
  | `packages/shared/src/schedule.ts` (`notifyAt`, `isWithinQuietHours`) | `domain/Reminders.kt` | `RemindersTest` |
  | `apps/web/src/lib/notify.ts` (the five note tables) | `scripts/build-sounds.mjs` → `res/raw/*.wav` | `WidgetAndSoundsTest` |

  Change the TypeScript and these tests fail, which is the whole point: a drifted copy makes
  the phone and the desktop different objects.
- The bundled fonts (Outfit, Figtree, JetBrains Mono — all SIL OFL, see
  `FONT_LICENSE.txt`) are file copies, not a dependency on the Expo app's `node_modules`.

Nothing outside this folder was modified.

---

## Things that will bite you

**Cleartext HTTP.** Life OS is reached over plain `http://` on a LAN, and Android 9+ blocks
cleartext by default — a **release** build then fails every request at the socket layer while
debug works fine, invisibly, until someone installs the APK. `res/xml/network_security_config.xml`
permits it from the base config (the address is user-entered and can be any private range, a
`.local` name or a `*.ts.net` name, so an allow-list of literal hosts cannot cover it), and
the manifest references it for every build type. Verified present in the release APK:

```powershell
aapt2 dump xmltree --file AndroidManifest.xml app\build\outputs\apk\release\app-release-unsigned.apk
```

Symptom if it goes missing: "can't reach the server" while the same URL loads in the phone's
browser. `adb logcat | findstr /i cleartext` prints the real error.

**The protocol number is 3, not 2.** `docs/API.md` still documents `X-LifeOS-Protocol: 2`;
`packages/shared/src/protocol.ts` says `PROTOCOL_VERSION = 3` and the running server agrees
(`GET /api/v1/protocol` → `{"protocol":3,"minProtocol":3}`). UI_SPEC §7.7's "protocol 2" is
likewise stale. `protocol.ts` is the source of truth and this app sends 3.

**The token is never logged — and never handed to the keyboard.** It lives in Keystore-backed
`EncryptedSharedPreferences`, is mirrored in memory only so the OkHttp interceptor does not hit
the Keystore per request, and there is deliberately **no logging interceptor at any build
type** — one would print the `Authorization` header. Backup and device-transfer are excluded in
`res/xml/data_extraction_rules.xml` so it cannot leave the device that way either.

The second half of that was a real leak, found by typing into the field on a phone. The token
field masked correctly, so it looked right, but the IME's **suggestion strip displayed the
token in plaintext** as it was typed — which means the keyboard had the value, could show it
to anyone looking at the screen, and could add it to its personalised dictionary. The fix is
`KeyboardType.Password`: `VisualTransformation` is a drawing concern and buys none of this.
Verified on the device rather than assumed — `adb shell dumpsys input_method` reports
`inputType=0x81` (`TYPE_CLASS_TEXT or TYPE_TEXT_VARIATION_PASSWORD`) for that field and the
suggestion strip is gone. It stays `Password` even while "show" is on: revealing the
characters to the *user* is not a reason to hand them to the keyboard.

Honest limit: `imeOptions` reports `0x2000006` (`NO_FULLSCREEN or ACTION_DONE`), so
`IME_FLAG_NO_PERSONALIZED_LEARNING` is **not** set — Compose's `KeyboardOptions` has no way to
add an arbitrary IME flag. The password variation is the platform's own mechanism for "do not
learn this" and every mainstream IME honours it, so this is belt without braces rather than a
hole. The audit found no other field that can hold a secret: the address is not one (it gets
`autoCorrectEnabled = false` for correctness, since autocorrect mangles `192.168.29.131`), and
the study sheet's two fields are a title and a number.

**Kotlin nests block comments.** `/*` inside a KDoc opens a nested comment. Writing
`` `/api/v1/*` `` in a doc comment swallows the rest of the file and produces a baffling
"Unclosed comment" hundreds of lines later. Write `/api/v1` routes instead.

**Room needs 2.7.x with KSP 2.** Room 2.6.1 fails under Kotlin 2.1.20's KSP with
`unexpected jvm signature V`.

---

## Tests

`.\gradlew test` — 192 unit tests, no device and no server. They cover the parts worth
testing:

| File | Covers |
|---|---|
| `LifeDayGuardTest` | The life-day stamp guard: matching stamps send, a rolled-over day strands, the four day-independent kinds are exempt, backoff and the 5-attempt budget |
| `LifeDayTest` | 01:00 belongs to yesterday, the reset boundary is start-inclusive/end-exclusive, half-hour zones, a DST day is 25 hours, malformed input falls back |
| `WriteQueueTest` | Enqueue ordering through the real repository, the guard in situ, `409` as success, retry with backoff then stranding, a 4xx stranding immediately, no-snapshot waiting rather than guessing |
| `GrowthGeometryTest` | Every constant and curve ported from `growth.ts`/`journey.ts`, the leaf thresholds, the quartic glow, ring bucketing, and the bloom arrival; and the meter's own box — that the halo cannot fit in a node the size of the figure, that `haloBoxSide` is exactly big enough for it, and that a narrow container shrinks the figure rather than clipping the glow |
| `OverlayAndEpochTest` | The overlay ticks rows but never patches aggregates; a ticked row keeps its index when the server re-sorts; the count/list agreement rule |
| `PaletteContrastTest` | 4.5:1 for body text and 3:1 for large text and the nav indicator across all eight palettes, the shared half really being shared, and nothing light in the tree |
| `AddressInputTest` | Address normalisation (a real bug found here: `http://` became `http://http:/`) and the Stale→Unreachable thresholds |
| `DayModelTest` | Day's bucketing by **life-day** (01:30 is still "Today"), the No-time bucket that is never dropped and is always last, past dates drawn first rather than lost, in-bucket time order, weekday labels past a week; the Needs-you/Scheduled partition being disjoint and complete; the ribbon's fractions, clamping, now-marker, legend de-duplication and the planned-day shape |
| `AnalyticsAndCelebrationTest` | The four ranges and their wire values, an axis that is never zero, **the y-domain rule** — a reachable target riding the same axis, a far-off target going off-scale rather than flattening the week onto the floor, a 130% day that is not clipped — percentage-**points** formatting; the celebration queue's rung-over-goal choice, oldest-debt-first stable ordering, one-at-a-time, and the dismissed set that stops the dialog reappearing before the refetch; goal ordering and the rarity ladder's rungs |
| `RemindersTest` | The derived notification time in all its forms (`remindAt` wins outright, `eventAt - lead` otherwise, a clamped negative lead, a malformed instant costing one notification and not the screen); the window an item leaves whether or not it was completed; the plan's alarm seeding, ordering, past-and-horizon exclusions and its needs-you agreeing with `Predicates`; the once-only filter; quiet hours wrapping past midnight, start-equal-to-end meaning *none*, and a malformed time never meaning permanent silence; channel ids carrying their sound, the id/group names being pinned against a rename, sound resolution through user → server → type, and a new sound choice adding exactly one channel and migrating none |
| `WidgetAndSoundsTest` | The tier rule at every threshold, the smallest tier having no tick at all, and width winning over height; the quantised ribbon's cell count, colours, lived/planned/done treatment, and a now-marker that stays in range at both ends of the day; `upNext` taking the server's order; and the committed WAVs — present, 16-bit mono 44.1kHz PCM with a truthful data size, and as long as their note tables say |
| `TabSwipeTest` | The swipe between the three destinations: the 2:1 rule that decides whether a drag is a page turn or a scroll, the settle (snap back under 35%, commit past it, a flick committing on a short drag, one tab per gesture, no wrap at the ends), and the `selectedness` the navigation bar's indicator reads — including that the three always sum to one, which is why two half-opacity indicators read as one pill |
| `ServerColorTest` | Every colour form the server really sends, including the `rgba()` one that was falling back to the accent and drawing *unrecorded* time as the loudest colour on the screen; out-of-range clamping; and null for anything unparseable so callers keep their fallback |

Nothing in the suite writes to `data/lifeos.db`. Milestone 3's on-device verification ran
entirely against a **seeded sandbox instance** on its own port with its own database; the
production instance was never written to and never restarted. The dev app was reinstalled
fresh and pointed at the sandbox before it was allowed to poll anything, precisely because
the notification layer's first act on a due reminder is to `POST /tasks/:id/notified`.

### Lint

`.\gradlew lint` reports **0 errors**. Four warning categories are left unfixed, on purpose:

| Warning | Count | Why not fixed |
|---|---|---|
| `GradleDependency` | 54 | The dependency set is a proven combination. Bumping any of it needs the build re-proven, which is not this milestone's job. |
| `AndroidGradlePluginVersion` | 3 | AGP 9.x requires Gradle 9, and AGP 8.x must not run on Gradle 9. Moving is a deliberate migration, not a nit. |
| `OldTargetApi` | 1 | targetSdk 35 is the proven combination; 36 is available and untested here. |
| `InsecureBaseConfiguration` | 1 | **This is the feature.** Cleartext on the base config is what makes a LAN server reachable; see above. |
| `UnusedAttribute` | 2 | `targetCellWidth`/`targetCellHeight` on the widget are API 31+. They are the modern way to say "4×2", and `minWidth`/`minHeight` are the pre-31 fallback sitting right beside them. Both are needed. (`previewLayout` is also 31+, which is why it lives in `res/xml-v31/` rather than being a third one of these.) |

`HardcodedText` is suppressed in `res/layout/widget_preview.xml` and nowhere else: every
string in that file is sample content standing in for a value the widget reads from the
cache, so pulling it into `strings.xml` would offer it for translation and for reuse
somewhere it would be a lie.

Run `lint` **online**. `--offline` cannot check for newer dependency versions, so the
`GradleDependency` count collapses to 3 and the report looks cleaner than it is.

`lint` is configured with `abortOnError = false` so it reports rather than gates.

---

## Status

### Implemented

- **§6 Theming** — all eight palettes with their normative hex, dark-only `ColorScheme`
  mapped per §6.3, no dynamic colour, the non-themed token objects, the three bundled fonts
  with mono for every figure, and the contrast test §6.4 asks for.
- **§7.1 Architecture** — Room-backed reads, Flow repository, optimistic overlay.
- **§7.2 Connection state machine** — all six states, with the Stale→Unreachable thresholds.
- **§7.4 Status strip** — one surface, amber top edge, `fetchedAt` in mono, Retry, and a `⋮`
  holding Change server and Reconnect; it participates in layout and animates once per state
  change. The stranded-write notice and the silenced line stack below it.
- **§7.5 Write queue** — `pending_writes`, the row dot, the app-bar `N↑` count, the full
  pending list with Retry all / Discard, and **the life-day guard** with stranding, the
  one-time notice, the four exemptions, `409`-as-success and 5-attempt backoff.
- **§7.6 `server`** — a real top-level route that works with no token and no connection,
  reachable from all five entry points, with Test reporting reachability / protocol / auth /
  `lan` as four separate results. Save clears the cache when the address changes.
- **§7.7 Outdated** — the full-screen `426` block, reactive on any poll.
- **§7.8 Cleartext** — verified in the release APK.
- **§4 Today** — the activity line with a locally-ticked elapsed counter, the growth meter,
  the pulse, the single merged agenda list with the epoch ordering rule, the agenda card with
  all five state treatments, the week strip, the pending dot, the tick, the Needs-you link and
  the agent cards.
- **§4.3 / 4.6 / 5.x** — the ghosted 100% contract in all three styles, per-style readout
  placement, the tick's spring punch, `medium` card-state transitions, the §5.5 pulse, zero
  nav-bar travel, and reduced motion OR'd with the OS setting throughout.
- **§8 Growth meter** — `sprout`, `orb` (full-height translated liquid, per-period crests)
  and **`bloom`**, each with a distinct arrival at 100%.
- **§2.4 Navigation shell** — `NavigationSuiteScaffold`, three destinations, window size
  classes from `currentWindowAdaptiveInfo()`, and a real settings gear.
- **§3.2 Day** — the ribbon drawn exactly as the server computed it (solid behind the
  now-marker for what was lived, tinted and 1dp-outlined ahead for the plan, `done` at 55%,
  ~0.2dp of overdraw against subpixel seams), the accent now-marker ticking on the clock
  rather than on the poll, the colour legend, the agent's **Needs you** queue pulsing as one
  block with complete/dismiss, and the day buckets — *Earlier · Today · Tomorrow · weekday ·
  No time*. Rows are 56dp list rows with a 3dp activity rule, mono time, duration, green XP,
  a repeat badge and a bell. **No Start button anywhere**, and completing a scheduled thing
  does not touch the running session. The ribbon still draws on an empty day, shaped by
  `plannedWake`/`plannedSleepStart`. The FAB is **Log study**.
- **§3.3 You** — goals read-only, nearest-done first and the first one larger, with the
  rarity ladder's rungs (reached / next / not yet) and the current rung's word; the 7-day XP
  area chart with its dashed target, collapsed by default, with the 7d/30d/90d/all control,
  consistency, adherence and study behind the expand; the five `vsYesterday` figures, green
  up and **grey** down; and achievements, quests and properties each behind a header and each
  hidden when its `*Enabled` flag is false. Lifetime XP appears once, small, in properties.
  **No create-goal button.**
- **§3.4 Celebration** — a full-screen dialog outside the `NavHost`, so it fires on any
  destination and over the navigation bar, honouring `celebrationIntensity` and reduced
  motion. It **never auto-dismisses**: no timer, no scrim tap, no system back, and
  `celebration-seen` fires on **Nice.** and on nothing else. Queued one at a time, oldest
  debt first, rung-over-goal.
- **§2.3 sheets** — all five: `agenda/{id}`, `task/{id}`, the meter's `vsYesterday` sheet,
  `session/picker` (the seven chips, a closed set) and `study/log` (title, minutes, the five
  quality flags). One filled button each; every action enqueues and closes.
- **§4.6 Undo** — the 5-second snackbar, one action, fading rather than sliding, inset above
  the navigation bar, and not offered twice for the same row in an epoch.
- **§2.4 Expanded two columns** on Today and Day at ≥840dp, from
  `currentWindowAdaptiveInfo()`. In one column the agent's cards still come **after** the
  day; at expanded width they are the second column. One `agentSection` function feeds both,
  so the two layouts cannot drift.
- **§3.5 Settings** — the index, Appearance (palette + reduced motion), **The day** (reset
  time, planned wake, planned sleep, reminder lead, read-only timezone — all through the
  write queue), Connection, the pending-write list, Widget, About, and a real
  **Notifications** page: per-type sound pickers, quiet hours and DND (server-backed, so the
  website honours them too), a link out to the OS's own channel screen for each type, an
  honest exact-alarms state, and an "Android is blocking notifications" path that is a link
  rather than a dead end.
- **§8.1–§8.4 Notifications** — five types, one channel per sound created up front, the five
  committed WAVs, `AlarmManager` seeding from the derived times, re-seeding on boot/timezone/
  update, the durable once-only claim, `/notified` posted even under DND, **Done** and
  **Snooze 10m** actions that work offline, and tap handling through both the cold-start
  intent and `onNewIntent`. `POST_NOTIFICATIONS` is requested in context — the first time the
  day actually has something scheduled in it, and on opening Settings → Notifications — never
  on first launch cold.
- **§8.5 The widget** — Glance, three content tiers picked from the real dp box, the growth
  ring with its ghosted 100%, `efficiencyPct`, `dailyXp/target`, the pulse word (replaced by a
  small hollow dot when the cache is stale), the quantised ribbon with its now-marker, the
  next one or two things with 48dp tick targets, and up to three manual activity chips. Ticks
  and chips go through the same write queue, so they work with the app closed. It never
  fetches: it reads the same Room snapshot and is refreshed by the same sync.
- **Background sync** — a 15-minute `WorkManager` periodic job that drains the queue, refetches,
  reconciles the alarms and refreshes the widget. See
  [what it actually guarantees](#what-background-delivery-actually-guarantees); it is a
  freshener, not a delivery mechanism.
- **§5.4 Swipe between the three destinations** — a horizontal drag moves Today · Day · You
  with the page under the finger, and the navigation bar's active indicator travels with it
  in real time rather than snapping when the gesture ends. Velocity-aware: a flick past
  400dp/s commits on a short drag, a slow drag under 35% of a page snaps back, and the
  settle is a fixed 200ms decelerate — no spring, no overshoot. The gesture is only claimed
  once a drag is past the touch slop *and* twice as horizontal as vertical, so vertical
  scrolling is untouched. With reduced motion it still tracks the finger and settles
  immediately. The rules are `domain/TabSwipe`, shared by the gesture and the bar.
- **A shared scaffold for every secondary screen** — `SecondaryScaffold` applies `safeDrawing`
  insets and gives each one a top app bar with a working back control, so the eleventh such
  screen cannot forget to.

### Fixed in this milestone, found on hardware

Two of them are the same bug, reported as two symptoms by the user driving milestone 3 on a
real phone.

1. **The growth meter was left-aligned, and its glow was clipped.** One cause.
   `BoxWithConstraints` aligns at `TopStart` by default, so the meter's fixed 200dp square
   sat at the left edge of a full-width card: measured on a 1080px screen, the flower's
   centre was at **27% across** instead of 50%. The same square was also the node the halo
   was drawn into — and the halo's radius is `0.78 ×` the figure, so 28% of it fell outside
   the node, and a draw modifier clips to its node. That is the hard rectangular edge that
   was visible just above the word "Improving" and again at the right.

   Fixed once rather than twice: the container centres its children, and the halo gets a
   node `2 × 0.78 = 1.56` times the figure's side so the gradient reaches zero alpha inside
   its own bounds. The figure's size is now capped by the width the halo needs as well as by
   the height; vertically the halo is allowed to bleed past the meter's box, where it lands
   on page background rather than on a screen edge. The arithmetic is `Growth.figureSide` /
   `Growth.haloBoxSide` and is unit-tested, because "is it centred" is a numeric claim.
   Measured again on the device afterwards: the halo's centroid is at **49.95%** of the
   screen, and the largest column-to-column luminance step anywhere across the glow is 1
   unit out of 255 — a gradient, not an edge. Checked at 0%, 70% and 100%, in all three
   styles, with the sprout's readout still at the right edge where §4.3 puts it.

2. **The widget had no preview image.** Flagged in milestone 3's "not built" list. The
   launcher's picker showed the app icon, which says nothing about what you are adding. The
   provider now declares `previewLayout` (API 31+, `res/xml-v31/`, the system lays out the
   real thing) and `previewImage` for older and OEM pickers — a PNG rendered from the app's
   own fonts by `scripts/build-widget-preview.py` and committed. A vector was tried first
   and rejected: a vector drawable cannot set type, so the figures drew as grey blocks and
   the whole thing read as a loading skeleton.

### Fixed in milestone 3, found on hardware

Three bugs the user found by driving milestone 2 on a real phone, and two more found by
driving milestone 3 on it.

1. **Secondary screens ignored window insets — systemic.** On `server` and on the Settings
   index the first row of content drew *behind the status bar*: "Appearance" sat under the
   clock. Today/Day/You were fine, which is why it went unnoticed — they have an app bar
   inside a `Scaffold`, which consumes the inset, while the secondary screens were composed
   straight into the `NavHost`. Fixed as a pattern: `SecondaryScaffold` for the eleven
   non-tab destinations and `BlockScaffold` for the three terminal ones. Settings also had
   **no visible back control at all** — it was navigable by gesture and by nothing else.
2. **The API token leaked to the keyboard.** See
   [Things that will bite you](#things-that-will-bite-you).
3. **Dead space in the Last 7 days chart.** The y-domain was `max(data, target)`, so against
   a 200-XP target a 25-XP morning drew flat on the floor under a dashed line on the ceiling,
   two thirds of the box empty. Now the data owns the domain and the target is a guest —
   see the rule below.
4. **The widget's ribbon drew as one solid bar.** Two Glance facts, both found by looking at
   the thing on a home screen: a container holds at most ten children (24 cells were silently
   truncated, so the ribbon is chunked into four groups of six), and a child with both
   `width=match_parent` and a weight makes `LinearLayout` distribute *negative* excess, so the
   first cell took the whole row.
5. **`rgba()` colours fell back to the accent.** The server sends its "Unlogged" timeline
   block as `rgba(255,255,255,0.05)`, and the app's only colour parser was hex-only. Every
   caller fell back to `palette.accent`, so the part of the day that had **not** been recorded
   drew in the brightest colour in the theme — on the new widget *and* on Day's ribbon, where
   it had been wrong since that screen shipped. There is now one parser, `ui/theme/serverColor`,
   which handles every form the server sends, and a test for it.

### Stubbed or not built

- **§7.3 QR pairing** — still a stub route that falls through to manual entry, which is a
  complete path.
- **The widget is not verified at 2×2.** The tier rule is unit-tested at every threshold and
  the 4×2 and 4×3 boxes were checked on the device; `COMPACT` has only been exercised by
  tests.
- **Snooze diverges from other clients by design** (open question #5): it is a purely local
  re-alarm, `notifiedAt` is already set, and the web client will not chime again.
- **No `svg` rendering**, no properties history curves, no task undo, and `constellation` /
  `ascent` growth styles — all unchanged from milestone 2.
- **Agent `svg`** is still not rendered, on Today or in any sheet. It is untrusted and needs
  a sandbox; the agenda sheet says so where artwork exists rather than drawing it.
- **No `properties` history curves.** The analytics payload carries a `series` per property;
  You shows each property's current value and not its curve. A sparkline per counter is a
  second chart vocabulary for a block that is collapsed by default.
- **Task undo.** There is no `POST /tasks/:id/undo`, so Undo is offered for habits only —
  in the snackbar and in the agenda sheet. A button that cannot work is worse than no button.
- `constellation` and `ascent` growth styles are postponed per the brief; a server sending
  either falls back to `bloom` rather than drawing nothing.

### Spec decisions changed, and why

1. **Protocol 3, not 2.** UI_SPEC §7.7 and `docs/API.md` say 2; `protocol.ts` and the running
   server say 3. Shipping 2 would have earned a `426` on the first request.
2. **`bloom` ships in v1**, overruling UI_SPEC open question #1, per the brief. `sprout` and
   `orb` ship too; `constellation` and `ascent` are postponed.
3. **The snapshot is stored as JSON text, not as normalised entities.** §7.1 says "parsed
   entities". The dashboard is a single atomic read and the only query anything makes is "give
   me the whole snapshot", so twenty tables would have to be written in one transaction and
   re-joined on every emission to reconstruct exactly what arrived. Room is still the only
   thing the UI reads, the read is still a Flow, and `lifeDayDate` is denormalised into a
   column because the guard needs it without parsing. Stated here because it is a real
   divergence, not an oversight.
4. **User-installed certificates are not trusted** in the network security config, which
   UI_SPEC does not discuss. Nothing in the product needs a self-signed HTTPS server, so
   trusting the user store would widen the attack surface for no feature.
5. **The five sheets are view-model state, not `NavHost` destinations.** §2.3 lists them as
   routes. `navigation-compose` has no bottom-sheet destination type, and a
   `ModalBottomSheet` is an overlay over the screen underneath rather than a place you go:
   the screen behind it keeps its scroll and keeps polling. They are `AppSheet` on the view
   model, hosted once for all three destinations, and dismissed by the sheet's own back
   handling — which includes predictive back. The route names stay documented in `Routes.kt`
   for the notification-tap path a later milestone needs.
6. **Needs you wins over the No-time bucket.** §3.2 says Needs you holds untimed agent work
   *and* that the Scheduled list buckets every visible task with "No time" for the untimed
   ones. Taken literally an untimed task appears under two headings on one screen, and
   Today's count then disagrees with one of them. The partition gives Needs you priority;
   the No-time bucket is still defined, still tested and still last, so a future change to
   the Needs-you predicate cannot silently drop a row — it will reappear there instead.
7. **The day's times are chips, not a time picker.** §3.5 lists `dayResetTime`,
   `plannedWake` and `plannedSleepStart/End` without saying how they are edited. The server
   stores `HH:mm` strings and every one of these is a half-hour decision about the shape of a
   day; a wheel picker returning 07:13 would store a precision nobody meant. A value the
   server holds that is not on our list is still shown, and shown as selected.
8. **Settings is a second request** (see Architecture). §7.1 implies one read.
9. **Database version 3.** Hand-written `MIGRATION_1_2` (`server_settings`) and
   `MIGRATION_2_3` (`fired_notifications`). There is still no
   `fallbackToDestructiveMigration`: `pending_writes` holds writes the user believes they
   made, and dropping them to save writing six lines of SQL is not a trade.
10. **The chart's y-domain is sized to the data, not to the target.** UI_SPEC says the target
    rides the same axis as the actual, and against a reachable target it still does. But taken
    literally it produced the dead-space bug above, so the rule is now
    `axisMax = max(dataMax, min(target, 2 × dataMax)) × 1.15`: the target may raise the domain
    only as far as twice the data, past which it is **off-scale** — the dashed line is pinned
    just inside the ceiling, drawn dimmer and longer-dashed so it reads as a boundary rather
    than a value, and the caption underneath prints the figure and says it is above the chart.
    The target is never silently dropped and never silently rescaled, and a day that exceeds
    its target is inside the limit by construction, so a 130% day is still not clipped.
    Percentage series (consistency) keep a fixed 0–100 domain, because a quiet week must look
    like a quiet week.
11. **Per-type notification sounds are device-local; quiet hours and DND are not.** The server
    has one `notificationSound`, which this app reads as the *default* for Reminder and
    Due-now so the phone agrees with the dashboard out of the box. A per-type choice is bound
    to an Android channel and therefore to this install, so writing it back would describe one
    phone's channels to every client and the web client has no channels at all. Same reasoning
    as the palette (§9.1). Quiet hours and DND go the other way — they are statements about
    *you*, the website honours them, so they stay server settings and are patched through the
    write queue like everything else.
12. **The widget's chips get a higher threshold than the ribbon.** §8.5 gives one ("below
    ~150dp tall, drop the ribbon and the chips"). Measured on the device, a 4×2 box is
    366 × 203dp and everything above the chips comes to about 180dp of it, so at 4×2 the
    chips had nowhere to go and were being dropped by the `Column` overflowing — the right
    outcome reached by accident. They are now a separate `TALL` tier at 230dp, so it is a
    decision with a test rather than a clip.
13. **The navigation bar's indicator tracks a gesture, and the three destinations are one
    route.** §5.4 said "zero pixels of travel", full stop. That rule was aimed at the old
    app's pill, which animated *itself* after a tap — chrome moving on its own, carrying no
    information. A gesture-driven indicator is a different thing: the user's own finger is
    moving it. §5.4 is amended to say so precisely — no self-animating travel on navigation,
    continuous tracking during a gesture required — and a tap is still zero pixels.
    Mechanically this costs two things. The compact bar is ours rather than a stock
    `NavigationBarItem`, whose indicator cannot be told where to be (the rail keeps the
    stock items; there is no sideways travel to track against a vertical rail). And Today,
    Day and You stopped being three `NavHost` destinations: a swipe shows two of them at
    once and a navigation graph can only be at one destination, so they are pages of one
    route and `navigate(Routes.DAY)` became picking a tab. The `popUpTo(TODAY) { saveState }`
    dance that kept Today → Day → Today from stacking three entries went with them, replaced
    by a `BackHandler` that returns to Today.
14. **The widget's ribbon is quantised into 24 equal cells.** Glance has `defaultWeight()` but
    no *fractional* weight, so a segment that is 7% of the day cannot be given 7% of the row,
    and §8.5 forbids a computed pixel width outright. So `Ribbon.cells` maps the same
    fractional segments Day draws onto equal cells — hourly resolution, which is honest for
    something the size of a launcher cell, and the two ribbons cannot disagree about the shape
    of the day because they read the same function.
