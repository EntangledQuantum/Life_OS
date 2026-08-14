# Life OS HTTP API

Base URL: `http://127.0.0.1:8787`

Auth: `Authorization: Bearer <API_TOKEN>` on every `/api/v1/*` route. That is the only
credential — there is no username/password login and no session cookie. `API_TOKEN` lives in
the Life OS `.env`; change it from the default before exposing the API to your network.

Reaching it from a phone or another machine on your network: see
[`docs/NETWORK.md`](NETWORK.md). Loopback and private-LAN origins are allowed by CORS on any
port; public origins must be listed in `CORS_ORIGINS`.

**Building a second frontend** (mobile app, widget, TUI)? Start with
[`mobile-frontend/CLIENT_GUIDE.md`](../mobile-frontend/CLIENT_GUIDE.md) — this file is the
endpoint reference, that one is what to render and which behaviours are contracts rather than
styling. Everything platform-specific lives under `mobile-frontend/`.

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Health check — returns `{ok, service, storage, host, lan}` |
| POST | `/api/v1/auth/login` · `/logout` | **Removed.** Returns `410` — password login no longer exists |
| GET | `/api/v1/auth/me` | Validate the token you are holding |
| GET | `/api/v1/habits` | List habits |
| POST | `/api/v1/habits` | Create habit |
| PATCH | `/api/v1/habits/:id` | Update |
| DELETE | `/api/v1/habits/:id` | Soft delete |
| POST | `/api/v1/habits/:id/complete` | Complete today — `200` ok · `404` unknown · `409` already done |
| POST | `/api/v1/habits/:id/undo` | Undo today's completion |
| PATCH | `/api/v1/habits/:id/theme` | Theme |
| POST | `/api/v1/habits/rebalance-xp` | Redistribute the daily XP pool by weight |
| GET/POST | `/api/v1/study` | List / log study |
| GET/POST | `/api/v1/goals` | List / create goals (create takes a `condition`) |
| PATCH/DELETE | `/api/v1/goals/:id` | Update / delete |
| GET | `/api/v1/goals/pending-celebration` | Goals met but not yet seen by the user |
| POST | `/api/v1/goals/:id/celebration-seen` | The only path to `status: "achieved"` |
| POST | `/api/v1/goals/evaluate` | Force a goal re-check |
| GET/POST | `/api/v1/properties` | List / define agent counters |
| GET/PATCH/DELETE | `/api/v1/properties/:key` | Read / set / delete a counter |
| POST | `/api/v1/properties/:key/increment` | `{ by }` — auto-defines unknown keys |
| GET | `/api/v1/dashboard/today` | Full dashboard (primary read) |
| GET | `/api/v1/dashboard/vs-yesterday` | Deltas |
| GET | `/api/v1/dashboard/pulse` | Pulse |
| GET | `/api/v1/analytics?range=` | Analytics over `7d` \| `30d` \| `90d` \| `all` |
| GET/POST/DELETE | `/api/v1/session/active` | What you are doing right now — set by hand, never by a task |
| GET/POST | `/api/v1/quests` | Quests |
| GET/POST | `/api/v1/achievements` | Achievements |
| GET/PATCH | `/api/v1/settings` | Settings incl. `dayResetTime`, notification sound, do-not-disturb, agent webhook, backups |
| GET/PATCH | `/api/v1/gamification/config` | `dailyXpTarget`, `growthStyle`, multipliers |
| GET/POST | `/api/v1/backups` | List snapshots / snapshot now |
| POST | `/api/v1/pair` | Mint a single-use pairing code for the QR |
| GET | `/api/v1/pair/reachability` | Every address this instance answers on |
| POST | `/api/v1/pair/claim` | **Unauthenticated.** Trade a code for the token |
| GET | `/api/v1/export/json` | Full export |
| GET | `/api/v1/agent/capabilities` | Task kinds, activity tags, repeat rules, tools |
| GET | `/api/v1/agent/goal-syntax` | Condition language + worked examples |
| POST | `/api/v1/agent/setup` | Reshape a fresh instance in one call |
| GET | `/api/v1/agent/xp-model` | XP rules + this user's live shares |

**Every successful non-`GET` request re-checks every goal condition.** That is the contract:
any change to the database can complete a goal, whichever endpoint made it.

---

## Tasks

There are **two nouns in Life OS: habits and tasks.** Nothing else.

Before this there were four tables that behaved almost but not quite alike —
`dashboard_cards` (scheduled events and reminders), `agent_events` (queued work),
`light_reviews` (prompts) and `schedule_blocks` (study). They differed in which fields they
supported, not in what they meant, so an agent had to pick one and live with whatever that one
happened not to offer. Users saw the seams: *"a card to complete, but also a session?"*

A task is one thing with optional parts. Every part below is nullable, and any combination is
valid.

```json
POST /api/v1/tasks
{
  "kind": "study",
  "title": "Read one chapter",
  "subtitle": "Project Hail Mary · ch. 12",
  "body": "Read it once for shape, then again with a pen.",
  "purpose": "Spaced-repetition reading block",
  "activityTag": "Study",
  "showAt":   "2026-08-04T17:00:00Z",
  "eventAt":  "2026-08-04T19:00:00Z",
  "durationMinutes": 60,
  "repeatRule": "spaced",
  "resources": [
    { "label": "Chapter 12 PDF", "url": "https://…", "kind": "paper" }
  ],
  "xpOnComplete": 25,
  "webhookOnComplete": true
}
```

| Field | Notes |
|-------|-------|
| `kind` | `task` (default) · `study` · `review` · `reminder`. Presentation and grouping only — every kind behaves identically |
| `eventAt` / `durationMinutes` | When it should happen and how long it should take. Optional; a task with no time is just a thing to do |
| `remindAt` | **Optional override.** Normally derived — see below. Must satisfy `showAt <= remindAt < eventAt` |
| `repeatRule` | `none` · `daily` · `weekly` · `spaced` |
| `resources` | Links the agent attached — chapters, papers, videos. This is what a "study block" always was underneath |
| `slot` | `0`, `1` or `null`. Two content slots; a pinned task is drawn as a card on the front page |
| `control` | One interactive widget — a slider or a button. See *Card controls* |
| `svg` | Inline SVG markup — sanitized on write, rendered sandboxed |
| `xpOnComplete` | Bonus XP outside the habit pool |

### Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v1/tasks?status=&kind=` | Every visible task, filtered |
| GET | `/api/v1/tasks/current` | Inside the lead window and not past its own end |
| GET | `/api/v1/tasks/due` | Notifications that should fire now |
| POST | `/api/v1/tasks` | Create |
| GET/PATCH/DELETE | `/api/v1/tasks/:id` | Read / update / delete |
| POST | `/api/v1/tasks/:id/complete` | XP + study session (if `kind: study`) + webhook + next repeat |
| POST | `/api/v1/tasks/:id/dismiss` | Put it away without doing it. Distinct from done |
| POST | `/api/v1/tasks/:id/notified` | Client confirms the notification fired (fires once) |
| POST | `/api/v1/tasks/:id/interact` | Move a slider or press a button. **Not** a completion |

### Notification times are derived

The effective notify instant is:

```
remindAt  ??  eventAt - reminderLeadMinutes
```

`reminderLeadMinutes` is a setting, default 15. Agents set `eventAt` and expect a warning
beforehand; nothing used to derive that, so a task with only an `eventAt` was never
pre-scheduled on the phone and the only notification anyone ever got was the one fired the
moment they opened the app.

A reminder is due from that instant until the end of the task's own window
(`eventAt + durationMinutes`, or two hours if no duration is given). **It goes stale rather
than staying due forever** — without the upper bound, every past task that was never notified
stays pending and they all fire at once the next time a client polls.

### Where they surface

`dashboard/today` carries `tasks` (everything open), `current` (what is landing now, for Quick
log) and `dueReminders`. Agents can schedule as far ahead as they like without crowding the
dashboard — the rest is on the Timeline tab.

A task leaves Quick log when its own window ends, completed or not. Otherwise every missed
thing piles up on the front page forever, which is the to-do list this app refuses to be.

### There is no start

A task has a target time and a completion. It does not run, it has no timer, and completing it
does **not** change what activity the user is in — that is set by hand from
`/api/v1/session/active` and nothing else writes it. There is no `/tasks/:id/start` and there
will not be one.

### The ordering rule

```
showAt  <=  remindAt  <  eventAt
```

Enforced with `400` and a message naming the violated leg. A reminder that fires at or after
its own event is useless, so it is rejected rather than quietly reordered. `remindAt` without
an `eventAt` is likewise rejected. `PATCH` re-validates the **resulting** schedule, not just
the patched fields — moving `eventAt` earlier can invalidate a stored `remindAt`.

### Activity tags

A closed set: `Deep Work` · `Study` · `Sleep` · `Exercise` · `Break` · `Life Admin` ·
`Exploration`. Anything else is `400`. The tag says which bucket of the day the thing belongs
to, for grouping and colour — it does not make the task take over the timeline.

### Repetition

Completing a repeating task inserts the next occurrence as a **new** row (returned as
`nextOccurrence`) and leaves the completed one in history. Rewinding it in place would make
*"how many times did I actually do this"* unanswerable. `spaced` walks `1, 3, 7, 14, 30, 60`
days by default — override with `repeatOffsetsDays` — preserving the lead times between
`showAt`, `remindAt` and `eventAt`.

This is also how Life OS schedules its own recurring work, instead of an agent re-creating it
every night.

### Card controls

A task can carry one widget the agent owns:

```json
{ "kind": "slider", "label": "Energy", "min": 0, "max": 10, "step": 1, "value": 5, "unit": "/10" }
{ "kind": "button", "label": "Took it" }
```

`POST /tasks/:id/interact` moves it and fires `card.interaction` if the agent subscribed. It is
deliberately **not** a completion: an agent asking *"how did that feel, 1–10"* wants the answer,
not the card gone. Slider values are clamped into `[min, max]` and snapped to `step`, the same
as an `<input type=range>`.

---

## Analytics

`GET /api/v1/analytics?range=7d|30d|90d|all` (default `30d`).

Every series carries its own history, and **where there is a target, the target rides the
same axis as the actual**. A number without its target is not a measurement — the old page
was an XP chart, a list of category percentages and a wall of achievements, which is three
snapshots of *now* on a page whose only reason to exist is "is this getting better or worse".

| Field | What it is |
|-------|------------|
| `daily[]` | Per day: `xp` vs `xpTarget`, `efficiencyPct` vs `efficiencyTarget` (100), habits done vs possible, consistency, study minutes |
| `habits[]` | Per habit: completion rate, current streak, and a day-by-day `history`. Rate is over the days the habit **existed**, not the whole window |
| `adherence` | Scheduled vs completed vs completed-late, overall and per day |
| `study` | Minutes and sessions, overall and per day |
| `properties[]` | Every agent counter, its current value, its change across the window, and its curve |
| `goals[]` | Progress curves toward each goal's condition |

### Where the history comes from

`daily_snapshots` already recorded XP, habits, study and consistency once a day. Agent
properties and goal progress had no past at all — each is a single number overwritten in
place, and "books read: 14" does not answer "am I reading more than I was in June".

Two tables record them now, `property_history` and `goal_progress_history`, written **only
when the value actually changes**. A counter nobody touches costs nothing, and the goal
re-check that runs after every write does not put a row in on every request.

Existing databases get one seeded point each, dated when the value was last touched. It is a
single honest point — "this was the value when history began" — not a fabricated back-story.

---

## Pairing a phone

The token is 43 characters of base64url. Typing that into a phone keyboard is miserable and
people get it wrong, so the setup that actually happens is *email it to myself* — which puts
the only credential this app has into a mailbox forever.

So the dashboard mints a short-lived, single-use **code**, draws it as a QR, and the phone
trades the code for the real token.

```
dashboard  POST /api/v1/pair        → { code, url, expiresInSeconds }
           draws url as a QR
phone      camera opens  <base>/pair#c=CODE
           taps Open in Life OS  →  lifeos://connect?code=…&url=…
app        POST /api/v1/pair/claim  → { baseUrl, token }
```

### Why this is safe with an open claim endpoint

`/pair/claim` takes no auth, and it cannot: a phone that already had the token would not be
pairing. What makes it acceptable is everything about the code.

- **The token is never in the QR.** A short-lived code that burns on first use beats an
  "encrypted" token whose key has to travel alongside it.
- **Single use.** The code is deleted before the token is returned, so a replay finds nothing.
- **Five minutes.** Long enough to walk to the other room.
- **Minted only by an authenticated request** — you have to already be in the dashboard.
- **In the URL fragment, not the query string.** A fragment is never sent to a server, so the
  code stays out of access logs, out of `Referer` headers, and out of every proxy between.
- **Compared in constant time**, and a wrong code is indistinguishable from an expired one.
- **In memory only.** A restart invalidates every outstanding code, which is correct, and it
  keeps the one thing that can be traded for the token out of the database and out of backups.

The alphabet has no `O`/`0` and no `I`/`l`/`1`, because the QR is the happy path but somebody
will end up reading it out loud.

### Which URL the phone is given

In order: the public URL if a tunnel is up, then `PUBLIC_URL`, then the address the minting
request itself arrived on. That last fallback is what makes pairing work with no configuration
— if the browser reached the server at that address, a phone on the same Wi-Fi can too.

A loopback origin is replaced with a LAN address. `127.0.0.1` on a phone *is* the phone, and
someone pairing from `localhost` would otherwise scan a QR pointing at their own handset.

---

## Reaching it from outside

**This machine's own address cannot be a public URL.** It is an RFC1918 address behind NAT and
the router's WAN address is usually dynamic and usually firewalled. A stable public URL needs
one of:

| option | stable across restarts? | needs |
|--------|------------------------|-------|
| **Tailscale Funnel** (default) | **yes** | a free Tailscale account |
| Cloudflare *named* tunnel | yes | your own domain on Cloudflare |
| Cloudflare *quick* tunnel | **no** — rotates every restart | nothing |

Tailscale is the default because it is the only free option whose URL does not change, and a
URL that changes is a phone that stops working every time the machine reboots. It also gives
real HTTPS.

`TUNNEL=tailscale|cloudflare|off`, and `PUBLIC_URL` overrides detection entirely.

**Nothing here starts a tunnel process.** Detecting one that is already running and reporting
it honestly is reliable; owning a long-lived child, restarting it and parsing its log output is
not — and a half-managed tunnel that dies quietly is worse than no tunnel. The boot banner says
what it found, and what to run if it found nothing.

---

## Protocol version

Every `/api/v1/*` request must send:

```
X-LifeOS-Protocol: 2
```

A client that sends an older version — or none, which means it was written before the header
existed — gets `426 Upgrade Required` with a body naming both versions and a download URL.

```json
{
  "error": "This app is too old for this Life OS server",
  "hint": "…",
  "clientProtocol": 1,
  "serverProtocol": 2,
  "minProtocol": 2,
  "downloadUrl": "https://github.com/EntangledQuantum/Life_OS/releases/latest/download/life-os.apk"
}
```

`GET /api/v1/protocol` answers `{protocol, minProtocol}` without auth, so a client can check
before it tries anything.

There is no compatibility layer. Some changes genuinely require a new app — collapsing four
tables into one is one of them — and the choice is between translating the new model back into
the old shapes forever, or saying so once and clearly. A client that is too old should be
*told*, not quietly served a lie about an empty day.

| version | change |
|---------|--------|
| 1 | cards, agent events, light reviews and schedule blocks as separate things |
| 2 | one task system: `tasks` replaces all four |

---

## Goals and conditions

A goal carries a machine-checkable `condition`, re-evaluated after every write.

```json
POST /api/v1/goals
{
  "title": "Read 10 books this year",
  "emoji": "📚",
  "condition": { "type": "property", "key": "books_read", "op": ">=", "value": 10 }
}
```

Node types: `property`, `metric`, `all`, `any`.
Operators: `>=` `>` `<=` `<` `==` `!=`.
Metrics: `total_xp`, `habit_completions`, `habit_streak`, `study_minutes`, `tasks_completed`
(`cards_completed` is the old spelling and still works), `days_active`, over a `window` of `all` | `7d` | `30d` | `90d` | `year`.
Invalid conditions return `400` with **every** problem listed, not just the first.

### Met is not finished

When a condition first evaluates true the goal gets `conditionMetAt` and appears in
`pendingCelebrations`, but its `status` stays `active`. Only
`POST /api/v1/goals/:id/celebration-seen` — called by the dashboard after the user dismisses
the full-screen animation — sets `status: "achieved"`. A goal the user never saw complete has
not, as far as this product is concerned, completed. `createGoal`/`updateGoal` do not accept
`"achieved"` as an input status.

---

## Agent properties

Named values the agent invents and maintains, which goals read by key.

```json
POST /api/v1/properties
{ "key": "books_read", "label": "Books finished", "kind": "counter", "unit": "books" }

POST /api/v1/properties/books_read/increment
{ "by": 1 }
```

`key` is `lower_snake_case`. Each property has a stable `uid` — key external records to that,
not to `key`. Incrementing an undefined key auto-defines it as a counter rather than dropping
the increment; redefining an existing key returns `409`.

---

## Backups

`POST /api/v1/backups` snapshots the SQLite file into `data/backups/` with `VACUUM INTO`,
which is consistent while the database is open. A scheduler checks every 15 minutes and
snapshots when `backupIntervalHours` has elapsed since `lastBackupAt`, so a machine that slept
through several intervals takes one snapshot on wake rather than a backlog. Retention is
`backupKeep`, pruned oldest-first.

### SVG sanitizing

`svg` must be a single root `<svg>…</svg>` element, max 64 KB. The server strips
`<script>`, `<style>`, `<a>`, `<use>`, `<image>`, `<foreignObject>`, `<iframe>`, all
`<animate*>`/`<set>` elements, every `on*` handler, and any `href`/`src`/`xlink:href`.
Malformed or non-SVG input returns `400`, as does markup that has nothing drawable left
after sanitizing (rather than saving an empty graphic box). The create response includes
`svgNotes` listing what was removed — an empty array means the markup came through intact.

The client renders it via an `<img>` data URI, so it cannot execute script regardless.

---

## The XP model

`GET /api/v1/agent/xp-model` returns the rules **and** the current per-habit shares, so an
agent never has to infer the maths.

```
dailyXpTarget        fixed pool, default 200 — only changed via gamification config
habit.baseXp       = floor(dailyXpTarget × xpWeight ÷ Σ xpWeight of active habits)
habit.extraXp        bonus, outside the pool
efficiencyPct      = todayXpEarned ÷ dailyXpTarget × 100
improvementPct     = todayEfficiency − yesterdayEfficiency
```

Adding a habit **re-slices** the pool; it does not grow it. Bonus XP from tasks, quests and
achievements all counts toward today's total, which is why efficiency can exceed
100%. There are no levels.

Redistribution runs automatically on habit create/delete, on `xpWeight`/`extraXp`/`active`
changes, and when `dailyXpTarget` changes — or explicitly via `POST /api/v1/habits/rebalance-xp`.

---

## Growth meter

```json
PATCH /api/v1/gamification/config
{ "growthStyle": "sprout" }
```

`sprout` (a plant that grows) or `orb` (a sphere that fills). Previously `nurtureStyle` with
values `plant` / `water` / `both`; those are still accepted and mapped
(`plant`→`sprout`, `water`→`orb`, `both`→`sprout`). The rename removed the collision with
the *drink water* habit.

---

## Webhooks

Named targets, with a delivery record per attempt — not the single global URL
this section used to describe.

```
GET    /api/v1/webhooks/targets
POST   /api/v1/webhooks/targets          { name, preset, url, secret?, events[] }
PATCH  /api/v1/webhooks/targets/:id
DELETE /api/v1/webhooks/targets/:id
POST   /api/v1/webhooks/targets/:id/test   send a throwaway event now
GET    /api/v1/webhooks/deliveries         status and error per attempt
```

Presets: `hermes` (HMAC-SHA256 over `<timestamp>.<body>`), `openclaw` (bearer),
`generic` (`X-LifeOS-Secret`). Three attempts with backoff, and every attempt is
recorded — so a target that has been failing for a week stops looking identical
to one that was never configured.

**The URL is resolved by Life OS, not by you.** If Life OS runs on the user's
machine and you run in a container or on another host, `127.0.0.1` in a target
URL means *their* loopback and your listener will never see anything. Use the
address Life OS can reach you at — the host's LAN IP and a published port — and
confirm with `POST /webhooks/targets/:id/test` rather than waiting for a real
completion.

---

## MCP

```
POST /mcp        Authorization: Bearer <API_TOKEN>
```

The agent surface, over HTTP, for an agent that is not on this machine. Same
tools as stdio, same database, same token. Stateless; `GET` answers 405 because
there are no server-initiated messages to stream. Deliberately outside
`/api/v1`, so it is not subject to the dashboard's protocol negotiation.

See [`docs/AGENT_SETUP.md`](AGENT_SETUP.md) §2.

---

Agent skill: [`docs/skills/life-os/SKILL.md`](skills/life-os/SKILL.md) ·
Database: [`docs/DATABASE.md`](DATABASE.md)
