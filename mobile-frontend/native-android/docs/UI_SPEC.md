# Life OS for Android — UI/UX specification

**Status:** design spec for a ground-up rewrite in Kotlin + Jetpack Compose (Material 3).
**Audience:** the agent or developer implementing the app. This document decides product
and interaction; it does not contain app code.

**Read first, in this order:** `../../CLIENT_GUIDE.md` (the behavioural brief and payload
shapes), `../../../docs/API.md` (endpoints, pairing, protocol version),
`../../app/AGENTS.md` (what the Expo app learned the hard way).
Where this spec and `CLIENT_GUIDE.md` disagree on *behaviour*, CLIENT_GUIDE wins and this
file is wrong — except where a divergence is called out explicitly and justified
(there are three; they are flagged **[divergence]**).

The rewrite exists for four reasons, and every decision below traces back to one of them:

1. **The current app is bulky.** Too much on every screen, flat hierarchy, five tabs.
2. **It looks like the website in a shell.** It must read as an Android app.
3. **It is not instant.** Every tap round-trips before anything moves on screen.
4. **Connect/offline is broken.** "Change server" does nothing; offline is an error panel.

---

## 0. Inherited contracts — kept vs. dead

The existing app's `AGENTS.md` mixes two kinds of rule. Sorting them is a prerequisite for
the rewrite, so it is first.

### 0.1 Product contracts — keep, they are the product

| Contract | Why it survives the rewrite |
|---|---|
| **The life-day is not the calendar day** (`dayResetTime`, default 04:00) | A 01:00 study session belongs to yesterday. Port `getDayBounds()` semantics; never use `LocalDate.now()` for "today". Affects the write queue (§7.5) and the widget. |
| **Today is one pre-merged list** (`data.agenda`) | Split twice, read as duplication twice. Do not re-split into habits/tasks or Today/Anytime. |
| **A row is a card, and the only place a habit is drawn** | No habits screen, no habits tab. The agenda row carries the art, the 7-day strip, the anchor. |
| **A row does not move when it is ticked** | §4.6. This is the single most important interaction rule on the main screen. |
| **No levels, ranks, badges-as-status, leaderboards, other people** | The only comparison is you vs. yesterday. |
| **Never colour a bad day red** | Negative deltas are grey (`#94A3B8`), never red. Red is reserved for destructive confirmation only. |
| **No goal-creation UI** | Goals come from the agent. Read-only everywhere. |
| **Celebrations only on real user dismissal** | `celebration-seen` fires on dismiss, never on render, never on a timer. Queue multiples, play one at a time. |
| **The growth meter always draws the ghosted 100% state behind the live state** | A 40% bar does not communicate the gap. Leaf thresholds `0.16 0.32 0.46 0.62 0.78 0.90`, bloom at `1.0`. |
| **Scheduled things never start** | Tasks have a target time and a done flag. No Start button, no timer, no running state on a task. The only running thing is the manually-set activity session. |
| **`efficiencyPct` can exceed 100** | Clamp the fill, never the number. |
| **DND/quiet hours silence the interruption, not the information** | Still render, still pulse, **still POST `/notified`**. Silence must be visible or it reads as a bug. |
| **`source: "user"` on every human action** | It is how the agent tells its own writes from the person's. |
| **Habit complete `409` = success, no-op** | No toast, no retry. |
| **`notified` POST is the de-dupe** | Plus an in-process fired-id set. |
| **Agent `svg` is untrusted** | Render sandboxed, never as markup; no remote loading. |
| **No telemetry, analytics or crash reporting that leaves the device** | No Firebase, no Crashlytics, no Sentry. Local-only logging, token never logged. |
| **Dark only** | There is no light theme and never will be. |
| **One Android channel per sound** | The OS owns a channel's sound after creation. See §8 — the rewrite extends this, it does not relax it. |
| **The reminder runner is not mounted by a screen** | It is process-level (a `Service`/`WorkManager` + app-scoped coordinator), because a notification tap can land you anywhere. |
| **Never a fixed dp width for something meant to span the widget** | Launchers hand out a different box per device and per resize. |
| **Monorepo isolation** | `mobile-frontend/native-android/` must not depend on `packages/*`. Geometry constants are copied on purpose and must stay copies. |

### 0.2 Expo/React-Native workarounds — dead with the rewrite

| Workaround | Why it dies |
|---|---|
| `usesCleartextTraffic` via `expo-build-properties` | Replaced by a real `network_security_config.xml` (§7.8). The *requirement* lives on — plain `http://` on a LAN must work in release builds — only the mechanism changes. |
| `fetchWithTimeout` wrapping every call because RN sets OkHttp timeouts to zero | We configure OkHttp directly: connect 5s, read 12s, call 15s; 6s for probes. Nothing is unbounded, but this is now config, not a wrapper. |
| `networkMode: "always"` on React Query | No React Query. A Room-backed repository has no concept of "paused because the browser thinks we're offline". Always attempt; let failure be a typed error. |
| `SwipeTabs` / `PanResponder` horizontal tab swiping | **Cut.** Three destinations, M3 navigation bar, predictive back. Swipe-between-tabs fights vertical lists and horizontally-scrollable content, and is a React-Navigation-era habit. |
| The travelling, critically-damped nav-bar pill (`mass .55, damping 30, stiffness 420`) | **Cut** — this is the "too much animation at the bottom" the brief names. Replaced in §5.4. |
| `tab-bar.tsx` as one component with two shapes; `tabBarPosition: "left"` | Replaced by `NavigationSuiteScaffold` (navigation bar / rail by window size class). |
| "No SVG filters, `react-native-svg` renders a black rectangle" | Compose `Canvas` + `RenderEffect.blur` (API 31+) are reliable. Blur is allowed again, with an API-level fallback to the existing `RadialGradient` halo. |
| `GrowthHero` measuring itself with `onLayout` instead of the window | `BoxWithConstraints` solves this natively; the *rule* (size from your container, not the window) stays. |
| iPad orientation `~ipad` Info.plist trick; `useWindowDimensions` over `Device.deviceType` | iOS is out of scope. The rule survives as "use `WindowSizeClass`, never `isTablet`" — Android free-form/split-screen resizes the app while it runs. |
| `lib/journey.ts` as a straight copy of workspace geometry | Still a copy (isolation holds), now Kotlin. |
| Device-local palette in `AsyncStorage` separate from the server's `accentTheme`, exposed as "Web app accent" | The device-local palette **stays** (§6). The "Web app accent" control is **deleted** (§9). |

### 0.3 Deliberate divergences from CLIENT_GUIDE

- **[divergence 1] Today always shows habits.** CLIENT_GUIDE §3.7 hides habits while any
  agent item is open. Against an agent keeping a standing queue, that means the habit list
  never renders. Agent work lives on **Day → Needs you**; Today shows a count that links
  across. (The existing app and the web client both already do this.)
- **[divergence 2] Writes are queued offline.** CLIENT_GUIDE §6 says "do not queue writes
  for later replay unless you also handle the life-day boundary". We queue, and we handle
  the boundary explicitly — §7.5 is that handling, and it is a hard requirement, not an
  optimisation.
- **[divergence 3] `upcoming`/`scheduled` is now `current`/`tasks`.** Protocol 2 collapsed
  four lists into `tasks`; CLIENT_GUIDE §3.8's field names are protocol-1. The *split* it
  describes is still law: Today answers "what am I doing now" (`current`), Day holds
  everything the agent has queued (`tasks`).

---

## 1. Design principles

Eight rules. Each one is phrased so a reviewer can **reject a screen** with it.

1. **One thing to look at.** Every screen has exactly one element the eye lands on first,
   and it is at least 2× the visual weight of anything else on screen. If you cannot point
   at it in a screenshot, the screen is rejected.
   *Today: the growth meter. Day: the now-marker on the ribbon. You: the goal nearest done.*

2. **Information below the fold is not information lost.** The first viewport of every
   screen holds at most **five** distinct information units (a unit = a number with a
   label, a card, a row, a chip group). The sixth goes further down or behind a tap.
   The current Today screen has eleven above the fold. That is the bug.

3. **Numbers earn their place by changing a decision.** `totalXp` (lifetime) changes no
   decision and is not shown anywhere. `improvementPct`, `yesterdayEfficiencyPct`,
   `longestStreak`, and the five `vsYesterday` figures are **one tap deep**, not on Today.
   If you cannot name the decision a number informs, delete it.

4. **Chrome is still, content moves.** Navigation, app bars, status strips and the FAB do
   not animate on navigation, on scroll, or on data arriving. Only content transforms. A
   bottom bar that performs is a bottom bar you notice instead of the day. (§5)

5. **A tap gets a response in the same frame.** Never a spinner on a thing the user just
   touched. The local database is the source of truth for rendering; the network is a
   background concern that catches up. If the UI waits on a socket, it is rejected. (§7)

6. **Colour means one thing: which bucket of the day this is.** The seven `ACTIVITY_COLORS`
   are the only semantic colour on a content surface. Accent is for interactive state;
   green is for XP earned and positive deltas; amber is for "silenced" and "stale". Nothing
   else is coloured, and nothing is ever red for a bad day.

7. **One primary action per surface.** A row has one tick. A sheet has one filled button.
   Two competing filled buttons in one container is rejected. Reward indicators
   (`+25 XP`) are text, never buttons.

8. **If it configures the server or the website, it is not in this app.** App settings are
   app settings. The same API, a different product surface. (§9)

---

## 2. Information architecture

### 2.1 Three top-level destinations

```
┌─────────────┬─────────────┬─────────────┐
│    Today    │     Day     │     You     │
│   (agenda)  │ (time+queue)│ (goals+arc) │
└─────────────┴─────────────┴─────────────┘
```

Five tabs become three. The argument:

- **Settings is not a destination.** It is a leaf you visit rarely and leave. A permanent
  20% of the navigation bar spent on a screen opened once a month is why the bar needs five
  slots and why the five look crowded. It moves to a gear icon in Today's top app bar,
  with a settings graph behind it (§3.5).
- **Analytics is not a destination.** It is the *past tense of Today*. Analytics and Today
  show the same four quantities (XP, efficiency, consistency, study minutes) at two zoom
  levels, which is exactly how the app came to feel like a dashboard: the numbers appear
  twice. It becomes the lower half of **You**, below the goals, as "Last 7 days" with a
  range control (7d/30d/90d/all) hitting `GET /api/v1/analytics`.
- **Goals are not a destination either** — on their own they are a short read-only list
  nobody opens daily — but they *are* the emotional long game, and they own the
  celebration. They are the top of **You**.
- **Timeline earns its slot.** The ribbon, the day's shape, and the agent's queue are a
  genuinely different question from "what now", and CLIENT_GUIDE's `current` vs. `tasks`
  split is a contract. It becomes **Day**.

Three destinations also makes the navigation bar read as a decision rather than a dump, and
it removes the long pill travel that made the bar the busiest thing on screen (§5.4).

Why not two (fold Day into Today)? Because merging them re-creates the to-do list
CLIENT_GUIDE §3.8 exists to prevent: a card three hours out is planning, not doing.

Why not four (keep Goals separate)? Because You's two halves answer one question — "am I
going anywhere" — and a Goals tab that is read-only, rarely changing and mostly empty on a
fresh instance is a dead slot.

### 2.2 What moves where

| Today (old) | → |
|---|---|
| Pulse header, growth meter, agenda list, DND/offline chips | **Today** (kept, trimmed — §4) |
| "Right Now" activity strip | **Today**, as a single line in the top app bar area (§4.4) |
| Agent cards (slots 0/1) | **Today**, below the agenda, below the fold on a phone |
| Agent-setup card (slot 2) | **Settings → Connection** status strip. It is metadata about the connection, not a task. |
| `vsYesterday` five figures | **You**, and a tap on the meter (§4.3) |

| Old tab | → |
|---|---|
| **Timeline** | **Day**: ribbon, scheduled tasks grouped Today/Tomorrow/weekday/No time, "Needs you" |
| **Goals** | **You**, upper half. Celebration stays global (any screen). |
| **Analytics** | **You**, lower half, collapsed by default to the 7-day XP chart |
| **Settings** | Gear in Today's app bar → settings graph |

### 2.3 Non-destination routes

Everything else is a leaf or an overlay, reached by tap, closed by back:

| Route | Kind | From |
|---|---|---|
| `agenda/{id}` | Bottom sheet, partial → expanded | Tap an agenda row's body |
| `task/{id}` | Bottom sheet | Day rows, Needs-you rows, notification tap |
| `goal/{id}` | Full screen | You |
| `celebration/{goalId}` | Full-screen dialog, global | `pendingCelebrations` ≠ ∅, any screen |
| `session/picker` | Bottom sheet, 7 activity chips | Today's activity line |
| `study/log` | Bottom sheet (title, minutes, quality flag) | Day → FAB |
| `settings` + `settings/{appearance,notifications,day,connection}` | Full screen | Today app bar |
| `server` | **Full screen, top-level, reachable with no connection** | Settings → Connection; *every* error panel; the offline banner; §7.6 |
| `connect` / `connect/pair` | Full screen, first-run graph | Cold start with no token, or 401 |
| `outdated` | Full-screen block | `426` (§7.7) |

### 2.4 Window size classes

`NavigationSuiteScaffold` from `material3-adaptive-navigation-suite` picks the shape; we
pick the content columns. The one exception is the compact bottom bar, which is ours
because it has to track the swipe (§5.4) — the suite still decides *that* it is a bar. Derive from `currentWindowAdaptiveInfo()`, never from a
device-type check — Android resizes the app while it runs (split screen, free-form,
unfolding).

| Class | Width | Navigation | Content |
|---|---|---|---|
| Compact | < 600dp | Navigation **bar**, bottom (ours — it tracks the swipe, §5.4) | One column, content max 560dp, centred |
| Medium | 600–839dp | Navigation **rail**, left | One column, centred |
| Expanded | ≥ 840dp | Navigation rail (optionally with headers) | Two columns on Today and Day |

Expanded two-column rule, inherited from the old `TwoPane`: in one column the agent's cards
come **after** the day, never before. Your own habits are what the screen is for; the
agent's reading of them is commentary.

Orientation: portrait-locked on phones (`screenOrientation="portrait"` for Compact only is
not expressible in the manifest, so the manifest stays unlocked and the app simply lays out
correctly in landscape — the Expo app's portrait lock was protecting a layout that could not
cope, and this one can).

---

## 3. Screen-by-screen

Format for each: what it shows / what it deliberately does not / layout / primary action /
empty / loading / error / offline.

Three state rules apply to **every** screen and are not repeated:

- **Loading** = render the cached snapshot immediately (it is in Room; a cold start with a
  cache shows content in the first frame). A refresh in flight shows a 2dp indeterminate
  line under the app bar after **600ms** only — not before, or every tap flickers.
  Truly empty cache: skeleton placeholders matching the final layout (never a centred
  spinner), replaced by the error panel after **6 seconds**.
- **Error** = inline panel **in the content area**, never a dialog, never a snackbar for a
  load failure. It states what it was waiting for, the real server message, the address it
  tried, and offers **Try again** and **Change server** — both of which work (§7.6).
  A screen with no data always offers a way out.
- **Offline / stale** = the cached snapshot renders in full, plus the status strip (§7.4).
  Nothing is hidden, nothing is greyed wholesale. Writes still work and queue.

### 3.1 Today

See §4 for the detail. Summary here for comparison.

- **Shows:** activity line, pulse word + one sentence, growth meter with ghosted 100%,
  efficiency % and `dailyXp / target`, the agenda as cards, a "Needs you (3)" link,
  agent cards (below the fold).
- **Does not show:** `totalXp`; `improvementPct`; `yesterdayEfficiencyPct`; the five
  `vsYesterday` tiles; the day-graphic style picker; consistency and XP charts; the
  timeline ribbon; achievements; quests; properties; the agent-setup card; any Start button.
- **One thing:** the growth meter.
- **Primary action:** tick a row. There is **no FAB on Today** — the primary action is
  already on every row, and a FAB would float over the one list that matters.
- **Empty:** meter at 0% with the full ghost behind it, and one line: *"Nothing on today.
  Ask your agent to set up some habits."* with a secondary **How this works** that opens
  the first-run explainer. Never an illustration-plus-paragraph empty state.

### 3.2 Day

- **Shows:**
  1. The **ribbon** — `timeline`, rendered exactly as the server computed it. 0–24h,
     continuous, gap-free, `left = startHour/24`, `width = (endHour-startHour)/24`,
     overdrawn ~0.2dp to kill subpixel seams. `actual: true` solid, `actual: false`
     tinted + 1dp outline, `status: "done"` at 55% opacity. Now-marker at
     `(hour + min/60)/24`, full height, 2dp, accent. Never recomputed from blocks.
  2. **Needs you** — open tasks of `kind: review` plus anything the agent queued with no
     time, as a short list with complete/dismiss. Pulses (§5.5) until empty. This is where
     [divergence 1] lands.
  3. **Scheduled** — every visible task, bucketed by the local day of
     `eventAt ?? remindAt ?? showAt`: *Today · Tomorrow · <weekday> · No time*. Cards with
     no time get their own bucket; they are never dropped.
- **Does not show:** habits (they live on Today, and nowhere else); any Start button on any
  task; XP totals; the growth meter; a month or week calendar grid.
- **One thing:** the now-marker on the ribbon — the answer to "where am I in the day".
- **Layout:**
  ```
  ┌───────────────────────────────────────────────────┐
  │ Day                                        [cal] │  top app bar, small
  ├───────────────────────────────────────────────────┤
  │ ░░░░▓▓▓▓▓▓│▒▒▒▒░░░░▒▒▒▒▒▒▒▒░░░░░░░░░░░░░░░░░░░░░ │  ribbon, 56dp, full-bleed
  │ 04        09   ▲now          17              28  │  sparse hour ticks
  ├───────────────────────────────────────────────────┤
  │ Needs you · 2                                     │
  │   ◦ Weekly review                      ✓    ✕    │
  │   ◦ How did the 21:30 block go?        ✓    ✕    │
  ├───────────────────────────────────────────────────┤
  │ Today                                             │
  │   19:00  Deep work block            45m    +20 XP│
  │   21:30  Read                       20m    +12 XP│
  │ Tomorrow                                          │
  │   07:00  Stretch                           +8 XP │
  │ No time                                           │
  │   ◦ Order the resistance bands             +5 XP │
  └───────────────────────────────────────────────────┘
  ```
  Rows here are **list rows, not cards** — 56dp, a 3dp activity-coloured leading rule, time
  in mono, title, duration, XP as green text, a repeat badge when `repeatRule != "none"`,
  a bell glyph when a reminder is set. Deliberately lighter than an agenda card: this is
  reading, not doing.
- **Primary action:** the FAB — **Log study** (`POST /api/v1/study`), the one write that is
  genuinely the user's and has no row to hang off. Quality flags `normal · struggle ·
  inspired · feynman · retrieval` are offered as chips (the last three carry multipliers;
  they are not cosmetic).
- **Empty:** ribbon still draws (sleep/wake from settings give it shape) with
  *"Nothing scheduled. Your agent will put things here."*

### 3.3 You

- **Shows:**
  1. **Goals**, read-only: emoji, title, `progressPct` as a thin determinate track, tier
     pips where tiers exist. The goal nearest completion is first and rendered larger.
  2. **Last 7 days**: the `xpSeries7` area + dashed target line, and `consistency7`.
  3. **Vs. yesterday**: the five figures — `today` large, `delta` small and signed, green
     for positive, **grey** for negative.
  4. **Collapsed below**: achievements, quests, properties (`{key, label, value, unit}`),
     each behind a header, each hidden entirely when its `settings.*Enabled` flag is false.
- **Does not show:** a create-goal button, anywhere, ever. No levels, no ranks, no rarity
  leaderboard. No lifetime XP as a headline (it may appear once, small, in the properties
  block).
- **One thing:** the top goal card.
- **Primary action:** none. This screen is for reading. No FAB.
- **Range control** on Last 7 days switches to 30d/90d/all via `GET /api/v1/analytics`;
  that call is the only screen-specific network read in the app.
- **Empty:** *"No goals yet. Goals come from your agent — ask it what you should be aiming
  at."* The 7-day chart still renders with real (possibly zero) data.

### 3.4 Celebration (global overlay, not a destination)

Full-screen dialog over whatever is on screen, triggered whenever `pendingCelebrations` is
non-empty — including on Day, on You, and on cold start. One at a time, queued.

- Goal emoji/art large, title, `whyItMatters`, and the one moment this app is allowed to be
  loud: particles honouring `celebrationIntensity` (`full` → full; `minimal` → a single
  restrained bloom, no particles; `off` → none at all, the dialog still appears).
- **One** button: **Nice.** Dismissing it — and only that — calls
  `POST /api/v1/goals/:id/celebration-seen`.
- No auto-dismiss, no timer, no dismiss-on-scrim-tap, no system-back dismissal. If the user
  kills the app, the celebration is waiting next time, and that is correct.

### 3.5 Settings

Four subpages behind a plain list. No switches on the index — the index is navigation only,
so the screen is six rows rather than thirty controls.

```
Settings
  Appearance          Theme, day graphic, reduced motion        ›
  Notifications       Per-type sounds, quiet hours, DND         ›
  The day             Reset time, lead minutes, sleep/wake      ›
  Connection          Server, token, health, pending writes     ›
  ─────────
  Home screen widget                                           ›
  About               version · protocol · open source          ›
```

| Subpage | Contents |
|---|---|
| **Appearance** | Theme (8 device-local palettes, §6.4), day-graphic style, **Reduced motion** (device-local, OR'd with the OS flag). |
| **Notifications** | Per-type sound rows (§8), one **Test** per type, Do not disturb, Quiet hours on/off + start/end, reminder lead chips (5/10/15/30/60). |
| **The day** | `dayResetTime`, `plannedWake`, `plannedSleepStart/End`, timezone (read-only display). All `PATCH /api/v1/settings`. |
| **Connection** | Address (mono), **Change server** →, token source ("API token · Android Keystore"), live `/health` with `lan: true/false` and a link to `docs/NETWORK.md` when false, protocol version, **Pending writes (2) →**, **Disconnect** (destructive, confirmed). The slot-2 agent-setup card renders here as a slim strip. |
| **Widget** | What it shows, how to add it, and a note that it updates on the same poll. |

- **Does not show:** anything that configures the website or the server's own presentation.
  No "Web app accent". No storage mode, Supabase URL, webhook URL, backup interval, or XP
  pool — those are the agent's and the server's. (§9)
- Server-backed settings write optimistically through the same queue as everything else, so
  a toggle flips instantly offline and syncs later.

---

## 4. Today, in detail

This is the screen people look at. Everything else can be imperfect.

### 4.1 Layout, phone (Compact)

```
┌──────────────────────────────────────────────────────┐
│  Wed 20 Oct                                     ⚙   │  ← top app bar, 56dp
│                                                      │    date in mono, small
├──────────────────────────────────────────────────────┤
│  ● Deep Work · 01:12:48                      Stop    │  ← activity line, 40dp
├──────────────────────────────────────────────────────┤
│                                                      │
│                    ╭───────╮                         │
│                 ╱  ╲  ghost 100%                     │
│                │   🌱  │                      69%    │  ← THE one thing
│                 ╲    ╱                   138/200 XP  │    meter ~200dp
│                    ╰───────╯                         │
│                                                      │
│              Improving                               │  ← 28sp, coloured
│   Consistency and output are trending up.            │  ← 14sp, muted, 2 lines max
│                                                      │
├──────────────────────────────────────────────────────┤
│  ┌────────────────────────────────────────────────┐  │
│  │ ▌┌────┐ 07:30                         +12 XP   │  │  ← agenda card
│  │ ▌│ 📖 │ Read 20 pages                          │  │
│  │ ▌└────┘ after I sit at my desk        ( ○ )    │  │
│  │ ▌       ▪▪▫▪▪▪▫                                │  │
│  └────────────────────────────────────────────────┘  │
│  ┌────────────────────────────────────────────────┐  │
│  │ ▌┌────┐ 09:00                         +20 XP   │  │
│  │ ▌│ 🧠 │ Retrieval session                      │  │
│  │ ▌└────┘ 90m                           ( ○ )    │  │
│  └────────────────────────────────────────────────┘  │
│                        ⋮                             │
│  Needs you · 2                                    ›  │  ← link to Day
│  ─────────────────────────────────────────────────   │
│  From your agent                                     │  ← below the fold
│  ┌──────────────┐  ┌──────────────┐                  │
│  │ slot 0       │  │ slot 1       │                  │
│  └──────────────┘  └──────────────┘                  │
└──────────────────────────────────────────────────────┘
│       Today            Day             You           │  ← navigation bar, 80dp
└──────────────────────────────────────────────────────┘
```

Five information units above the fold: activity, meter(+its two numbers), pulse, and the
first two agenda cards. That satisfies principle 2 with nothing to spare, which is the
point.

### 4.2 The pulse

`pulse` ∈ `Improving · Stable · Recovering · Drifting`, with `pulseExplanation` beneath it.
28sp, `Outfit` semibold, coloured: Improving `#34D399`, Recovering `#FBBF24`, Drifting
`#94A3B8`, Stable = accent. Never accompanied by a number that contradicts it — which is
why `improvementPct` is not next to it.

The explanation is clamped to two lines with no "more" affordance. If the server sends
something longer, it is truncated; the sentence is a mood, not a document.

### 4.3 The meter

`progress.growthStyle` (`sprout` | `orb`) from the server. The ghosted 100% state is drawn
behind the live state, always — this is a contract, not a style. Readout placement is
**per style and the two are not variations of each other**: the orb's middle is empty so
the number is centred and large inside it; the sprout has no empty middle (a centred number
lands on the pot and roots) so the number sits at the right edge, vertically centred, where
the viewBox is empty at every growth level.

Below/beside it, in mono: `69%` and `138/200 XP`. Nothing else. `efficiencyPct > 100` shows
the real figure; only the fill is clamped.

**The figure is centred in its container at every width**, including the second column of
the Expanded layout. And the halo is drawn into a node `2 × 0.78 = 1.56` times the figure's
side, not the figure's own: a draw modifier clips to its node, so a glow of radius
`0.78 · side` drawn into a `side` box loses everything past the halfway point and ends in a
hard rectangular edge. The figure's size is therefore capped by the width the halo needs
(`width / 1.56`) as well as by the height; vertically the halo is allowed to bleed past the
meter's box, where it falls on page background and fades out, rather than on a screen edge
where a cut would show. The arithmetic is `Growth.figureSide` / `Growth.haloBoxSide` and is
unit-tested.

**Tapping the meter** opens a bottom sheet with everything cut from Today:
`improvementPct` (signed, as percentage **points**), `yesterdayEfficiencyPct`, the five
`vsYesterday` figures, and lifetime XP in small mono at the bottom. One tap, no tab.

The orb's two load-bearing details survive the port and must be preserved in Compose:
the liquid is a full-height layer translated on Y (not an animated height — height is a
layout property and re-measures every frame), and each crest scrolls by exactly its own
period (`inner/2`, `inner/3`) or the tiled sine visibly jumps once per loop.

### 4.4 The activity line

`activeSession` is the only running thing in the app. One 40dp line: a filled dot in the
activity's colour, the activity name, a `HH:MM:SS` elapsed counter **ticked locally** from
`startedAt` (never polled), and a text **Stop**.

Idle: the same line reads `Not tracking` with a text **Start** that opens the 7-chip picker
(`Deep Work · Study · Sleep · Exercise · Break · Life Admin · Exploration` — a closed set;
do not invent tags).

It is deliberately quieter than an agenda card and its control is smaller than a row's
tick. It is the one thing on Today that is not a thing to do.

### 4.5 The agenda card

One card per `AgendaItem`, from `data.agenda`, already merged and already ordered. **Do not
re-split it** into habits/tasks or Today/Anytime. `data.anytime` is a convenience subset —
it is **not** a second section on this screen.

Anatomy (height 88dp for a task, 104dp with a week strip):

```
 ┌─ card border, activityColor(activityTag) ── radius 20dp ─────────────┐
 │    ░ habit background picture, cover-cropped, under its scrim ░      │
 │   ┌────────┐   07:30 · in 12m                            +12 XP      │
 │   │  icon  │   Read 20 pages                                         │
 │   │  48dp  │   after I sit at my desk                   ╭─────╮      │
 │   └────────┘   ▪▪▫▪▪▪▫                                  │  ○  │      │
 │                                                         ╰─────╯      │
 └──────────────────────────────────────────────────────────────────────┘
```

| Slot | Content | Type |
|---|---|---|
| Edge | **No colour bar of any width.** `mobile-frontend/app/AGENTS.md` settled this and it holds here: a strip of colour down the left of a card reads as a divider between two rows rather than as a mark on one, at 3dp or at 4dp. The card's own 1dp border carries `activityColor(activityTag)` — 18% normally, 40% for `now` and `overdue`, 10% for `anytime` and `done` — and the `now` pulse carries it louder. Day's rows follow the same rule. | — |
| Background | The habit's `backgroundImageUrl`/`backgroundImageData`, cover-cropped to fill the card, **always under a scrim**. The scrim is **measured, not assumed**: the picture's own mean luminance is read once (an 8×8 downscale, in linear light, off the main thread, once per cache key) and the scrim is darkened until the *palest* text on the card — the 13sp `muted` sub-line — clears **4.5:1**. A flat percentage cannot promise that: 35% over a dark photograph is more than it needs and 35% over a blown-out one leaves white text on a white sky, which is what shipped first and was only ever correct by luck. `artOverlay` is the **floor** of how dark it goes and never the cap — an agent may ask for darker, not for lighter, because it cannot see the device the text will be read on. A small vertical deepening (+0.12 toward the foot) and nothing that ever lightens. Nothing is drawn at all when there is no picture, which is the normal case. | — |
| Icon tile | 48dp rounded-12dp tile. The resolved picture if there is one, else `emoji` at 24sp, else the activity glyph. The tile is 48dp square in all three cases, so gaining or losing a picture never re-lays-out the row; the activity tint stays under the picture, so an icon with transparency sits on colour rather than on a hole. | — |
| Meta line | `at` as `HH:mm` plus a relative `in 12m` when within the lead window. Omitted entirely for `state: "anytime"`. | JetBrains Mono 12sp, `faint` |
| Title | `title`, max 2 lines, ellipsised | Figtree SemiBold 17sp, `text` |
| Sub | `subtitle` for a task; for a habit, the **anchor** ("after I sit at my desk") — it is why the habit sticks, so it is surfaced. Max 1 line. | Figtree 13sp, `muted` |
| Week strip | Habits only, from `data.habits[habitId].history7` — 7 marks, oldest first, 8×8dp, done = activity colour, missed = `rgba(255,255,255,.08)`. **A missed day is never red.** | — |
| XP | `+12 XP` — a reward indicator, **not a button**. | Mono 12sp, `#34D399` |
| Tick | 44dp circular target (48dp touch), 2dp ring when open, filled with a check when done. The one primary action. | — |

The `AgendaItem` does not carry the habit's art or `history7`, by design — copying a `data:`
URI onto every agenda item would resend the same picture every poll. The screen passes the
habit in, looked up by `habitId` against `data.habits`, which the same payload already
carries. So a **habit** row draws the habit's two slots; a **task** row has only
`iconImage`, which the server already resolved for it, and never a background. One
function decides that — `Art.of(item, habit)` — because a card and the sheet behind it
disagreeing about which picture is which is exactly how the two clients drifted.

**The art is cached on a key, not on the picture.** `<item id>/<slot>/<length.hash>`. The
payload arrives every 8 seconds with the base64 inline; keyed on the data itself, every row
would hash hundreds of kilobytes per poll before the cache could say it already had the
bitmap, and the request object would change identity and restart the load, which the user
sees as a blink. Keyed on the fingerprint, an unchanged picture is the same request and
nothing happens.

**One arrangement, not four.** The server's `cardStyle.layout` offers `banner`, `background`,
`side` and `plain`. This client always draws `background`. A banner or a side crop is a
choice about how a picture looks; the wash under a scrim is the only one of the four that
cannot end with the agent's own sentence sitting unreadable on a photograph, and on a phone
that rule outranks the agent's preference.

**Per-state treatment** (`AgendaState`):

| State | Treatment |
|---|---|
| `now` | Border colour at 40%, a soft outer glow at 12%, and the only card that pulses (§5.5) |
| `upcoming` | Default |
| `anytime` | No meta line; border at 10% |
| `overdue` | Border at 40% **amber**, meta line reads `20:00 · 40m ago` in amber. Not red. |
| `done` | Whole card to 55% alpha, leading rule to 30%, tick filled, XP reads `+12 XP ✓`. **No strikethrough** — it reads as deletion, and the thing was done, not cancelled. |

Tapping the card body (not the tick) opens the detail sheet: `body`, `purpose`,
`resources` as link rows, streak and longest streak when `streaksEnabled`, repeat rule in
words, the task's artwork if any, and a secondary **Undo** when done.

Artwork in a sheet is drawn as *content* rather than as a background — there is no text over
it to protect. An agent's inline `svg` is drawn there and on its card, decoded to a bitmap
through the image loader's SVG decoder. That is safe for the same reason the web client's
`<img>` is: the server sanitises the markup hard (`docs/API.md`, "SVG sanitizing") and
nothing on this side can execute it, fetch from it or follow a link in it — there is no
WebView anywhere in this app. A vector that will not decode falls back to the picture, then
to the emoji; never a broken box.

### 4.6 Ticking a row

The rule: **a tick must not move the row.** Mechanics:

1. On tap, the tick animates in place (§5.3) and the card transitions to `done` treatment.
   The row's index does not change. No list re-sort, no collapse, no slide, no removal.
2. The write is enqueued (§7) and the UI has already moved on. Habit → `POST
   /habits/:id/complete {source:"user"}`; task → `POST /tasks/:id/complete {source:"user"}`.
3. Aggregates (meter, %, XP) are **not** hand-patched. A single write can award XP, move
   efficiency, flip the pulse, schedule the next occurrence and complete a goal; rebuilding
   that client-side drifts. The queue triggers an immediate refetch and the meter animates
   from old to new value when it lands (typically < 400ms on-LAN). Offline, the row is done
   and the meter holds its cached value with the stale strip showing — honest, and still
   instant where the finger was.
4. `409` on a habit is success, silently.

**Ordering epoch.** The server's `compareAgenda` puts `done` last, so a naive re-render on
the next poll *would* move the row the user just ticked. The list therefore captures its
order once per **epoch** and applies incoming items into that order, appending anything new
at its sorted position. A new epoch (full re-sort) begins only on: a life-day change, a cold
process start, or an explicit pull-to-refresh. Within an epoch, nothing already on screen
ever changes index.

Undo lives in the detail sheet and in a 5-second snackbar after a tick — the snackbar is
the only transient surface on Today, it never covers the navigation bar (it insets above
it), and it does not reappear on a second tick of the same row.

---

## 5. Motion

### 5.1 The stance

Motion exists to explain where something came from and that a tap registered. It is not
decoration and it is never idle. Compose makes 60–120fps animation free, which is exactly
why this section is a budget rather than a palette.

**Chrome is still, content moves.** (Principle 4.)

### 5.2 Tokens

Use `MaterialTheme.motionScheme` (M3 Expressive) where it fits, and these named tokens
where it does not. Durations are Material 3 standard; do not invent new ones.

| Token | Duration | Easing | Used for |
|---|---|---|---|
| `instant` | 100ms | `LinearEasing` | Ripple, press-state alpha, tick ring |
| `short` | 200ms | `EaseOutCubic` (M3 standard decelerate) | Chip select, sheet scrim, strip appear/disappear |
| `medium` | 350ms | M3 emphasized `(0.05, 0.7, 0.1, 1.0)` | Sheet enter/exit, destination cross-fade, card state change |
| `long` | 500ms | M3 emphasized | Meter value change, full-screen enter |
| `spring.snap` | — | `spring(dampingRatio = 0.9f, stiffness = 1400f)` | The tick's scale punch, and nothing else |
| `celebration` | 900ms | emphasized decelerate | Celebration dialog and its particles only |

Nothing in the app animates longer than 500ms except the celebration. If a transition needs
more time, it is doing too much.

### 5.3 What animates

| Thing | Animation |
|---|---|
| **Tick** | Ring → fill, 100ms, with a single `spring.snap` scale 1.0 → 1.12 → 1.0. The check path draws in 120ms. This is the app's signature micro-interaction and it is allowed to be crisp. |
| **Card → done** | Alpha and border colour over `medium`. No size change, no position change. |
| **Meter** | `animateFloatAsState` over `long` from the previous value. Leaves reveal as thresholds are crossed; the bloom at 1.0 is a one-shot arrival, because 100% must not look like a brighter 99%. |
| **Destination change** | By tap: content cross-fades + 4% scale-in over `medium` (M3 "top level transition"), and the navigation bar does not move, re-layout, or animate its background. By swipe: the pages follow the finger and the bar's indicator tracks them continuously, settling in `short` (§5.4). |
| **Drill-in (sheet, detail, settings)** | Shared-axis Z: incoming scales 92%→100% with fade, outgoing 100%→104% with fade, `medium`. Predictive back drives it in reverse under the user's finger (`PredictiveBackHandler`). |
| **Status strip** | Expand/collapse height + fade, `short`. It appears once per state change, not per poll. |
| **Pending-write count** | Cross-fades the number. Never spins, never bounces. |
| **Needs-you items** | `pulse` (§5.5) |
| **Celebration** | Scale 0.9→1.0 + fade over `celebration`, particles for `celebrationIntensity: full` only. |

### 5.4 What must not animate — and the bottom bar specifically

The brief says the bottom is too busy. The diagnosis: the current bar animates a
critically-damped pill that **travels the full width across five tabs**. Every navigation
therefore produces a long, eye-catching horizontal slide at the exact bottom edge where the
thumb already draws attention — and the animation is of the *chrome*, which carries no
information about the content that just changed. It was tuned (`mass .55, damping 30,
stiffness 420`) because it overshot; a thing that needs critical damping to stop wobbling
across five tabs is a thing that should not be travelling.

**Replacement:** three items, and the active indicator **never travels on its own**. On a
tap it cross-fades out at the old item and in at the new one over 200ms, while the icon
swaps outlined → filled in place. Nothing slides. Nothing springs. The label is always
visible (`alwaysShowLabel = true`) so nothing appears or disappears either. Total
on-screen movement at the bottom edge from a tap: zero pixels.

#### The rule, stated precisely

The original rule here said "zero pixels of travel", full stop. That was aimed at a pill
that **animated itself after a tap** — chrome moving on its own, telling the user nothing
about the content that had already changed. Milestone 4 added a swipe between the three
destinations, and a swipe is a different thing: the user's own finger is on the pages, and
an indicator that ignored them until the gesture ended would be *less* honest, not more.
So the rule is:

- **No self-animating travel on navigation.** Nothing in the navigation bar may move of its
  own accord — not after a tap, not on arrival, not because data came in. A tap is still
  zero pixels of travel.
- **Continuous tracking during a gesture is required.** While a horizontal swipe is moving
  the pages, the active indicator moves with them, frame for frame, in real time. It is
  direct manipulation, not decoration: it stops when the finger stops and it goes back when
  the finger goes back. Label and icon states interpolate with it rather than flipping at
  the halfway point.
- **The settle is the gesture finishing, not an animation starting.** When the finger lifts,
  the pages and the indicator run to the nearest committed page in `short` (200ms,
  decelerate) — a fixed duration, never a spring. The old bar needed critical damping to
  stop wobbling; nothing here is allowed to need that.
- With reduced motion the gesture still works and still tracks — it is the user's finger —
  but the settle is immediate and the change reads as a cross-fade (§5.6).

Mechanically this means the compact bar is ours rather than a stock `NavigationBarItem`,
whose indicator cannot be told where to be. Each item draws its own indicator at that
item's `selectedness`, offset by how far the pages are from it; mid-gesture two of them
coincide and read as one pill under the finger, and at rest exactly one is visible and
un-offset. The navigation rail (Medium/Expanded) keeps the stock items: a vertical rail has
no sideways travel to track, and the swipe still works underneath it.

**Gesture ownership.** The swipe only takes a drag that is past the touch slop *and* twice
as horizontal as vertical. Inherited from the Expo app and kept deliberately: the screen
under this gesture is a scrolling agenda, and losing a scroll to a page turn is far worse
than losing a page turn to a scroll. Nothing is consumed until that test passes, so a
vertical scroll never sees this gesture at all. One swipe moves one tab, whatever the
velocity; a slow drag under 35% of a page snaps back, and a flick past 400dp/s commits
however short it was. The rules live in `domain/TabSwipe` and are unit-tested.

Also banned:

- Any animation on the top app bar beyond M3's standard scroll-driven elevation/colour.
- Collapsing/expanding/hiding chrome on scroll. The bar stays put.
- Parallax, carousels, auto-advancing anything.
- Entry animations on list items. A card does not fly in; it is already there. (Per-item
  stagger on a 12-row agenda is 1.2s of movement before the user can act.)
- Shimmer on skeletons. Static placeholders at 6% alpha.
- Anything animating because data arrived, other than the meter's value and the status strip.
- Loading spinners on surfaces the user just touched.
- Infinite/looping animation, with exactly two exceptions: the orb's liquid crests (the
  signature, and only while the orb is on screen) and the Needs-you pulse.

### 5.5 Pulse

`agentEvents`/reviews must "demand attention until completed" (CLIENT_GUIDE §3.7), as must
a fired-but-unresolved reminder (§4.3). One pulse, used in both places: a 2dp border
breathing between 25% and 60% alpha, 1800ms per cycle, `EaseInOutSine`. No scale, no
shadow, no colour change. It stops the instant the item is completed or dismissed, and
there is never more than one pulsing *region* on a screen (the Needs-you block pulses as a
block; its rows do not pulse individually).

### 5.6 Reduced motion

Honour **both** `settings.reducedMotion` and the OS
(`Settings.Global.ANIMATOR_DURATION_SCALE == 0f`, observed live, plus
`TRANSITION_ANIMATION_SCALE`). OR them: either one on means reduced.

When reduced:

- Every duration above collapses to **100ms cross-fade**. No springs, no scale, no
  translation anywhere.
- The meter jumps to its value. Leaves do not grow in; the bloom is a static arrival state.
- The orb's crests stop (static liquid at the right level). The sprout is static.
- The pulse becomes a **static** 60%-alpha border. The information ("this needs you")
  survives; the movement does not.
- The celebration still happens, full-screen and unmissable, with no particles and no
  scale — it is a contract, not an animation.
- Predictive back still works (it is a system gesture, not our animation).

`celebrationIntensity` is independent and composes: `off` means no particles even with
motion fully on, and the dialog still appears and still requires a dismissal.

---

## 6. Theming

### 6.1 Dark only

There is no light theme. `isSystemInDarkTheme()` is never called. The app sets
`android:forceDarkAllowed="false"`, a dark `windowBackground`, and dark status/navigation
bar appearance. No `DayNight` theme parent, no `values-night/` directory, no `.light`
variant of any token. A reviewer finding a light colour value in the tree should delete it.

### 6.2 A theme swaps colours and nothing else

This is enforced structurally, not by discipline. One data class, every field a colour:

```
Palette (data class, 14 colour fields, nothing else)
  accent        accent2
  bg            surface       surface2      border
  text          muted         faint
  positive      warning       neutralNeg
  scrim         glow
```

Spacing, radii, type scale, elevation, motion durations, icon sizes, strip heights, leaf
thresholds and the seven `ACTIVITY_COLORS` live in **separate, non-themed** objects and are
`val`s with no palette parameter. A theme physically cannot reach them. `ACTIVITY_COLORS`
in particular is *not* part of a palette: the seven buckets must mean the same colour in
every theme, on the ribbon, on the widget and on the web, or the ribbon needs a legend.

Switching a theme recomposes colours only — no layout pass changes, no measurement changes,
no re-sort, no scroll jump.

### 6.3 Mapping to Material 3 colour roles

Material 3 components want a `ColorScheme`. Build a dark `ColorScheme` from the palette
rather than exposing both to feature code:

| M3 role | From |
|---|---|
| `primary` | `accent` |
| `onPrimary` | `bg` |
| `primaryContainer` | `accent` @ 18% over `surface` |
| `secondary` | `accent2` |
| `background` / `surface` | `bg` |
| `surfaceContainerLowest … surfaceContainerHighest` | `bg`, `surface`, `surface`+2%, `surface2`, `surface2`+3% |
| `onSurface` | `text` |
| `onSurfaceVariant` | `muted` |
| `outline` | `border` |
| `outlineVariant` | `border` @ 50% |
| `error` | `#F87171` — **only** for destructive confirmation (Disconnect). Never for a bad day, a missed habit, a broken streak, or a negative delta. |
| `scrim` | `scrim` |

Elevation: M3 dark elevation is **tonal, not shadow**. Surfaces step by colour
(`bg → surface → surface2`), and the only shadow in the app is the FAB's. Cards use a 1dp
border and a container colour, never `elevation = 4.dp`. A "floating" card on near-black
reads as mud.

### 6.4 The eight palettes

Device-local (DataStore), deliberately richer than the API's four `accentTheme` hues, and
**not** written from or to the server setting. Default `bloom`.

Default theme — **bloom** (concrete values, these are normative):

```
accent      #FF5FA2      hot pink, interactive + Stable pulse
accent2     #FFA0C9      soft pink, gradients and the meter's second stop
bg          #0D0910      near-black, faintly magenta
surface     #1A1220      cards
surface2    #241829      inputs, chips, the pressed state
border      rgba(255,255,255,0.07)
text        #F6F4F8
muted       #A8A3B4
faint       #6E6A7C
positive    #34D399      XP earned, positive deltas, "Improving"
warning     #FBBF24      overdue, stale, silenced, "Recovering"
neutralNeg  #94A3B8      negative deltas and "Drifting" — the no-red rule lives here
scrim       rgba(6,4,8,0.72)
glow        rgba(255,95,162,0.12)
```

The other seven keep the existing app's identities so the two apps and the widget agree:

| id | accent | accent2 | bg | surface | surface2 |
|---|---|---|---|---|---|
| `bloom` *(default)* | `#FF5FA2` | `#FFA0C9` | `#0D0910` | `#1A1220` | `#241829` |
| `quantum` | `#C77DFF` | `#8B6BFF` | `#0B0912` | `#171327` | `#211B33` |
| `ember` | `#FF7A6B` | `#FFC46B` | `#100B0B` | `#1E1414` | `#2A1C1A` |
| `nebula` | `#7C9CFF` | `#B69CFF` | `#090A12` | `#141728` | `#1D2134` |
| `tide` | `#2DD4BF` | `#38BDF8` | `#07100F` | `#0F1D1E` | `#16292B` |
| `terminal` | `#4ADE80` | `#A3E635` | `#080D0A` | `#111A15` | `#19261D` |
| `sunset` | `#FB923C` | `#F472B6` | `#0E0A08` | `#1B1410` | `#261B15` |
| `amber` | `#FFC857` | `#FF9E6B` | `#0E0C07` | `#1A160F` | `#251F15` |

`text`/`muted`/`faint`/`positive`/`warning`/`neutralNeg` are shared across all eight;
`border` is always `rgba(255,255,255,0.07)`; `glow` is `accent` @ 12%.

Every pairing must hold **4.5:1** for body text and **3:1** for 17sp+ and for the active
navigation indicator against its surface. A new palette ships only with a passing contrast
test (a unit test over the palette table, not a manual check).

### 6.5 Dynamic colour: no

Do not use Material You wallpaper extraction (`dynamicDarkColorScheme`). Reasons, in order:

1. **The accent is load-bearing art, not chrome.** The growth meter, the bloom, the
   constellation and the celebration are drawn from `accent`/`accent2`/`glow` as a
   two-stop gradient tuned per palette. A wallpaper-derived pair can be low-chroma,
   near-identical, or close enough to `positive`/`warning` that "Improving" and "Stable"
   stop being distinguishable.
2. **Three surfaces must agree.** The phone, the home-screen widget and the web client show
   the same day. A wallpaper-driven app makes them three different products.
3. **Contrast cannot be guaranteed.** On an `oklch(7%)` background, several tonal palette
   steps land under 4.5:1, and we cannot test the user's wallpaper.
4. **It is not needed for personalisation.** Eight hand-tuned palettes already give more
   choice than the API's four, and they are reversible and testable.

The app does read `ACTION_CHANNEL_NOTIFICATION_SETTINGS`-era system behaviours and honours
the system font scale and reduced motion — system *integration* is good; system *colour* is
not.

### 6.6 Type

| Role | Font | Size / weight | Notes |
|---|---|---|---|
| Display (pulse word) | Outfit | 28sp SemiBold | Headings and anything with voice |
| Title (screen, card) | Outfit / Figtree SemiBold | 22sp / 17sp | |
| Body | Figtree | 15sp / 13sp | |
| Label | Figtree Medium | 12sp | Navigation labels, chips |
| **Every number, time, duration, percentage and id** | **JetBrains Mono**, `tabular` figures | 11–16sp | Non-negotiable: it stops figures jittering as they tick |

Honour the system font scale up to 1.3× with no clipping (test at 1.3 and at 200% display
size). Line length is capped at 560dp and centred, like the old `PageBody`.

Spacing scale: `4 · 8 · 12 · 16 · 20 · 24 · 32`. Radii: `12` (tile), `20` (card),
`28` (sheet, FAB). Not themed.

---

## 7. Connectivity & state UX

The current app's failure is architectural: the network is the source of truth, so every
tap waits on a socket and every failure is an error panel. The rewrite inverts that.

### 7.1 Architecture (because the UX depends on it)

```
     UI (Compose)  ──reads──►  Room  ◄──writes──  Sync
          │                      ▲                  │
          │ tap                  │                  │ OkHttp + WorkManager
          ▼                      │                  ▼
   PendingWrite ──enqueued──► pending_writes ──────► API
          │
          └─ optimistic overlay applied to the Room read, immediately
```

- **Room is the only thing the UI reads.** One table holds the latest
  `GET /api/v1/dashboard/today` snapshot (as parsed entities plus `fetchedAt`), and one
  holds `pending_writes`. A cold start renders real content in the first frame.
- **The poll** is 8s while Today is resumed (10s on Day, 15s on You), stopped when the
  process is backgrounded, and fired immediately on resume, on reconnect, and after any
  write is enqueued. Never poll from the composition.
- **Writes never block the UI.** Enqueue → optimistic overlay → return. `WorkManager` with
  a network constraint and exponential backoff drains the queue in order.
- No React-Query equivalent, no `networkMode` concept, and no "offline" gate on reads —
  Life OS lives on the LAN, so a phone with no internet can reach it and a phone with
  perfect internet cannot if the machine is asleep. Always attempt; type the failure.

### 7.2 Connection state machine

One observable state, rendered by one strip (§7.4) and one error panel:

```
Unconfigured ──connect/pair──► Probing ──ok──► Online
                                  │             │  │
                                  │             │  └─ poll fails ─► Stale ─ 3 fails ─► Unreachable
                                  │             └─ 401 ──────────────────────────────► Unauthorized
                                  └─ 426 ──────────────────────────────────────────────► Outdated
Unreachable ──any success──► Online        Unauthorized ──re-enter token──► Probing
```

| State | Meaning | Surface |
|---|---|---|
| `Online` | Last poll succeeded | No strip at all |
| `Stale` | 1–2 consecutive failures, cache < 10 min old | Amber strip: *"Last updated 2 min ago"* |
| `Unreachable` | 3+ failures, or cache older than the poll by >10× | Amber strip: *"Can't reach Life OS"* + **Retry** + **⋮ → Change server** |
| `Unauthorized` | `401` | Clear the token, go to `connect` with the address prefilled. Never retry in a loop. |
| `Outdated` | `426` | Full-screen block (§7.7) |

### 7.3 First run

```
connect
┌──────────────────────────────────────────┐
│                                          │
│            [ Life OS mark ]              │
│                                          │
│   Life OS runs on your own machine.      │
│   Connect this phone to it.              │
│                                          │
│   ┌────────────────────────────────────┐ │
│   │   ▣   Scan the QR on your          │ │  ← FILLED button, the happy path
│   │       dashboard                    │ │
│   └────────────────────────────────────┘ │
│                                          │
│   Enter the address manually             │  ← text button
│                                          │
│   Where do I find this? ›                │
└──────────────────────────────────────────┘
```

**QR pairing is the primary path and is kept exactly as it works today.** The dashboard
mints a single-use code (`POST /api/v1/pair`), draws `<base>/pair#c=CODE` as a QR; the phone
scans it (CameraX + ML Kit barcode, bundled on-device model — no network, no Play Services
download at first run) or arrives via the `lifeos://connect?code=…&url=…` deep link; the app
calls `POST /api/v1/pair/claim` (unauthenticated, by design) and receives `{baseUrl, token}`.

- The code is in the URL **fragment** — never log the scanned URL, and never put the code
  or token in a query string of our own.
- Failure copy distinguishes the three real cases: *"That code has already been used"*,
  *"That code expired — mint a new one on your dashboard"* (both are the same server
  response, compared in constant time, so the copy is one line covering both:
  **"That code is no longer valid. Mint a new one on your dashboard."**), and
  *"Scanned, but couldn't reach `http://192.168.1.4:8787` from this phone"* — which is a
  reachability problem, so it offers **Change server**, not a rescan.
- Camera permission denied → fall straight through to manual entry with a one-line
  explanation. Never a dead end.

**Manual entry** is the same form as `server` (§7.6): address, token, Test, Save.

The declared intent filters are the `lifeos://` scheme and an `https` App Link for the
`/pair` path of a configured public URL. `android:autoVerify` is not possible for an
arbitrary user host, so the `lifeos://` scheme is the one that must work.

### 7.4 The status strip

**One** surface for every non-Online state, directly under the top app bar on every screen,
32dp, `surface2` with a 2dp amber top edge:

```
├──────────────────────────────────────────────────────┤
│ ◆ Can't reach Life OS · showing 18:42    Retry   ⋮  │
├──────────────────────────────────────────────────────┤
```

Rules:

- It appears when the state changes, not on every failed poll. One `short` animation per
  state change, and then it is **still**. A strip that re-animates every 8 seconds is worse
  than no strip.
- The timestamp is the cache's `fetchedAt` in mono, so "stale" is a fact, not a vibe.
- `⋮` holds **Change server** and **Reconnect**, so `server` is reachable from every screen
  in two taps even with no connection.
- It never covers content: it participates in layout and pushes content down.
- **DND and quiet hours get the same treatment** and may stack below it as a second,
  quieter line: `◇ Silenced until 10:30`, muted, no amber edge. Silence must be visible or
  a missed reminder reads as a broken app.
- Row-level staleness is not indicated. One strip, not twelve dots. The exception is the
  pending-write dot (§7.5).

### 7.5 The pending-write queue, made visible without being noisy

`pending_writes`: `id, kind, targetId, payloadJson, lifeDayDate, enqueuedAt, attempts,
lastError`.

Visibility, in exactly three places:

1. **The row.** A pending row shows a 6dp hollow dot in its XP slot's left margin —
   `+12 XP ◌`. It is static, 40% alpha, and disappears on success. That is the whole
   indication; the tick is already filled, because the user did the thing.
2. **The app bar.** When the queue is non-empty and the state is not `Online`, a small mono
   count sits beside the gear: `2↑`. It cross-fades; it never spins. At `Online` with a
   draining queue it is not shown at all — a queue that clears in 300ms is not news.
3. **Settings → Connection → Pending writes.** The full list: what, when, which life-day,
   attempts, last error, with **Retry all** and **Discard** (confirmed).

No snackbar per write. No "Syncing…" banner. No progress bar.

**The life-day guard** — this is the condition CLIENT_GUIDE §6 attaches to queuing at all,
and it is mandatory:

- Every write is stamped with the `lifeDay.date` that was current when the user tapped.
- Before sending, the worker compares the stamp with the server's current `lifeDay.date`
  (from the last snapshot, re-probed if older than the poll interval).
- **Stamps match → send.** **Stamps differ → do not send.** A habit completion replayed
  after 04:00 lands on the wrong day and silently corrupts a streak; that is strictly worse
  than losing the write.
- Expired writes move to a `stranded` state and surface **once**, as a dismissible card in
  the status-strip position: *"2 changes from Tue 19 Oct couldn't be saved — the day had
  already rolled over."* with **See them** (opens the pending list, which shows exactly
  what they were) and **Dismiss**. Never silent, never auto-retried, never re-dated.
- The optimistic overlay for a stranded write is dropped at the same moment, so the row
  returns to undone and the UI stops lying.
- Writes that are genuinely day-independent — `PATCH /settings`, `/goals/:id/celebration-seen`,
  `/tasks/:id/notified`, `/tasks/:id/dismiss` — are exempt from the guard and always send.
- `409` on a habit complete resolves the write as success.
- A write is retried at most 5 times with backoff, then it is stranded with its error.

### 7.6 "Change server" — the broken flow, designed

Today the button exists and does nothing. The fix is that it navigates to a **real
top-level route that works with no connection and no token**.

`server` is reachable from: Settings → Connection; every error panel's **Change server**;
the status strip's `⋮`; the connect screen's *Enter the address manually*; and the
`Unreachable` notification. All five navigate to the same destination.

```
server
┌──────────────────────────────────────────────┐
│ ←  Server                                    │
├──────────────────────────────────────────────┤
│  Address                                     │
│  ┌────────────────────────────────────────┐  │
│  │ http://192.168.1.4:8787                │  │  mono, keyboard=URI,
│  └────────────────────────────────────────┘  │  autofills http:// and :8787
│  Recent:  192.168.1.4:8787 · 100.92.3.11:8787│  ← tap to fill
│                                              │
│  API token                                   │
│  ┌────────────────────────────────────────┐  │
│  │ ••••••••••••••••••••••••••••  [show]   │  │  from .env; paste-friendly
│  └────────────────────────────────────────┘  │
│  Keep current token                      [✓] │
│                                              │
│  ┌────────────────────────────────────────┐  │
│  │              Test                      │  │  ← tonal
│  └────────────────────────────────────────┘  │
│                                              │
│  ✓ Reachable            42 ms                │
│  ✓ Protocol 2           matches this app     │
│  ✗ Token                401 — not accepted   │
│  ⚠ LAN                  lan: false — only    │
│      this machine can reach it.  Read why ›  │
│                                              │
│  ┌──────────────┐  ┌────────────────────┐    │
│  │ Scan QR      │  │       Save         │    │  ← Save filled, enabled
│  └──────────────┘  └────────────────────┘    │    when Test passed
└──────────────────────────────────────────────┘
```

Behaviour:

- Prefilled with the current address. Non-destructive: nothing changes until **Save**.
- **Test** runs three probes with a 6s deadline each and reports them **separately**, which
  is the whole point — "can't connect" conflates four different user actions:
  `GET /health` (reachable, and `lan`), `GET /api/v1/protocol` (version), and
  `GET /api/v1/auth/me` with the token (auth).
- `lan: false` is a warning, not a failure, and links to `docs/NETWORK.md` rather than
  pretending the app can fix it.
- **Save** is enabled when Test passed; a failed Test offers **Save anyway** (the machine
  may simply be asleep, and saving a known-good address for later is legitimate).
- Saving a different address **clears the snapshot cache** and starts a new life-day epoch —
  a different server is a different life.
- The token is written to Keystore-backed `EncryptedSharedPreferences`, never plain
  DataStore, never a log line, never a crash report (there are no crash reports).
- Recent addresses are remembered (addresses only, never paired with tokens) because the
  realistic failure is a LAN IP that changed.

### 7.7 Outdated (426)

A full-screen block, not a panel, because nothing in the app can work:

> **This app is too old for your Life OS**
> Your server speaks protocol 3; this app speaks 2.
> [ **Download the new app** ]  (the response's `downloadUrl`)
> [ Change server ]

Checked cheaply via unauthenticated `GET /api/v1/protocol` on every cold start before the
first authenticated call, and reactively on any `426`. `X-LifeOS-Protocol: 2` goes on every
`/api/v1/*` request from a single OkHttp interceptor.

### 7.8 Cleartext HTTP

Life OS is reached over plain `http://` on a LAN, and Android 9+ blocks that in release
builds while debug builds work — invisible until someone installs the APK. The rewrite ships
`res/xml/network_security_config.xml` with `cleartextTrafficPermitted="true"` (base config)
and references it from `<application android:networkSecurityConfig=…>`. Keep it. The symptom
if it goes missing is "can't reach the server" while the same URL loads in the phone's
browser; `adb logcat | grep -i cleartext` prints the real error. An instrumented release
test asserts a cleartext request to a local server succeeds.

---

## 8. Notifications & widget

### 8.1 Types

Five types. Each is a user-visible row in Settings → Notifications with its own sound.

| Type | Trigger | Importance | Sound |
|---|---|---|---|
| **Reminder** | A task's derived notification time: `remindAt ?? eventAt - reminderLeadMinutes` | `HIGH` | user-chosen, default from `settings.notificationSound` |
| **Due now** | `dueReminders` contains a task we have not fired this session | `HIGH` | user-chosen |
| **Needs you** | A review/agent task becomes visible | `DEFAULT` | user-chosen, default `none` |
| **Goal ready** | `pendingCelebrations` gains a goal while the app is backgrounded | `DEFAULT` | user-chosen, default `chime` |
| **Sync problem** | Writes stranded by the life-day guard, or `Unreachable` for > 30 min with a non-empty queue | `LOW`, silent, no sound row | silent always |

Notification times are **derived, never read straight from `remindAt`** — port the existing
`lib/schedule.ts` logic. The same window decides what counts as `current`, and an item
leaves it at `eventAt + durationMinutes` whether or not it was completed.

### 8.2 Channel strategy

An Android channel's sound is fixed at creation and the OS owns it from then on,
deliberately — an app cannot take a user's choice back. Sharing channels across sounds is
why the old picker did nothing. So:

- **Channel id = `lifeos-<type>-<soundId>`**, in a channel group `lifeos` per type family.
  `soundId` ∈ `chime · bell · marimba · pulse · alert · none`.
- Create **only the channels in use**: the five defaults at first run, plus one lazily when
  the user picks a new sound for a type.
- On change: create the new channel, post to it from then on, and **delete the old one**.
  Android remembers a deleted channel's user settings if the same id is recreated, which is
  exactly what we want — switching away and back restores what the user had.
- `lifeos-sync` is a single silent `LOW` channel with no sound row.
- **`channelId` belongs on the notification's channel, not smuggled through content.** In
  the old app it was being passed on content, silently dropped, and everything landed on
  the default channel. In Kotlin this is `NotificationCompat.Builder(context, channelId)` —
  the type system makes the old bug unrepresentable, which is one reason the rewrite is
  worth it.
- Each sound row also offers **Android settings ›** →
  `ACTION_CHANNEL_NOTIFICATION_SETTINGS` for that exact channel, because once the OS owns
  the sound, the OS's own screen is the truthful place to change it. Our picker is a
  convenience that creates channels; the system is the authority.
- `POST_NOTIFICATIONS` is requested **in context** — the first time the user is about to
  rely on a reminder (first task with a time, or opening Settings → Notifications), with a
  one-line rationale. Never on first launch. Denied → the in-app pulse and status strip
  still carry everything; Settings shows *"Android is blocking notifications"* with a link
  to app settings.

### 8.3 Sounds

The WAVs are **generated, not hand-made**: `scripts/build-sounds.mjs` renders the same note
tables the web client synthesizes in WebAudio, so "chime" is the same two rising notes
everywhere. They ship in `res/raw/`, committed — a build must not depend on having run the
script. Change a design in `apps/web/src/lib/notify.ts`, re-run, commit the output.

`notificationSound` ids are the contract, not the waveform. `none` = visual only.

### 8.4 Delivery and the once-only rule

```
1. dueReminders contains a task whose id is not in the fired set
2. Fire: OS notification on the right channel + in-app flash/pulse
3. Immediately POST /api/v1/tasks/:id/notified        ← enqueued, exempt from the day guard
4. Keep the task visibly urgent (pulse) until completed or dismissed
```

Guard in-process too (a set of fired ids), because a recomposition racing the POST is the
common bug. Prefer **`AlarmManager` exact alarms seeded from the derived time** so a
backgrounded or killed app still fires, and still POST `/notified` when next reachable, or
the web client chimes again. Re-seed on every poll, on boot (`BOOT_COMPLETED`), and on
timezone change.

Under DND or quiet hours (`doNotDisturb`, or `quietHoursSilent` inside the window — which
**wraps past midnight**; port `isWithinQuietHours()` rather than hand-rolling the
comparison): post nothing, flash nothing, **still POST `/notified`**, keep the item visible
and pulsing, and show the silenced line in the status strip. Skipping `/notified` while
silenced means every suppressed reminder fires the instant DND ends — an avalanche, which is
worse than the interruption being avoided.

Never let the visual channel depend on audio succeeding.

**Taps** go through one handler that reads both the cold-start intent and the live
subscription — the listener alone misses the cold start, which is the common case, since the
notification is why the app is opening. A reminder tap opens Today with that row's sheet
expanded; a Needs-you tap opens Day; a Goal-ready tap opens the celebration. Actions on the
notification itself: **Done** (enqueues the complete, works offline) and **Snooze 10m** for
Reminder/Due-now only.

### 8.5 Widget

Glance (`androidx.glance.appwidget`) — one widget, three size tiers, updated by the same
`WorkManager` sync, reading the same Room snapshot. It never fetches on its own and it
renders instantly from cache.

```
 ≥ 4×2 (tall)                      2×2 (small)
┌────────────────────────────┐    ┌──────────────┐
│  ╭───╮   69%               │    │ ╭───╮  69%   │
│  │🌱 │   138/200 XP        │    │ │🌱 │        │
│  ╰───╯   Improving         │    │ ╰───╯        │
│  ░░▓▓▓│▒▒░░░░░░░░░░░░░     │    │ 21:30 Read ✓ │
│  21:30  Read 20 pages   ✓  │    └──────────────┘
│  Deep Work   Study   Life  │
└────────────────────────────┘
```

- **Shows:** the growth meter (with its ghosted 100% ring — the contract holds here too),
  `efficiencyPct`, `dailyXp/target`, the pulse word, the ribbon with the now-marker, the
  next one or two agenda items with a tap-to-complete target, and up to three manual
  activity chips. A small hollow dot replaces the pulse word when the cache is stale.
- **Does not show:** goals, charts, streaks, lifetime XP, the agent's cards.
- **Tapping a tick** enqueues the write through the same queue (so it works with the app
  closed and the server asleep) and updates the widget immediately from the overlay.
  Activity chips exclude **Sleep** and **Break** — the schedule and the agent set those.
- **Never a fixed dp width for something meant to span.** The launcher hands out a different
  box per device, per cell count, and again after every resize. Spanning elements use
  `fillMaxWidth()` or weight (`Row { Box(weight=fill); Box(weight=1-fill) }`), never a
  computed pixel width. Both render paths must forward the real dp box, and the tier is
  picked from it: below ~150dp tall, drop the ribbon and the chips rather than clipping them.
- Tapping anywhere else opens Today.

---

## 9. What we are deliberately NOT building

**Removed from the old app:**

1. **"Web app accent."** The app does not configure the website. `settings.accentTheme`
   remains a server setting that drives `apps/web`; this app neither reads nor writes it.
   The device-local palette is the app's theme, full stop. Same API, different product
   surface.
2. **Server/agent configuration of any kind in app settings:** storage mode, Supabase URL,
   webhook URL and secret, backup interval/retention, the XP pool
   (`PATCH /gamification/config`), goal conditions, habit weights. These belong to the agent
   and to the machine.
3. **The Analytics tab.** Folded into You. The same four numbers were being shown twice.
4. **The Goals tab.** Folded into You.
5. **The Settings tab slot.** Settings is a leaf, not a destination.
6. **Swipe-to-change-tab.** Three destinations, a navigation bar, predictive back.
7. **The travelling navigation pill**, and animated chrome generally. (§5.4)
8. **A habits screen / habits tab.** It made the screen you actually look at the poorer of
   two views of the same habits. The agenda card *is* that screen.
9. **`totalXp` as a headline**, `improvementPct` on Today, `vsYesterday` tiles on Today, and
   the day-graphic style picker on Today. All one tap deep or in Settings.
10. **Per-row stale/sync spinners, "Syncing…" banners, and a snackbar per write.**

**Never building, per the product:**

11. Levels, ranks, badges-as-status, leaderboards, friends, sharing, or any other person.
12. A goal-creation or goal-editing UI. A habit-creation UI. A task-scheduling UI. Nothing
    that moves the designing work back onto the user — that is the executive-function tax
    this product exists to remove.
13. Streak shaming: no red, no broken-heart iconography, no "you lost 12 days", no history
    deletion.
14. A light theme, a `DayNight` parent, or `forceDark`.
15. Telemetry, analytics, or crash reporting that leaves the device. No Firebase, no
    Crashlytics, no Sentry, no Play Services dependency beyond on-device ML Kit barcode.
16. Writes to the user's Obsidian vault. Life OS never touches it.
17. Auto-dismissing celebrations, dismiss-on-scrim, or `celebration-seen` on render.
18. Invented activity tags. The seven buckets are a closed set the ribbon and every
    aggregate depend on.
19. Network scanning or mDNS discovery for the server. Ask for the address, or scan the QR.
20. A Start button on anything the agent scheduled. There is no start.
21. A username/password screen, anywhere. `POST /auth/login` is `410`.
22. Google/Play sign-in, accounts, or cloud sync of any kind.
23. A protocol-1 compatibility layer. A client that is too old gets told, clearly. (§7.7)
24. A month/week calendar grid. The ribbon and four day buckets are the whole temporal UI.

---

## 10. Open questions

Each has an assumption recorded so implementation is not blocked.

1. **The three extra day-graphic styles.** The old app shipped five (`bloom`,
   `constellation`, `ascent` on top of the API's `sprout`/`orb`), each with its own
   "arrival" state. **Assumption:** v1 ships `sprout` and `orb` — they are the API contract
   and `growthStyle` comes from the server — and `bloom`/`constellation`/`ascent` are ported
   in a follow-up as a device-local override. They are postponed, not cut. Confirm the
   order; if `bloom` is the identity of the product, it moves into v1 instead of `orb`.
2. **Palette as the brand, or per-palette art?** §6.2 forbids a theme changing anything but
   colour, which means the sprout is the same plant in all eight palettes.
   **Assumption:** correct as specified. If a theme is meant to change the *scene*, that is
   a "visual style" concept distinct from a palette and needs its own name and spec.
3. **Does Needs-you deserve a badge on the Day navigation item?** It is the only candidate
   for a nav badge, and badges are animated attention-grabbers at the bottom edge.
   **Assumption:** no badge; the count link on Today carries it. Reconsider if a standing
   queue means Day is never visited.
4. **Should the status strip surface `lan: false` proactively?** It is the single most
   common reason a phone cannot connect. **Assumption:** only in `server`'s Test results
   and Settings → Connection, not as a strip — it is a server configuration issue, not a
   state of this app.
5. **Snooze on reminders.** Not an API concept; the server owns reminder timing. A local
   10-minute re-alarm would not be reflected in `notifiedAt` or visible to the web client.
   **Assumption:** ship Snooze as a purely local re-alarm, with `/notified` already posted.
   Flag it if divergence between clients is unacceptable.
6. **Phone landscape.** The old app was portrait-locked to protect a layout that could not
   cope. **Assumption:** unlock it and lay out correctly (Compact landscape = one column,
   shorter meter). If this proves fragile, lock Compact to portrait again — but lock it
   because it is a decision, not because of a bug.
7. **Stranded-write recovery.** The guard drops writes across a life-day boundary rather
   than re-dating them. **Assumption:** drop with a one-time, inspectable notice. If losing
   a late-night habit tick is unacceptable, the right fix is a server-side
   `completedForDate` parameter — an API change, not a client workaround.
8. **Widget tick target size.** Launcher cells are small and a mis-tap completes a habit.
   **Assumption:** the widget's tick needs a 48dp target and is only shown on tiers where
   that fits; on the smallest tier the row opens the app instead of completing.
