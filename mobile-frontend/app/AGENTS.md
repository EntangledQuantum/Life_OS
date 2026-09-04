# Life OS mobile app — agent notes

**Scope:** only `mobile-frontend/app/`. Do not edit `apps/*`, `packages/*`, or
root workspace files. Isolation rules: `../README.md`. Product contracts:
`../CLIENT_GUIDE.md` (read end-to-end before behavioural changes).

## Stack

- Expo SDK 57 · Expo Router · React Native
- Entry: `index.js` (registers Android widget only on `Platform.OS === "android"`)
- Routes: `app/` · UI: `components/` · API/auth: `lib/` · Widget: `widgets/`

## Auth (token only)

- No username/password. `POST /api/v1/auth/login` is **410 Gone**.
- Connect screen: server URL + `API_TOKEN` from Life OS `.env`.
- Validate with `GET /api/v1/auth/me` before entering the app.
- Token in **SecureStore** on native (never log it). On 401 → clear token → connect.
- Implementation: `lib/api.ts`, `lib/connection.tsx`, `lib/storage.ts`, `app/connect.tsx`.

## Cleartext HTTP (do not remove)

Life OS is reached over plain `http://` on a LAN. Android 9+ defaults
`usesCleartextTraffic` to **false**, so a release build silently fails every
request at the socket layer while Expo dev builds work fine — the debug variant
enables cleartext for you. That gap is invisible until someone installs an APK.

`app.json` therefore carries:

```json
["expo-build-properties", { "android": { "usesCleartextTraffic": true } }]
```

Keep exactly one `expo-build-properties` entry — `npx expo install` appends a
bare `"expo-build-properties"` string of its own, which is redundant next to the
configured array form. Verify the resolved config with
`npx expo config --type prebuild` (read-only; does not write `android/`).

Symptom if it goes missing: the connect screen says "Life OS isn't running —
can't reach the server" while the same URL loads fine in the phone's browser.
`adb logcat | findstr /i cleartext` prints the real error.

## Contracts you must not break

See CLIENT_GUIDE §4. Highlights: life-day ≠ calendar day; celebrations only after
user dismiss; reminders POST `/notified` even under DND; no levels/leaderboards;
no goal-creation UI; never colour a bad day red.

## The day graphic (likely touch points)

| File | Role |
|------|------|
| `components/day-graphic.tsx` | The entry point every surface uses. `bloom` drawn here; the other four delegate |
| `components/constellation.tsx` · `components/ascent.tsx` | The two scenes. Mirrors of the web files of the same name |
| `components/growth-meter.tsx` | `sprout` and `orb`; **must** keep drawing the ghosted 100% state behind the live one |
| `components/agenda-row.tsx` | One **card** of today, habit or task — the only place a habit is drawn. Art, 46pt icon, week strip, coloured outline |
| Geometry | Duplicated from `packages/shared/src/{growth,journey}.ts` **on purpose** — this app must not import from the workspace. `lib/journey.ts` is a straight copy and has to stay one; the bloom constants at the top of `day-graphic.tsx` are the other half |
| Leaf thresholds | `0.16 0.32 0.46 0.62 0.78 0.90` then bloom at 1.0 (match web) |
| Web reference | `apps/web/src/components/graphics/DayGraphic.tsx` (read only — copy patterns, don't import) |
| Settings | `reducedMotion`, `celebrationIntensity`, `progress.growthStyle` |
| Style picker | Settings only, never Today. A **measured** grid — `flex: 1` inside `flexWrap` never wraps, so all five squeezed onto one line with each preview drawn over its neighbours. Tiles are sized from the container: two per row on a phone, three from 420pt up |
| `components/celebration-modal.tsx` | Full-screen goal complete — never auto-dismiss |

Prefer `react-native-reanimated` + `react-native-svg` already in the project.
Honour `reducedMotion` from settings **and** the OS (`useTheme().osReducedMotion`).

**No SVG filters.** `react-native-svg`'s filter support varies by version and a
missing one does not degrade — it renders a black rectangle. `constellation`
and `ascent` are filter-free on both platforms for exactly this reason, so the
two are genuine mirrors; bloom's web copy uses `feGaussianBlur` and here the
same brightening is a `RadialGradient` halo. Keep it that way.

**Every style has an arrival.** `journeyFeel` gives all five a `complete` state
so 100% does not look like a brighter 99%: bloom settles two rings, the
constellation closes its figure, the ascent lights the summit and says
"summit". If you add a style, give it one.

Two things in the orb are load-bearing and easy to undo by accident:

- The liquid is a **full-height view slid down on `translateY`**, not a view whose
  `height` animates. Height is a layout prop and re-lays-out every frame; the
  transform stays on the UI thread, and the crests ride the surface for free
  because they are children of it.
- Each crest scrolls by **exactly its own period** (`periodA = inner/2`,
  `periodB = inner/3`). Any other distance and the tiled sine visibly jumps once
  per loop. Do not give both waves the same drift distance.

The percentage is placed **per style**, and the two cases are not variations of
each other. The orb has an empty middle and the number is its contents, so it is
centred and large. The sprout has no empty middle — a centred number lands on
the pot and the roots — so it goes to the right edge, vertically centred, where
the viewBox is empty at every growth level (stem at x≈100/200, widest leaf tip
x≈130/200). Do not re-merge them into one `Readout`.

## Today is one list

`data.agenda` arrives already merged and already ordered: habits with a time and
tasks with a time in time order, then everything untimed. **Do not re-split it.**

It has been split twice and both times it read as duplication. Habits and tasks
as separate sections is what made it reasonable for an agent to create one of
each for the same act; "Today" and "Anytime" as separate sections put a habit
with no time underneath a task with a similar name, which looks like the same
row twice. One section, no regrouping, and a row does not move when it is ticked.

**A row is a card, and it is the only place a habit is shown.** There is no
habits screen on either client any more — the dashboard had one, showing the
same habits larger with their art and their week, which meant the screen you
actually look at every day was the poorer of the two views. `agenda-row.tsx` is
what that page was: the picture, the 46pt icon, the seven-day strip, the anchor.

Two things it needs that an `AgendaItem` does not carry:

- **The habit itself**, passed in by the screen and looked up by `habitId`. The
  art and `history7` live on `data.habits`, which the same payload already
  carries — copying a `data:` URI onto every agenda item would send the same
  picture twice, every eight seconds.
- **No colour bar.** The 3px bar that used to mark a habit is gone; the card's
  border and glow carry the activity colour instead. At three pixels it read as
  a divider.

**The list comes before the agent's cards on a phone.** `TwoPane` emits `left`
then `right` when there is only one column, so anything parked in the left
column lands *above* the day. The cards are built once as `agentCards` and
placed by `twoPane`: beside the day on a tablet, after it on a phone. Your own
habits are what the screen is for; the agent's reading of them is commentary.

The "Right Now" strip is deliberately smaller than a habit row, and its button
is smaller than a habit's tick. It is the one thing on Today that is not a
thing to do.

## Screen sizes

`lib/responsive.ts` → `useLayout()`. Everything reads from
`useWindowDimensions()`, never from `Device.deviceType`: on an iPad the app is
routinely *not* the size of the screen — Split View and Slide Over hand it a
third or a half, and resize it while it runs.

| class | width | what it is | layout |
|---|---|---|---|
| `compact` | `< 600` | phones, iPad Slide Over | bottom bar, one column |
| `medium` | `600–899` | iPad portrait, 1/2 split, phone landscape | **left rail**, one column |
| `expanded` | `>= 900` | iPad landscape | left rail, **two columns** |

- `components/tab-bar.tsx` is one component with two shapes. `_layout.tsx` sets
  `tabBarPosition: wide ? "left" : "bottom"` to match — that is what makes the
  navigator's own container a row and renders the bar first. The rail's pill
  travels the *content* box, so `span` subtracts the vertical padding.
- `PageBody` (in `ui.tsx`) caps line length and centres; `TwoPane` splits into
  columns only when `expanded` and otherwise emits both halves straight into the
  parent so they inherit its `gap`.
- `GrowthHero` measures itself with `onLayout` rather than reading the window —
  in two-pane it lives in one column and the window width says nothing useful.
  Its hero box is **capped at `meter + 260`**: the four stats are pinned to that
  box's left and right edges, and without the cap they fly to the far edges of a
  tablet window.

## Orientation

Top-level `"orientation": "portrait"` stays — it is what keeps
`android:screenOrientation="portrait"` in the manifest, so the phone does not
start rotating. iPad is unlocked with a device-variant Info.plist key instead:

```json
"UISupportedInterfaceOrientations~ipad": [ ...all four... ]
```

Expo's iOS orientation plugin only ever writes the un-suffixed
`UISupportedInterfaceOrientations` (`@expo/config-plugins/build/ios/Orientation.js`),
so the `~ipad` key passes through untouched and iPadOS prefers it. Do not
"simplify" this to `"orientation": "default"` — that unlocks the phone too.

## Swiping and tabs

`components/swipe-tabs.tsx` wraps every tab screen; `index` must match the
screen's position in `TAB_ROUTES` and in `app/(tabs)/_layout.tsx`. It uses
`PanResponder`, not a pager, and only claims the gesture once it is twice as
horizontal as it is vertical — that is what leaves vertical scrolling intact.
`components/tab-bar.tsx` is the custom bar; it types the navigator props
structurally rather than importing `@react-navigation/bottom-tabs`, which this
app does not declare as a dependency.

Its pill is **critically damped** — `mass 0.55, damping 30, stiffness 420`, where
`damping ≈ 2·√(stiffness·mass)`. Below that boundary the pill overshoots the tab
you picked and swings back through it, which across five tabs is a long slide
with a wobble on the end. Retune the three together or not at all.

## Widget

- `widgets/status-widget.tsx` + `task-handler.tsx` + `update.tsx`
- Uses `react-native-android-widget` primitives only (no RN `View`/`Text`)
- Manual activity chips exclude Sleep/Break (schedule/agent can set those)
- Needs a native Android build to test — not Expo Go

**Never use a fixed dp width for something meant to span the widget.** The
launcher hands out a different box per device, per cell count, and again after
every resize, so a hardcoded width leaves a gap on a wide widget and overflows a
narrow one. Spanning elements use `match_parent` or `flex` weights — the
progress bar is two flex children (`flex: fill` / `flex: 100 - fill`), not a
computed pixel width.

Both render paths receive the real dp box and **must forward it**:
`widgetTaskHandler` via `props.widgetInfo`, and `requestWidgetUpdate` via the
`renderWidget(info)` argument. Dropping either makes the widget lay itself out
for a size it is not. `StatusWidget` uses those numbers to pick its tier —
below ~150dp tall it drops the ribbon and chips rather than clipping them.

## Dashboard

- Single poll: `GET /api/v1/dashboard/today` (~8s on Today screen)
- Render `data.agenda`, not `data.habits` + `data.tasks` — see "Today is one list"
- After writes, invalidate/refetch — don't hand-patch state
- `source: "user"` on human actions; habit complete `409` = success no-op

**Today always shows habits. This client deliberately diverges from
CLIENT_GUIDE §3.7**, which has the web client hide habits while any agent item
is open. That works when agent items are occasional; against an agent keeping a
standing queue it means the habit list never renders at all — which is what
happened here, with six habits invisible behind eight pending events. Agent
events and light reviews live under "Needs you" on **Timeline**; Today only
shows a count that links across. Do not move them back. (The web client now
does the same thing, for the same reason.)

## A request must be able to fail

Three rules, and the app was stuck on a spinner forever without any one of them.

**Every fetch carries a deadline.** React Native configures OkHttp with all
three timeouts at zero, so a request to an address that drops packets — laptop
asleep, stale LAN IP, VPN in the way — neither resolves nor rejects. `lib/api.ts`
wraps every call in `fetchWithTimeout` (12s, 8s for probes, 6s in the widget's
headless task) and turns an abort into an `ApiError` that names the address.
Use it for any new call; a bare `fetch` is the bug coming back.

**`networkMode: "always"`** in the QueryClient (`app/_layout.tsx`). React
Query's default *pauses* a query when its `onlineManager` believes the device is
offline — `status: "pending"`, `fetchStatus: "paused"`, `error: null`, forever,
with nothing on screen but a spinner. That manager is a browser feature, is not
wired to NetInfo here, and would be answering the wrong question anyway: Life OS
is on the LAN, so a phone with no internet can reach it and a phone with perfect
internet cannot if the machine is asleep. Always attempt; let failure be an
error. (Retries also pause while the app is unfocused — that one is correct.)

**A screen with no data always offers a way out.** `Loading` in `ui.tsx` is a
spinner for six seconds and then a panel: what it is waiting for, the real error
message when there is one, Try again, and Change server. Every screen's gate is
`if (!data) return <Loading error={q.error} onRetry={...} />` — never
`isLoading && !data`, which leaves a hole for the query that has failed with
nothing cached, and drops straight through to a spinner that never resolves.

## Scheduled things never start

There are two separate ideas and they must not be re-tangled:

- **What you are doing**, at timeline resolution — Deep Work, Study, Sleep. Set
  by hand from `components/activity-session.tsx`, and the *only* thing that
  paints the ribbon behind the now-marker.
- **Things the agent scheduled** — cards and study blocks. They have a target
  time and a done flag. No Start button, no timer, no running state, and
  completing one does **not** touch the running activity.

`api.startCard` / `api.startBlock` are gone, and so are the endpoints behind
them. `CardRow` takes `onComplete` only. If a design asks for "start this", the
answer is a card with an `eventAt`.

Notification times are derived: `remindAt ?? eventAt - reminderLeadMinutes`
(a server setting, default 15). The same window decides what reaches Quick log,
and an item leaves it at `eventAt + durationMinutes` whether or not it was
completed.

`components/day-timeline.tsx` draws `TimelineBlock.actual` — solid behind the
marker for what was really done, tinted-and-outlined ahead for the plan — and
carries the colour legend the phone was missing.

## Notifications

Four rules, each of which was a bug first.

**One channel per sound.** An Android channel's sound is fixed when the channel
is created and cannot be changed afterwards — the OS owns it from that point on,
deliberately, so an app cannot take a user's settings back. Sharing three
channels across five sounds meant the picker in Settings did nothing. Channels
are `lifeos-<soundId>` plus `lifeos-silent`, all created up front.

**`channelId` goes on the trigger, not the content.** `NotificationContentInput`
has no such field, so it was being passed and silently dropped, and everything
landed on the default channel. For an immediate notification the whole trigger
is `{ channelId }` (`ChannelAwareTriggerInput`); for a scheduled one it sits
alongside `type` and `date`.

**The WAVs are generated, not hand-made.** `scripts/build-sounds.mjs` renders the
same note tables the web client synthesizes in WebAudio, so "chime" is the same
two rising notes on both. Change a design in `apps/web/src/lib/notify.ts`, re-run
the script, commit the output — a build must not depend on having run it, and
`expo prebuild` needs the files to exist. They are registered through the
`expo-notifications` plugin's `sounds` array in **app.json**; reference them by
base filename only.

**`ReminderRunner` lives in `app/(tabs)/_layout.tsx`, not on a screen.** It used
to be mounted by Today, so if the app reopened on Timeline — which is where a
tapped notification lands you — nothing was ever pre-registered with the OS, and
the only notifications that fired were the ones raised while Today happened to
be open. Do not move it back onto a screen.

Notification times are derived, never read straight from `remindAt`: see
`lib/schedule.ts`. Taps are handled through `onNotificationTapped`, which reads
`getLastNotificationResponse()` as well as subscribing — the listener alone
misses the cold start, which is the common case, since the notification is why
the app is opening.

## Design tokens

Dark only — there is no light theme.

Colour comes from `lib/theme.ts` (`PALETTES`) through `useTokens()` /
`useTheme()` in `lib/theme-provider.tsx`. **Never import `colors` in a new
component** — it is only a static fallback pinned to the default palette, so
anything using it stops responding when the user switches theme.

The palette is **device-local** (AsyncStorage), deliberately richer than the
API's four `accentTheme` hues, and defaults to `bloom` (pink). The server
setting still exists and still drives the web client; Settings exposes it
separately as "Web app accent". Do not write one from the other.

`ACTIVITY_COLORS` gives each of the seven day buckets its own hue so timelines
and cards read without a legend.

Type: **Outfit** for headings and anything with voice, **Figtree** for body,
**JetBrains Mono** for every number, time and ID (tabular, always). Use the
`font` object rather than string literals.

## Do not

- Add telemetry / crash SDKs that leave the device
- Import from monorepo `packages/*` or `apps/*`
- Add goal creation, levels, or leaderboards
- Log the API token
