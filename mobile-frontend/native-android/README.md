# Life OS for Android

A native Android client for Life OS: Kotlin, Jetpack Compose, Material 3, dark only.
This replaces the Expo/React-Native app in `mobile-frontend/app/`, which stays in the
repository and keeps working as a fallback. Nothing here touches it.

Product and interaction decisions live in [`docs/UI_SPEC.md`](docs/UI_SPEC.md). That file is
the source of truth; this one is how to build and how the code is arranged.

**Milestone 1** — foundation plus the Today screen, end to end. What is and is not built is
listed under [Status](#status).

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
with no other setup.

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
   │                   ▲                       ▲
   │ tap               │                       │ SyncWorker (WorkManager)
   └─► pending_writes ─┘                       └─ life-day guard
```

| Package | Holds |
|---|---|
| `domain` | Pure Kotlin, no Android: the life-day, the guard, the overlay, the agenda epoch, the growth geometry, and **every filtering/counting predicate** |
| `data` | Room, Retrofit/OkHttp, the token store, preferences, the repository, the sync worker |
| `ui` | Compose. `theme` holds the palettes and the non-themed token objects |

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

**The token is never logged.** It lives in Keystore-backed `EncryptedSharedPreferences`, is
mirrored in memory only so the OkHttp interceptor does not hit the Keystore per request, and
there is deliberately **no logging interceptor at any build type** — one would print the
`Authorization` header. Backup and device-transfer are excluded in
`res/xml/data_extraction_rules.xml` so it cannot leave the device that way either.

**Kotlin nests block comments.** `/*` inside a KDoc opens a nested comment. Writing
`` `/api/v1/*` `` in a doc comment swallows the rest of the file and produces a baffling
"Unclosed comment" hundreds of lines later. Write `/api/v1` routes instead.

**Room needs 2.7.x with KSP 2.** Room 2.6.1 fails under Kotlin 2.1.20's KSP with
`unexpected jvm signature V`.

---

## Tests

`.\gradlew test` — 77 unit tests, no device and no server. They cover the parts worth testing:

| File | Covers |
|---|---|
| `LifeDayGuardTest` | The life-day stamp guard: matching stamps send, a rolled-over day strands, the four day-independent kinds are exempt, backoff and the 5-attempt budget |
| `LifeDayTest` | 01:00 belongs to yesterday, the reset boundary is start-inclusive/end-exclusive, half-hour zones, a DST day is 25 hours, malformed input falls back |
| `WriteQueueTest` | Enqueue ordering through the real repository, the guard in situ, `409` as success, retry with backoff then stranding, a 4xx stranding immediately, no-snapshot waiting rather than guessing |
| `GrowthGeometryTest` | Every constant and curve ported from `growth.ts`/`journey.ts`, the leaf thresholds, the quartic glow, ring bucketing, and the bloom arrival |
| `OverlayAndEpochTest` | The overlay ticks rows but never patches aggregates; a ticked row keeps its index when the server re-sorts; the count/list agreement rule |
| `PaletteContrastTest` | 4.5:1 for body text and 3:1 for large text and the nav indicator across all eight palettes, the shared half really being shared, and nothing light in the tree |
| `AddressInputTest` | Address normalisation (a real bug found here: `http://` became `http://http:/`) and the Stale→Unreachable thresholds |

Nothing in the suite writes to `data/lifeos.db`. The only contact with a live instance during
development was a read-only `GET /health`.

### Lint

`.\gradlew lint` reports **0 errors**. Four warning categories are left unfixed, on purpose:

| Warning | Count | Why not fixed |
|---|---|---|
| `GradleDependency` | 48 | The dependency set is a proven combination. Bumping any of it needs the build re-proven, which is not this milestone's job. |
| `AndroidGradlePluginVersion` | 3 | AGP 9.x requires Gradle 9, and AGP 8.x must not run on Gradle 9. Moving is a deliberate migration, not a nit. |
| `OldTargetApi` | 1 | targetSdk 35 is the proven combination; 36 is available and untested here. |
| `InsecureBaseConfiguration` | 1 | **This is the feature.** Cleartext on the base config is what makes a LAN server reachable; see above. |

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
- **§3.5 Settings** — the index, Appearance (palette + reduced motion), Connection, the
  pending-write list and About.

### Stubbed or not built

- **§3.2 Day** and **§3.3 You** are placeholder screens. The shell, the navigation and the
  motion are real; the ribbon, Needs-you, the day buckets, goals and analytics are not. Each
  placeholder shows one live figure from the snapshot so the data path is visibly wired.
- **§7.3 QR pairing** is a stub route that says so and falls through to manual entry.
  CameraX + on-device ML Kit are a later milestone. Manual entry is a complete path.
- **§2.3 sheets** — the agenda detail sheet, the meter's `vsYesterday` sheet, the session
  picker and `study/log` are not built; their entry points are wired but inert.
- **§3.4 Celebration**, **§8.1–8.4 notifications**, **§8.5 the widget**, and background
  polling beyond foreground sync are out of scope this milestone, as briefed.
- **Undo** exists in the repository and the view model but has no snackbar yet (§4.6).
- **Agent `svg`** is not rendered. It is untrusted and must be sandboxed; drawing it
  unsandboxed to look finished would be the wrong trade.
- **Expanded-width two columns** (§2.4) is not implemented — the shell switches bar↔rail by
  size class, but Today stays one column at ≥840dp.
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
