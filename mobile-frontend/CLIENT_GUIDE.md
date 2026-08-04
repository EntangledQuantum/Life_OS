# Building another Life OS client

**Audience: an agent or developer building a second frontend** — a native mobile
app, a desktop widget, a watch complication, a TUI, a browser extension. Anything
that is not `apps/web` but should show the same life.

The existing React app is *a* client, not *the* client. Everything it renders
comes from the same public HTTP API you are about to call. There is no private
channel and no server-side rendering — if the web app can show it, you can.

Read this end to end before writing code. The last two sections
([Contracts you must not break](#contracts-you-must-not-break) and
[What not to build](#what-not-to-build)) are the ones that will bite you.

| | |
|--|--|
| API surface | [`docs/API.md`](../docs/API.md) |
| Agent-side behaviour | [`docs/skills/life-os/SKILL.md`](../docs/skills/life-os/SKILL.md) |
| Reaching it off-machine | [`docs/NETWORK.md`](../docs/NETWORK.md) |
| Data model | [`docs/DATABASE.md`](../docs/DATABASE.md) |
| Reference implementation | `apps/web/src/` |

---

## 1. Connect

### Find the server

Life OS runs on the user's own machine. There is no hosted instance and no
service discovery — **ask the user for the address**, then verify:

```http
GET http://<host>:8787/health
→ {"ok":true,"service":"life-os-api","storage":"local","host":"0.0.0.0","lan":true}
```

`lan: true` means the API is bound to all interfaces and is reachable from other
devices. If it comes back `false` (or the request times out from another
machine), the user needs `API_HOST=0.0.0.0` — point them at
[`docs/NETWORK.md`](../docs/NETWORK.md) rather than trying to fix it yourself.

Default port `8787`. Do not scan the network looking for it.

### Authenticate

**One credential: the API token.** There is no username/password login and no
session cookie. `POST /api/v1/auth/login` used to exist and now returns `410` —
it checked values that defaulted to `admin` / `lifeos` and were printed in the
README, so it kept nobody out.

```http
Authorization: Bearer <API_TOKEN>
```

`API_TOKEN` comes from the user's Life OS `.env`. Your client's job is to ask
for it once and keep it:

```
1. First run → a "paste your API token" screen (and the server address)
2. Validate it:  GET /api/v1/auth/me   → 200 means good, 401 means wrong token
3. Store it in the platform secure store
4. Send it on every request from then on
```

Store it in **Keychain / Keystore / EncryptedSharedPreferences** — never in
plain preferences, never in `AsyncStorage` unencrypted, and never in a log line
or a crash report. Treat a `401` as "the token is wrong or was rotated": clear
it and show the entry screen again. Do not retry in a loop.

Every `/api/v1/*` route requires it, including `auth/me`.

### CORS, if you are a web client

Loopback and private-LAN origins are allowed automatically on any port. A public
origin has to be listed in the user's `CORS_ORIGINS`. Native clients are
unaffected — CORS is a browser concept.

---

## 2. The one call

```http
GET /api/v1/dashboard/today
```

This is the primary read and it is designed to be the *only* one you need on a
main screen. It returns the entire day in a single payload. Do not stitch it
together from a dozen smaller endpoints — you will get a torn view where the XP
total disagrees with the habit list.

```jsonc
{
  "date": "2026-08-03",              // the life-day, not the calendar day
  "dayResetTime": "04:00",

  "progress": {
    "totalXp": 730,                  // lifetime; rarely worth showing
    "dailyXp": 138,
    "dailyXpTarget": 200,
    "efficiencyPct": 69,             // can exceed 100 — that is intentional
    "improvementPct": 12.5,          // percentage POINTS vs yesterday
    "yesterdayEfficiencyPct": 56.5,
    "lastImprovementPulse": "Improving",
    "growthStyle": "sprout"          // "sprout" | "orb"
  },
  "pulse": "Improving",
  "pulseExplanation": "Consistency and output are trending up vs recent days.",

  "vsYesterday": {                   // each: { today, yesterday, delta }
    "habitsCompleted": {…}, "xpEarned": {…}, "studyMinutes": {…},
    "sleepScore": {…}, "efficiency": {…}
  },

  "habits": [ /* HabitWithToday — see §3.4 */ ],

  "cards": [ /* pinned: slots 0, 1, and the agent-setup card at 2 */ ],
  "upcoming": [ /* scheduled cards due within 15 min, overdue, or pinged */ ],
  "scheduled": [ /* every visible scheduled card — your timeline screen */ ],
  "dueReminders": [ /* reminders that should chime RIGHT NOW */ ],

  "pendingCelebrations": [ /* goals met but not yet seen — see §4.2 */ ],
  "properties": [ /* agent-defined counters */ ],
  "goals": [ … ],

  "timeline": [ /* continuous 0–24h segments — see §3.5 */ ],
  "studyBlocks": [ … ], "studySessions": [ … ],
  "agentEvents": [ … ], "lightReviews": [ … ], "quests": [ … ],
  "achievements": [ … ],
  "consistency7": [ { "date": "2026-08-01", "pct": 66 }, … ],
  "xpSeries7":   [ { "date": "2026-08-01", "current": 130, "target": 200 }, … ],
  "activeSession": { "activity": "Study", "startedAt": "…", "blockId": "…" } | null
}
```

Types for every field live in `packages/shared/src/types.ts`. If you are writing
TypeScript, import them instead of redeclaring:

```ts
import type { DashboardToday, HabitWithToday, DashboardCard } from "@life-os/shared";
```

For other languages, generate from that file rather than hand-copying — it is the
single source of truth and it moves.

---

## 3. What to render

Parity means showing the same *information*, not cloning the layout. A phone
should look like a phone. This section is what each piece means so you can decide
how to present it.

### 3.1 The pulse header

`pulse` is one of `Improving` · `Stable` · `Recovering` · `Drifting`, with
`pulseExplanation` as a human sentence. It is the emotional headline of the
screen — big, coloured, and never accompanied by a number that contradicts it.

Suggested colours: Improving `#34D399`, Recovering `#FBBF24`, Drifting `#94A3B8`,
Stable = the accent colour.

Alongside it: `efficiencyPct`, `improvementPct` (signed, as **percentage
points**, not a ratio), and `dailyXp / dailyXpTarget`.

### 3.2 Today vs yesterday

Five figures from `vsYesterday`: habits, XP, efficiency, study minutes, sleep.
Show `today` large and `delta` small and signed. Colour positive deltas green,
negative grey — **never red**. A bad day is not an error state, and this is an
app for people who already punish themselves enough.

### 3.3 Agent cards

`cards` holds the pinned ones. Slots `0` and `1` are content; slot `2` is the
agent-setup card, which should render as a slim status strip rather than a full
card (it is metadata about the connection, not a task).

Each card may carry `emoji`, `themeColor`, `imageUrl`, `imageData`, and `svg`.

> **Rendering `svg` safely.** The markup is sanitized server-side, but treat it
> as untrusted anyway. In a browser, render it through an `<img>` with a data
> URI — never `innerHTML`, never `dangerouslySetInnerHTML`. On native, render it
> in a sandboxed SVG view with remote loading disabled. Helper:
> `svgToDataUri()` in `packages/shared/src/svg.ts`.

`ctaLabel` / `ctaLink` are an optional button. `progress` is 0–100.
`POST /api/v1/cards/:id/complete` awards `xpOnComplete` and fires the user's
webhook.

### 3.4 Habits

Each habit in `habits` is a `HabitWithToday`:

| Field | Use |
|-------|-----|
| `emoji`, `name`, `themeColor` | Identity |
| `completedToday` | Drives the tap target: check → complete, undo → revert |
| `currentStreak`, `longestStreak` | Streaks, if `settings.streaksEnabled` |
| `history7` | Seven booleans, oldest first — a tiny bar strip |
| `baseXp`, `extraXp` | What completing it is worth |
| `anchor` | "after I sit at my desk" — surface it, it is why the habit sticks |

Completing: `POST /api/v1/habits/:id/complete`. Status codes matter:

- `200` — done, response has `xpAwarded` and `streakRecovered`
- `404` — no such habit
- **`409` — already completed today. This is not an error.** Treat it as
  success-with-no-op. Do not show a failure toast and do not retry.

Undo: `POST /api/v1/habits/:id/undo`.

### 3.5 The day timeline

`timeline` is pre-computed for you: a continuous, gap-free list of 0–24h
segments, already overlap-resolved and colour-assigned server-side.

```jsonc
[ { "id": "…", "category": "Study", "label": "Retrieval session",
    "startHour": 9.5, "endHour": 11, "color": "#C084FC", "status": "planned" } ]
```

Render as a horizontal ribbon: `left = startHour / 24`, `width = (endHour −
startHour) / 24`. Overdraw each segment by a hair (≈0.2px) or you will get
visible subpixel seams between neighbours. Dim `status: "done"` to ~55% opacity.
Draw a "now" marker at `(currentHour + minutes/60) / 24`.

Do **not** recompute the layout from `studyBlocks` — the server already closed
the gaps and resolved the overlaps, and re-deriving it is how the two clients
start disagreeing about what the day looks like.

### 3.6 The growth meter

The signature visual: today's progress as something alive.
`progress.growthStyle` is `sprout` (a plant that grows leaf by leaf, blooming at
100%) or `orb` (a sphere filling with light).

**The non-negotiable part: always draw the 100% state ghosted behind the live
state.** The gap between where you are and what a full day looks like has to be
visible at a glance. A bar that is merely 40% full does not communicate that; a
half-grown plant next to the ghost of a full one does.

Reference: `apps/web/src/components/graphics/GrowthMeter.tsx`. The sprout reveals
leaves at these fractions of `efficiencyPct / 100`:

```
0.16  0.32  0.46  0.62  0.78  0.90        → bloom + glow at 1.0
```

If a full custom visual is out of scope for your platform, a progress arc with a
ghosted full-ring behind it satisfies the same contract. A plain determinate
progress bar does not.

Below it: `Math.round(efficiencyPct)%`, `dailyXp / dailyXpTarget XP`, and the
remainder to go.

### 3.7 Quick log

`agentEvents` (status `pending`) and `lightReviews` (no `completedAt`) are work
the agent has queued. They should **pulse or otherwise demand attention until
completed** — that is the point of them.

The web client hides habits from this list while any agent item is open, so the
user faces one decision at a time. Copy that if your layout allows; it is a
deliberate ADHD affordance, not a quirk.

- `POST /api/v1/events/:id/complete` — awards `xpOnComplete`
- `POST /api/v1/events/:id/dismiss` — no XP
- `POST /api/v1/reviews/:id/complete`

### 3.8 Up next, and the timeline screen

Two different things, deliberately:

| Source | Shows | Where |
|--------|-------|-------|
| `upcoming` | Only the **next 15 minutes**, plus anything overdue or already pinged | Main screen, compact list |
| `scheduled` | Everything the agent has queued | A separate timeline/calendar screen |

Keep the split. The main screen answers "what am I doing *now*" — a card three
hours out is planning, not doing, and merging them turns the dashboard back into
a to-do list.

Per row: `emoji`, `title`, `activityTag`, the `eventAt` clock time plus a
relative "in 12m", `durationMinutes`, a repeat badge when `repeatRule !== "none"`,
and a bell with `remindAt`.

**`xpOnComplete` is a reward indicator, not a button.** Render it as green
`+25 XP` text. The action set is: `Start` (a real button, only for
`kind: "event"` that is not already running) and a small complete affordance.
Two competing primary buttons on a row is the exact mistake to avoid.

- `POST /api/v1/cards/:id/start` — creates a timeline block under the card's
  `activityTag` and makes it the running session
- `POST /api/v1/cards/:id/complete` — done; returns `nextOccurrence` if repeating

For grouping on the timeline screen: bucket by the local day of
`eventAt ?? remindAt ?? showAt`, label Today / Tomorrow / weekday, and give
cards with no time at all their own bucket rather than dropping them.

### 3.9 Right now

`activeSession` is the running timer: `{ activity, startedAt, blockId }`. Tick a
`HH:MM:SS` elapsed counter locally from `startedAt` — do not poll for it.

The activity switcher offers the seven day buckets:

```
Deep Work · Study · Sleep · Exercise · Break · Life Admin · Exploration
```

`POST /api/v1/session/active { activity }` · `DELETE /api/v1/session/active`.

### 3.10 Charts

`xpSeries7` gives `{ date, current, target }` — an area for current with a dashed
line for target. `consistency7` gives `{ date, pct }`. Both are seven days,
oldest first, already aggregated. `GET /api/v1/analytics` adds per-category
completion and pulse history if you want a dedicated screen.

### 3.11 Goals

Read-only, and that is a product decision, not an omission. **Do not build a
"create goal" form.** Goals are set by the user's agent; deciding what to want is
exactly the executive-function tax this app exists to remove.

Show `emoji`, `title`, `whyItMatters`, `progressPct`, and `conditionDetail` — an
array of human-readable lines like `books_read = 2 (needs >= 3)` explaining
exactly what is being watched.

`properties` are the agent's own counters (`{ key, label, value, unit, uid }`).
A small stats panel is a nice touch.

---

## 4. Contracts you must not break

Everything above is guidance. These five are behavioural contracts. Break them
and your client is wrong, however good it looks.

### 4.1 The life-day is not the calendar day

`dayResetTime` (default `04:00`) is when the day rolls over. A study session at
01:00 belongs to the **previous** day. Never use midnight, never use
`new Date().toDateString()` for "today".

The server does this for you in every aggregate it returns. Where you must do it
yourself, port `getDayBounds()` from `packages/shared/src/xp.ts` — do not
reimplement it from the description.

### 4.2 A goal is not finished until the user has *seen* it finish

This is the one most likely to be quietly skipped, so:

1. `pendingCelebrations` holds goals whose condition is true but whose
   celebration nobody has watched.
2. **You must show a real celebration** — full-screen, unmissable, the one moment
   this app is allowed to be loud.
3. Only after the user actively dismisses it do you call
   `POST /api/v1/goals/:id/celebration-seen`.
4. That call is the *only* thing that moves a goal to `status: "achieved"`.

Do not call it on render. Do not call it to "clear the queue". Do not
auto-dismiss on a timer. If the user closes the app instead, the celebration is
waiting next time, and that is correct.

Several goals can land at once — queue them and play one at a time.

### 4.3 Reminders fire once, and the server decides when

`dueReminders` is the server's answer to "what should chime now". Your job is
only *how* it lands.

```
1. dueReminders contains a card you have not fired in this session
2. Fire: sound (if card.sound), visual flash (if card.flash), OS notification
3. Immediately POST /api/v1/cards/:id/notified
4. Keep the card visibly urgent until it is completed or dismissed
```

Step 3 is what stops a refresh, a second device, or a background refetch from
replaying the same chime. Step 4 matters because being *told* about a thing is
not the same as *doing* it — the alert is transient, the urgency is not.

Guard against double-firing within your own process too (a set of fired ids); a
re-render racing the POST is the common bug.

On mobile, prefer the platform's local-notification scheduler seeded from
`remindAt`, so a backgrounded app still fires — but still POST `/notified` when
you next reach the server, or the web client will chime again.

Never let the visual channel depend on audio succeeding. Audio is blocked by
default in browsers until a gesture, and silenced by a hardware switch on phones.

### 4.4 The XP model

- The daily pool (`dailyXpTarget`) is **fixed**. Adding habits re-slices it, it
  does not grow it.
- `efficiencyPct` **can exceed 100** via bonus XP. Do not clamp the number — clamp
  the fill visual if you must, but show the real figure.
- **There are no levels, no ranks, no leaderboards, and no other people.** The
  only comparison this product makes is you versus yesterday.
- Only the agent changes the pool, via `PATCH /api/v1/gamification/config`.

Full rules, machine-readable: `GET /api/v1/agent/xp-model`.

### 4.5 Respect the user's settings

`GET /api/v1/settings` is not decoration:

| Setting | What it obliges you to do |
|---------|---------------------------|
| `reducedMotion` | Disable animations. Also honour the OS-level flag. |
| `celebrationIntensity` | `off` = no confetti at all; `minimal` = restrained |
| `accentTheme` | `nebula` 224 · `quantum` 296 · `terminal` 150 · `ember` 38 (OKLCH hue) |
| `gamificationEnabled`, `pointsEnabled`, `streaksEnabled`, `achievementsEnabled`, `questsEnabled` | Hide those surfaces when false |
| `notificationSound` | Which chime to play — see below |
| `doNotDisturb` | Silence reminders without hiding them |
| `quietHoursSilent` + `quietHoursStart` / `quietHoursEnd` | Automatic do-not-disturb window |

### Sounds and do-not-disturb

`notificationSound` is one of `chime` · `bell` · `marimba` · `pulse` · `alert` ·
`none`. The web client synthesizes these; **a native client should map the ids
onto platform system sounds instead** — the id is the contract, not the
waveform. `none` means visual only.

Do-not-disturb — manual (`doNotDisturb`) or scheduled (`quietHoursSilent` inside
the quiet-hours window) — **suppresses the interruption, not the information**:

```
silent → no sound, no flash, no system notification
       → the card still appears and still pulses
       → you STILL POST /notified
```

That last line is the one to get right. Skipping `/notified` while silenced
means every suppressed reminder fires the instant do-not-disturb ends — a
notification avalanche, which is worse than the interruption the user was
avoiding. Mark it delivered, keep it visible, and let them find it when they
look.

Quiet hours can wrap past midnight (the default is 03:30–10:30). Port
`isWithinQuietHours()` from `packages/shared/src/schedule.ts` rather than writing
your own comparison — the wrapping case is where hand-rolled versions break.

Make the silence **visible**: the web client shows a `DND` chip in the header.
Without it, a missed reminder reads as a broken app rather than a setting the
user chose.

---

## 5. Writes you will need

```http
POST   /api/v1/habits/:id/complete      { source: "user" }   200 / 404 / 409
POST   /api/v1/habits/:id/undo
POST   /api/v1/cards/:id/complete       { source: "user" }
POST   /api/v1/cards/:id/start
POST   /api/v1/cards/:id/notified
POST   /api/v1/events/:id/complete
POST   /api/v1/events/:id/dismiss
POST   /api/v1/reviews/:id/complete
POST   /api/v1/goals/:id/celebration-seen
POST   /api/v1/session/active           { activity }
DELETE /api/v1/session/active
POST   /api/v1/blocks/:id/start
POST   /api/v1/blocks/:id/complete
POST   /api/v1/study                    { title, durationMinutes, qualityFlag }
PATCH  /api/v1/settings                 { … }
```

Set `source: "user"` on anything the human actually did. It is how the user's
agent tells their own actions apart from the person's, and getting it wrong
corrupts the signal the agent plans from.

Study quality flags: `normal` · `struggle` · `inspired` · `feynman` ·
`retrieval`. The last three carry XP multipliers and mark the session as worth
escalating, so offer them — they are not cosmetic.

**Anything else — creating habits, writing goals, scheduling cards, changing the
XP pool — belongs to the agent, not to your UI.** See
[What not to build](#what-not-to-build).

---

## 6. Freshness and failure

Poll `dashboard/today` every **8–15 seconds** while the main screen is visible.
The web client uses 8s. On mobile, back off when backgrounded and refetch on
resume; there is no push channel.

`dueReminders` needs the tighter end of that range to feel responsive. Everything
else can be lazier.

After any write, refetch rather than patching local state by hand. One write can
change several unrelated things at once — completing a card can award XP, move
efficiency, flip the pulse, schedule the next spaced occurrence, *and* complete a
goal. Reconstructing that client-side will drift.

Failure modes worth handling distinctly:

| Situation | Do |
|-----------|-----|
| Connection refused / timeout | "Life OS isn't running" — this is normal, not a crash. Offer retry. |
| `401` | Token expired or wrong. Re-auth; do not retry in a loop. |
| `409` on habit complete | Already done today. Silent no-op. |
| `400` | Your request was wrong. The body's `error` string is written to be shown; surface it. |
| `5xx` | Retry once with backoff, then surface it. |

Cache the last good `dashboard/today` and render it read-only when offline, with
a clear stale indicator. Do not queue writes for later replay unless you also
handle the life-day boundary — a habit completion replayed after 04:00 lands on
the wrong day and silently corrupts a streak.

---

## 7. Design tokens

Match these and it will feel like the same product:

```
background     oklch(7% 0.01 260)         near-black, slightly blue
surface        oklch(12.5% 0.014 260)
surface-2      oklch(17.5% 0.014 260)
border         rgba(255,255,255,0.06)
text           oklch(97% 0.005 260)
muted          oklch(68% 0.012 260)
faint          oklch(46% 0.01 260)
accent         oklch(76% 0.17 <hue>)      hue from settings.accentTheme

positive       #34D399     warning   #FBBF24     neutral-negative  #94A3B8
```

Type: **Figtree** for UI, **JetBrains Mono** for every number, time, and ID.
Numbers are tabular and monospaced throughout; it stops figures jittering as they
tick. Dark surface only — there is no light theme.

The icon is `apps/web/src/assets/icon.png`.

---

## 8. What not to build

Some of these are product decisions with real reasons behind them. Adding them
back would not be an improvement.

- **No levels, ranks, badges-as-status, leaderboards, or any other person.**
- **No goal-creation UI.** Goals come from the agent. (§3.11)
- **No streak shaming.** A broken streak is recoverable and the history is never
  deleted. Never colour a bad day red.
- **No writes to the user's Obsidian vault.** Life OS never touches it; their
  agent escalates what deserves keeping. Your client is not the exception.
- **No telemetry, analytics, or crash reporting that leaves the device.** This is
  a local-first app whose entire pitch is that nothing is watching. Adding a
  third-party SDK breaks that promise silently.
- **Do not auto-dismiss celebrations.** (§4.2)
- **Do not invent activity tags.** The seven buckets are a closed set; the
  timeline and every daily aggregate depend on it.

---

## 9. Before you call it done

- [ ] Health check, and a clear message when the server is unreachable
- [ ] Token-only auth — no username/password screen anywhere
- [ ] Token stored in the platform secure store, never logged
- [ ] `401` clears the stored token and returns to the entry screen
- [ ] Life-day boundary respected everywhere (never midnight)
- [ ] Habit complete handles `409` as success
- [ ] `source: "user"` on every human action
- [ ] Growth meter draws the ghosted 100% state behind the live one
- [ ] Timeline rendered from `timeline`, not recomputed from blocks
- [ ] `upcoming` (15 min) and `scheduled` (everything) shown separately
- [ ] `xpOnComplete` renders as a green indicator, not a button
- [ ] Reminders fire once, POST `/notified`, and stay urgent until dealt with
- [ ] `doNotDisturb` and quiet hours silence the alert but still mark it notified
- [ ] Silence is visible in the UI, so it doesn't look like a bug
- [ ] Celebration is unmissable and `celebration-seen` fires only after real dismissal
- [ ] `reducedMotion` and `celebrationIntensity` honoured
- [ ] `efficiencyPct` above 100 displays correctly
- [ ] Agent SVG rendered sandboxed, never as raw markup
- [ ] Offline shows cached data, clearly marked stale
- [ ] No levels, no leaderboards, no red for a bad day

---

Reference implementation: `apps/web/src/pages/OverviewPage.tsx` and
`TimelinePage.tsx`, with the contracts in `apps/web/src/components/ReminderRunner.tsx`
and `GoalCelebration.tsx`. When this guide and the running code disagree, the
code wins — and please update this file.
