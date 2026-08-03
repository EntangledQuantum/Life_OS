# Life OS HTTP API

Base URL: `http://127.0.0.1:8787`

Auth: `Authorization: Bearer <session-or-API_TOKEN>` on all `/api/v1/*` except login.

Reaching it from a phone or another machine on your network: see
[`docs/NETWORK.md`](NETWORK.md). Loopback and private-LAN origins are allowed by CORS on any
port; public origins must be listed in `CORS_ORIGINS`.

**Building a second frontend** (mobile app, widget, TUI)? Start with
[`docs/CLIENT_GUIDE.md`](CLIENT_GUIDE.md) — this file is the endpoint reference, that one is
what to render and which behaviours are contracts rather than styling.

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Health check — returns `{ok, service, storage, host, lan}` |
| POST | `/api/v1/auth/login` | `{ username, password }` → token |
| POST | `/api/v1/auth/logout` | Invalidate session |
| GET | `/api/v1/auth/me` | Current user |
| GET | `/api/v1/habits` | List habits |
| POST | `/api/v1/habits` | Create habit |
| PATCH | `/api/v1/habits/:id` | Update |
| DELETE | `/api/v1/habits/:id` | Soft delete |
| POST | `/api/v1/habits/:id/complete` | Complete today — `200` ok · `404` unknown · `409` already done |
| POST | `/api/v1/habits/:id/undo` | Undo today's completion |
| PATCH | `/api/v1/habits/:id/theme` | Theme |
| POST | `/api/v1/habits/rebalance-xp` | Redistribute the daily XP pool by weight |
| GET | `/api/v1/blocks` | List today's schedule blocks |
| GET | `/api/v1/blocks/study` | Study blocks only |
| POST | `/api/v1/blocks` | Create a timeline block |
| PATCH/DELETE | `/api/v1/blocks/:id` | Update / delete |
| POST | `/api/v1/blocks/:id/start` | Start → Right Now timer |
| POST | `/api/v1/blocks/:id/complete` | Complete → logs real elapsed study time |
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
| GET | `/api/v1/analytics` | Analytics payload |
| GET/POST/DELETE | `/api/v1/session/active` | Right Now timer |
| GET/POST | `/api/v1/events` | Quick log agent events |
| POST | `/api/v1/events/:id/complete` | Complete → awards `xpOnComplete` |
| POST | `/api/v1/events/:id/dismiss` | Dismiss without XP |
| GET/POST | `/api/v1/quests` | Quests |
| GET/POST | `/api/v1/reviews` | Light reviews |
| POST | `/api/v1/reviews/:id/complete` | Complete a light review |
| GET/POST | `/api/v1/achievements` | Achievements |
| GET/PATCH | `/api/v1/settings` | Settings incl. `dayResetTime`, agent webhook |
| GET/PATCH | `/api/v1/gamification/config` | `dailyXpTarget`, `growthStyle`, multipliers |
| GET/POST | `/api/v1/cards` | List / create cards (pinned or scheduled) |
| GET | `/api/v1/cards/upcoming` | Visible scheduled cards, soonest first |
| GET | `/api/v1/cards/imminent` | Only the next 15 minutes, plus anything overdue |
| GET | `/api/v1/cards/due` | Reminders that should chime now |
| GET/PATCH/DELETE | `/api/v1/cards/:id` | Read / update / delete card |
| POST | `/api/v1/cards/:id/notified` | Client confirms the chime played (fires once) |
| POST | `/api/v1/cards/:id/start` | Start → timeline block under the activity tag |
| POST | `/api/v1/cards/:id/complete` | Complete → XP + webhook + next repeat occurrence |
| GET/POST | `/api/v1/backups` | List snapshots / snapshot now |
| GET | `/api/v1/export/json` | Full export |
| GET | `/api/v1/agent/capabilities` | Card kinds, activity tags, repeat rules, tools |
| GET | `/api/v1/agent/goal-syntax` | Condition language + worked examples |
| POST | `/api/v1/agent/setup` | Reshape a fresh instance in one call |
| GET | `/api/v1/agent/xp-model` | XP rules + this user's live shares |

**Every successful non-`GET` request re-checks every goal condition.** That is the contract:
any change to the database can complete a goal, whichever endpoint made it.

---

## Dashboard cards

Two **content** slots (`0`, `1`) plus one reserved **agent-setup** card (slot `2`,
singleton) that does not consume a content slot. Creating into an occupied slot replaces it.

```json
POST /api/v1/cards
{
  "slot": 0,
  "kind": "task",
  "title": "Currently reading",
  "subtitle": "Project Hail Mary · ch. 12",
  "body": "Finish chapter 12.",
  "emoji": "📖",
  "themeColor": "#A78BFA",
  "svg": "<svg viewBox=\"0 0 120 60\" xmlns=\"http://www.w3.org/2000/svg\">…</svg>",
  "progress": 40,
  "ctaLabel": "Finished chapter",
  "meta": { "type": "reading", "chapter": 12 },
  "xpOnComplete": 30,
  "webhookOnComplete": true
}
```

| Field | Notes |
|-------|-------|
| `slot` | `-1` unpinned \| `0` \| `1` \| `2`. `2` implies `kind: "agent-setup"` |
| `kind` | `task` (default) \| `agent-setup` \| `event` \| `reminder` |
| `svg` | Inline SVG markup — sanitized on write, rendered sandboxed |
| `imageUrl` / `imageData` | Remote URL or small base64 data URI |
| `xpOnComplete` | Bonus XP outside the habit pool |

---

## Scheduled cards (events and reminders)

`event` and `reminder` cards are **unpinned** (slot `-1`) and live in the Upcoming rail, so
they never consume one of the two front-page slots. A card sent with `eventAt` or `remindAt`
but no `kind` is treated as scheduled rather than evicting a pinned card.

```json
POST /api/v1/cards
{
  "kind": "event",
  "title": "Read one chapter",
  "purpose": "Spaced-repetition reading block",
  "activityTag": "Study",
  "showAt":   "2026-08-04T17:00:00Z",
  "remindAt": "2026-08-04T18:50:00Z",
  "eventAt":  "2026-08-04T19:00:00Z",
  "durationMinutes": 60,
  "repeatRule": "spaced",
  "sound": true,
  "flash": true,
  "xpOnComplete": 25
}
```

### Where they surface

`dashboard/today` splits them: `upcoming` holds only the **imminent** cards (due within 15
minutes, overdue, or already pinged) for the dashboard's Up next list, while `scheduled` holds
every visible one for the Timeline tab. Agents can schedule as far ahead as they like without
crowding the dashboard.

### The ordering rule

```
showAt  <=  remindAt  <  eventAt
```

Enforced with `400` and a message naming the violated leg. A reminder that fires at or after
its own event is useless, so it is rejected rather than quietly reordered. `remindAt` without
an `eventAt` is likewise rejected. `PATCH` re-validates the **resulting** schedule, not just
the patched fields — moving `eventAt` earlier can invalidate a stored `remindAt` — and
re-arms the chime when either instant changes.

### Activity tags

A closed set: `Deep Work` · `Study` · `Sleep` · `Exercise` · `Break` · `Life Admin` ·
`Exploration`. Anything else is `400`. `POST /api/v1/cards/:id/start` creates a timeline block
in that bucket and makes it the running session, so a tagged card counts toward the day
automatically.

### Repetition

`repeatRule`: `none` | `daily` | `weekly` | `spaced`. Completing a repeating card inserts the
next occurrence as a **new** card (returned as `nextOccurrence`) and leaves the completed one
in history. `spaced` walks `1, 3, 7, 14, 30, 60` days by default — override with
`repeatOffsetsDays` — preserving the lead times between `showAt`, `remindAt` and `eventAt`.

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
Metrics: `total_xp`, `habit_completions`, `habit_streak`, `study_minutes`, `cards_completed`,
`days_active`, over a `window` of `all` | `7d` | `30d` | `90d` | `year`.
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

Adding a habit **re-slices** the pool; it does not grow it. Bonus XP from cards, events,
quests, and achievements all count toward today's total, which is why efficiency can exceed
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

```json
PATCH /api/v1/settings
{ "agentWebhookUrl": "https://your-host/hooks/lifeos", "agentWebhookSecret": "shared-secret" }
```

Fires on `habit.complete` and `card.complete`. Headers: `X-LifeOS-Event`, optional
`X-LifeOS-Secret`. Fire-and-forget with an 8 second timeout.

---

Agent skill: [`docs/skills/life-os/SKILL.md`](skills/life-os/SKILL.md) ·
Database: [`docs/DATABASE.md`](DATABASE.md)
