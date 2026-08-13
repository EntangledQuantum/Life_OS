---
name: life-os
description: >
  Control the Life OS execution app via HTTP or MCP (habits, study blocks,
  dashboard cards, scheduled reminders and spaced repetition, the fixed daily XP
  pool, agent-set goals with machine-checkable conditions, agent-defined
  counters, every instance setting, and database backups). Use when any
  long-running agent (Hermes, OpenClaw, Claude Code, or similar) should read the
  user's day, reshape the instance, schedule things, set goals, react to
  completions, or help the user install and start Life OS when no server is
  running.
version: 3.0.0
license: MIT
platforms: [macos, linux, windows]
metadata:
  hermes:
    tags: [Productivity, Habits, Life-OS, Local-API, Webhook]
    related_skills: []
    config:
      - key: lifeos.api_base
        description: Base URL of the Life OS API
        default: "http://127.0.0.1:8787"
        prompt: Life OS API base URL
      - key: lifeos.api_token
        description: Bearer token (prefer env LIFEOS_API_TOKEN)
        default: ""
        prompt: Life OS API bearer token name/value for local dev
  openclaw:
    requires:
      bins: []
    # HTTP-only skill; git/node/pnpm are only needed for the optional install flow
homepage: https://github.com/EntangledQuantum/Life_OS
required_environment_variables:
  - name: LIFEOS_API_TOKEN
    prompt: Life OS API bearer token
    help: "The API_TOKEN value in the Life OS .env — generated at setup, no default"
    required_for: authenticated API calls
  - name: LIFEOS_API_BASE
    prompt: Life OS API base URL
    help: "Default http://127.0.0.1:8787"
    required_for: connecting to a non-default host
---

# Life OS — Agent Skill

**One skill for every long-running agent** (Hermes, OpenClaw, Cursor, Claude Code, cron bots).
Load this `SKILL.md` and drive the HTTP API (or MCP, if it is running).

You operate **Life OS**: the execution layer for habits, schedule, study blocks, cards,
reminders, goals, and personal progress.

> **The user completes. You decide everything else.**

That is not a slogan, it is the division of labour. You own the settings, the habit set, the
schedule, the cards, the reminders, the XP pool, and — importantly — **the goals**. The user
taps things. Anything that requires sitting down and deciding is yours.

| | |
|--|--|
| Base URL | `$LIFEOS_API_BASE` or `http://127.0.0.1:8787` |
| Auth | `Authorization: Bearer $LIFEOS_API_TOKEN` — from the Life OS `.env`. Generated at setup; there is no default. |
| Skill path in repo | `docs/skills/life-os/SKILL.md` |
| Repo | https://github.com/EntangledQuantum/Life_OS |

```http
Authorization: Bearer $LIFEOS_API_TOKEN
Content-Type: application/json
```

**Hard rule:** Life OS never writes to Obsidian. You may escalate only **special** moments
into the vault after reading Life OS data.

---

## 0. If there is no server running

Always start by checking whether Life OS is up:

```bash
curl -s --max-time 3 $LIFEOS_API_BASE/health
# → {"ok":true,"service":"life-os-api","storage":"local"}
```

If that fails, the user has no Life OS running. **Ask them first — never clone or install
without an explicit yes.**

> "I can't reach Life OS on `http://127.0.0.1:8787`. Would you like me to clone the repo
> and set it up? It needs Node 22.5+ and pnpm, creates a local SQLite database, and takes
> about a minute. Where should I put it?"

Only after they agree:

```bash
git clone https://github.com/EntangledQuantum/Life_OS.git Life_OS
cd Life_OS
pnpm setup     # .env + install + database + migrations + seed (idempotent)
pnpm dev       # web :5173 · API :8787
```

Then confirm and hand back control:

```bash
curl -s http://127.0.0.1:8787/health
```

Tell the user their database is at `data/lifeos.db` and that `API_TOKEN` in `.env` is the
single credential — the browser asks for it too, there is no username/password login. Suggest
they change it from the default, especially if they plan to open the API to their network.

**Rules for this flow**

- Ask before cloning, before installing, and before choosing a directory.
- Never overwrite an existing `.env` or database. `pnpm setup` already refuses to.
- If Node is older than 22.5, say so and stop — do not try to install or switch Node runtimes.
- If the user says no, carry on without Life OS. Do not ask again in the same session.
- If a server exists but rejects your token, ask the user for the right `API_TOKEN`.
  Never guess tokens or try a list of candidates.

---

## 1. Connect & discover

```bash
GET /health
GET /api/v1/agent/capabilities   # card kinds, activity tags, repeat rules, tool list
GET /api/v1/agent/xp-model       # the XP rules, plus this user's live numbers
GET /api/v1/agent/goal-syntax    # goal condition language + live counters
GET /api/v1/dashboard/today      # primary read
GET /api/v1/export/json          # full dump
```

`dashboard/today` is the one call you usually want. It returns, in one payload:

| Field | What it holds |
|-------|---------------|
| `habits` · `progress` · `vsYesterday` · `pulse` | The day's numbers |
| `cards` | The pinned front-page cards (slots 0, 1, and the setup card) |
| `upcoming` | Only what is **current** — inside the reminder lead window and not past its own end |
| `scheduled` | Every visible scheduled card (this is what the Timeline tab shows) |
| `dueReminders` | Reminders that should chime **now** and have not yet |
| `pendingCelebrations` | Goals that are met but that the user has not yet *seen* |
| `properties` | Your own counters, with live values |
| `timeline` · `studyBlocks` · `agentEvents` · `lightReviews` | The rest of the day |

---

## 1a. You own the settings

**Every field of `GET /api/v1/settings` is yours to change**, and you do not need to ask
before tuning the instance to fit the person in front of you.

```bash
GET   /api/v1/settings
PATCH /api/v1/settings
{
  "dayResetTime": "04:00",
  "plannedWake": "11:00",
  "plannedSleepStart": "02:00",
  "plannedSleepEnd": "03:00",
  "quietHoursStart": "03:30",
  "quietHoursEnd": "10:30",
  "accentTheme": "nebula",
  "celebrationIntensity": "full",
  "reducedMotion": false,
  "notificationSound": "chime",
  "doNotDisturb": false,
  "quietHoursSilent": true,
  "reminderLeadMinutes": 15,
  "gamificationEnabled": true,
  "streaksEnabled": true,
  "pointsEnabled": true,
  "achievementsEnabled": true,
  "questsEnabled": true,
  "agentWebhookUrl": "https://your-host/hooks/lifeos",
  "agentWebhookSecret": "shared-secret",
  "backupsEnabled": true,
  "backupIntervalHours": 6,
  "backupKeep": 24
}
```

Themes: `nebula` | `quantum` | `terminal` | `ember`. Times are `HH:mm`, local.

Reminder sounds: `chime` | `bell` | `marimba` | `pulse` | `alert` | `none`.

**Do-not-disturb suppresses the interruption, not the information.** With
`doNotDisturb: true` (or inside quiet hours when `quietHoursSilent` is on) a reminder makes no
sound, no flash and no system notification — but it still appears on the dashboard and keeps
pulsing until dealt with, and it is still marked notified so nothing piles up to fire at once
when the silence ends. Schedule normally; do not try to route around it.

### First contact with a fresh clone

A new install ships demo habits and default hours. Reshape it in one call rather than a
dozen round-trips:

```bash
POST /api/v1/agent/setup
{
  "replaceHabits": true,
  "habits": [
    { "name": "Wake window", "emoji": "🌅", "category": "Life", "isTiny": true,
      "anchor": "when I leave bed", "xpWeight": 2 },
    { "name": "Deep work block", "emoji": "🎯", "category": "Deep Work",
      "isTiny": false, "anchor": "after first coffee", "xpWeight": 4 }
  ],
  "dailyXpTarget": 220,
  "growthStyle": "sprout",
  "settings": { "dayResetTime": "04:00", "plannedWake": "09:30" },
  "agentName": "Hermes",
  "agentSetupCard": {
    "title": "Hermes connected",
    "subtitle": "Morning review 07:30 · EOD 23:30"
  }
}
```

Everything is optional — send only what you know, come back for the rest. The response
returns the resulting habit set, the new XP shares, and the full settings.

MCP equivalent: `lifeos_setup_instance`, `lifeos_update_settings`, `lifeos_get_settings`.

---

## 2. The XP system — read this before touching XP

Life OS deliberately does **not** work like a normal habit app. There are **no levels**,
**no ranks**, and **no other people** anywhere in the maths.

### 2.1 A fixed pool, re-sliced

```
dailyXpTarget  (the pool — default 200, only YOU change it)
      │
      ├── split across active habits by xpWeight  →  habit.baseXp
      │
      └── habit.extraXp  (bonus, NOT taken from the pool)
```

The pool does **not** grow when you add habits. Adding a sixth habit re-slices the same
200 XP into six pieces. This is the entire point: `100%` has to keep meaning "I did my day."

```
habit.baseXp = floor(dailyXpTarget × habit.xpWeight ÷ Σ xpWeight of active habits)
```

The last habit absorbs the rounding remainder, so the shares always sum to `dailyXpTarget`.

### 2.2 What a completion awards

| Source | Award |
|--------|-------|
| Habit | `round(baseXp × tinyHabit? × fullBlock?) + extraXp` |
| Dashboard card | `card.xpOnComplete` — bonus, outside the pool |
| Agent event | `event.xpOnComplete` (default `0`) — bonus, outside the pool |
| Quest | `quest.xpBonus` — bonus, outside the pool |
| Achievement | `achievement.xpBonus` — bonus, outside the pool |
| Study session | `round(base × qualityMultiplier)` for `inspired` / `feynman` / `retrieval` |

Every award is clamped to a minimum of 1 XP. **All of these count toward today's XP**, so
bonuses genuinely move the growth meter — that is how a strong day exceeds 100%.

### 2.3 Scoring

```
efficiencyPct  = todayXpEarned ÷ dailyXpTarget × 100
improvementPct = todayEfficiency − yesterdayEfficiency     (percentage points)
```

`improvementPct` is the only comparison the product makes.

### 2.4 When redistribution happens

Automatically on:

- `POST /habits` (unless you pass `redistribute: false`)
- `DELETE /habits/:id`
- `PATCH /habits/:id` when `xpWeight`, `extraXp`, or `active` changes
- `PATCH /gamification/config` when `dailyXpTarget` changes

Manually:

```bash
POST /api/v1/habits/rebalance-xp
```

### 2.5 Worked example

Pool `200`, four habits with weights `3, 2, 4, 3` (Σ = 12):

| Habit | Weight | baseXp |
|-------|--------|--------|
| Wake window | 3 | 50 |
| Water | 2 | 33 |
| Study session | 4 | 66 |
| Movement | 3 | 51 *(absorbs remainder)* |

Add "Read 10 pages" at weight `2` (Σ = 14) and the pool is unchanged — every habit's
`baseXp` simply shrinks. If you want the day to genuinely be *worth more*, raise the pool
explicitly:

```bash
PATCH /api/v1/gamification/config
{ "dailyXpTarget": 260 }
```

### 2.6 Common mistakes

- Creating a habit with `redistribute: false` and leaving `baseXp` uneven across habits.
- Assuming more habits means a bigger day. It does not — patch `dailyXpTarget`.
- Using `extraXp` to "boost" a habit that should just have a higher `xpWeight`.
  Use `xpWeight` for *relative importance inside the day*; use `extraXp` for a genuine bonus.

### 2.7 Endpoints

```bash
GET  /api/v1/agent/xp-model         # rules + current shares (start here)
GET  /api/v1/gamification/config
PATCH /api/v1/gamification/config
{ "dailyXpTarget": 200, "growthStyle": "sprout" }

POST /api/v1/habits/rebalance-xp
```

---

## 3. Habits

```bash
GET    /api/v1/habits
GET    /api/v1/habits/:id
POST   /api/v1/habits
PATCH  /api/v1/habits/:id
DELETE /api/v1/habits/:id
POST   /api/v1/habits/:id/complete
POST   /api/v1/habits/:id/undo
PATCH  /api/v1/habits/:id/theme
```

```json
{
  "name": "Tiny stretch",
  "emoji": "🧘",
  "category": "Health",
  "isTiny": true,
  "xpWeight": 1,
  "extraXp": 0,
  "redistribute": true,
  "anchor": "after water"
}
```

**Status codes on complete:** `200` success · `404` unknown habit · `409` already completed
today. Treat `409` as success-with-no-op, not as an error to retry.

Prefer **tiny habits with an anchor** ("after I sit at my desk"). Anchors are how ADHD-friendly
habits actually stick, and the UI surfaces them.

---

## 4. Cards

There are two families:

| Family | Kinds | Where it lives | How many |
|--------|-------|----------------|----------|
| **Pinned** | `task`, `agent-setup` | The front page | 2 content slots + 1 setup card |
| **Scheduled** | `event`, `reminder` | Quick log when current, Timeline always | Effectively unlimited (200 live) |

Scheduled cards **never consume a pinned slot**, so you can queue a week of spaced-repetition
reviews without evicting whatever the user actually needs to look at today. If you send a card
with `eventAt` or `remindAt` and forget to set `kind`, it is treated as scheduled — the server
will not silently throw away a pinned card for you.

### 4.1 Pinned cards

Two **content** slots (`0`, `1`) plus one reserved **agent-setup** card (slot `2`, singleton).
The setup card does not consume a content slot. Creating into an occupied slot **replaces** it.

```bash
GET    /api/v1/cards
GET    /api/v1/cards/:id
POST   /api/v1/cards
PATCH  /api/v1/cards/:id
DELETE /api/v1/cards/:id
POST   /api/v1/cards/:id/complete
```

```json
{
  "slot": 0,
  "kind": "task",
  "title": "Currently reading",
  "subtitle": "Project Hail Mary · ch. 12",
  "body": "Finish chapter 12. Mark done when finished.",
  "emoji": "📖",
  "themeColor": "#A78BFA",
  "progress": 40,
  "ctaLabel": "Finished chapter",
  "meta": { "type": "reading", "book": "project-hail-mary", "chapter": 12 },
  "xpOnComplete": 30,
  "webhookOnComplete": true,
  "status": "active"
}
```

| Field | Purpose |
|-------|---------|
| `slot` | `0` or `1` for content; `2` is the setup card |
| `kind` | `task` (default) or `agent-setup` |
| `title` / `subtitle` / `body` | Copy |
| `emoji` / `themeColor` | Identity |
| `svg` | **Inline SVG markup** — see §5 |
| `imageUrl` / `imageData` | Remote URL or small `data:image/...;base64,...` |
| `progress` | 0–100 |
| `ctaLabel` / `ctaLink` | Button + optional link |
| `meta` | Free JSON for your own memory |
| `xpOnComplete` | Bonus XP (outside the habit pool) |
| `webhookOnComplete` | POST to your webhook on complete |
| `status` | `active` \| `done` \| `hidden` |

---

## 4a. Scheduled cards: events and reminders

This is how you put things in the future — a review to do at 7pm, a spaced-repetition prompt
three days out, a nudge before a call.

### The ordering rule (the server enforces this)

```
showAt      <=      remindAt      <      eventAt
(appears)          (chimes)             (happens)
```

**The user is always told about a thing before the thing.** A card whose reminder lands at or
after its own event is rejected with `400` and a message saying why — you find out
immediately, not at 3am when the chime never came. `remindAt` without an `eventAt` to point
at is also rejected.

All three are ISO 8601 instants. All three are optional; a card with none of them is just an
always-visible item in the rail.

### Activity tags — a closed set

```
Deep Work · Study · Sleep · Exercise · Break · Life Admin · Exploration
```

`activityTag` must be one of these. This is deliberate: **invent any content you like, but map
it onto a day shape the timeline already understands.** "Read one chapter of Project Hail Mary"
is content; `Study` is its shape. Anything outside the set is rejected with `400`.

`Exploration` is the creative / curiosity bucket — side quests, tinkering, art, wandering
research. Use it instead of forcing play into `Deep Work`.

Because the tag is already part of the daily timeline, **starting a tagged card auto-activates
that bucket**: the app creates a block, makes it the running session, and the time counts
toward the day without anyone having to teach it what a book is.

### Creating one

```bash
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
  "emoji": "📖",
  "xpOnComplete": 25
}
```

| Field | Meaning |
|-------|---------|
| `kind` | `event` (startable, has a duration) or `reminder` (just chimes) |
| `purpose` | What this card is *for*, in your own words. Free text. |
| `activityTag` | Which day bucket it belongs to — see the closed set above |
| `showAt` | Card stays hidden until this instant |
| `remindAt` | Chime fires here. Must be strictly before `eventAt`. |
| `eventAt` | When the thing actually happens |
| `durationMinutes` | Length of the block created when started |
| `repeatRule` | `none` \| `daily` \| `weekly` \| `spaced` |
| `repeatOffsetsDays` | Custom spaced ladder; omit for `1, 3, 7, 14, 30, 60` |
| `sound` | Play the chime (default `true`) |
| `flash` | Flash the card and the tab until dealt with (default `true`) |

### Spaced repetition

`repeatRule: "spaced"` is the whole feature in one field. Each time the user completes the
card, the next occurrence is scheduled further out along the ladder — 1 day, then 3, 7, 14,
30, 60 — and the lead times you chose are preserved (a card that showed 2h early and pinged
10min early keeps doing that). When the ladder is exhausted the card stops repeating.

The completed card stays in history as `done`; the next occurrence is a **new** card with its
own id, returned as `nextOccurrence` on the complete response. Nothing is silently rewound.

### Reminders in practice

```bash
GET  /api/v1/cards/upcoming        # visible scheduled cards, soonest first
GET  /api/v1/cards/imminent        # only what is current (see the window below)
GET  /api/v1/cards/due             # reminders that should chime now
POST /api/v1/cards/:id/notified    # the client confirms it chimed (fires once)
POST /api/v1/cards/:id/complete    # done; schedules the next rung if repeating
```

### There is no start. Do not look for one.

**A scheduled thing has exactly two properties that matter: when the user should be doing it,
and whether it is done.** It does not run. It has no timer. Completing it does not change what
the user is doing.

What the user is *doing* — `Deep Work`, `Study`, `Sleep`, `Life Admin` — is a separate,
higher-level thing they set by hand, and it is what paints their timeline. You can read it
(`activeSession`) but treat it as theirs. `activityTag` on a card says which bucket the card
belongs to for grouping and colour; it does not take the day over.

If you find yourself wanting to "start" something for the user, what you actually want is
either a card with an `eventAt`, or nothing.

### Where a scheduled card actually shows up

Schedule freely — the UI splits it for you:

| Where | What lands there |
|-------|------------------|
| **Dashboard → Quick log** | Only what is current, above the habits. |
| **Timeline tab** | Everything, grouped by day, against the clock. |

A card is current from `eventAt - reminderLeadMinutes` (the user's setting, default 15) until
`eventAt + durationMinutes`, then it leaves Quick log whether or not it was completed. Set
`durationMinutes` on anything that takes time — without it the card vanishes from Quick log the
moment its start time passes.

The dashboard answers "what am I doing *now*". A card three hours out is planning, not doing,
so it stays on the Timeline tab. This means you can queue a whole week without making the
dashboard unusable — schedule as far ahead as you like.

The line under a card's title is yours: it shows `subtitle` if set, otherwise `purpose`. Keep
it under ~60 characters; it truncates on one line. `body` shows on the Timeline tab.

When a reminder comes due the web app plays the user's chosen chime, washes the screen in the
accent colour, flashes the tab title, and raises an OS notification if the user has granted
permission. The card keeps pulsing until it is actually dealt with — being told about a thing
is not the same as doing it.

If do-not-disturb or quiet hours are active, all of that is suppressed and only the on-screen
card remains. `sound: false` / `flash: false` on the card are your own per-card switches on top
of that.

You normally do not call `/notified` yourself; the client does.

The notification is actionable: tapping it opens the Timeline with that card in front of the
user and a single Done button. So the notification body is worth writing properly — it is the
thing they read at the moment they decide whether to act.

---

## 5. Card graphics with SVG

Any card — content or setup — accepts inline SVG in the `svg` field. This is the preferred
way to give a card artwork, because it is sharp at any size, themeable, and costs no network
request.

```json
{
  "slot": 1,
  "title": "Deep work streak",
  "svg": "<svg viewBox=\"0 0 120 60\" xmlns=\"http://www.w3.org/2000/svg\"><rect x=\"6\" y=\"30\" width=\"14\" height=\"24\" rx=\"3\" fill=\"#5B8CFF\"/><rect x=\"28\" y=\"20\" width=\"14\" height=\"34\" rx=\"3\" fill=\"#5B8CFF\"/><rect x=\"50\" y=\"10\" width=\"14\" height=\"44\" rx=\"3\" fill=\"#A78BFA\"/></svg>"
}
```

**Rules the server enforces.** SVG is sanitized on write and rendered inside an `<img>`, so it
can never execute script. Write accordingly:

- A single root `<svg>…</svg>` element. Anything else is rejected with `400`.
- Max 64 KB.
- If sanitizing leaves nothing drawable (e.g. your whole graphic was inside an `<a>` or
  `<use>`), the request is rejected with `400` rather than saving an empty graphic box.
- **Stripped:** `<script>`, `<style>`, `<a>`, `<use>`, `<image>`, `<foreignObject>`, `<iframe>`,
  all `<animate*>` / `<set>` elements, every `on*` handler, and any `href` / `src` / `xlink:href`.
- No external references of any kind — everything must be self-contained.
- **Use `<defs>` + gradients, paths, shapes, and `<text>`.** Those all survive.

The response includes `svgNotes`, listing anything that was removed. Check it: an empty array
means your SVG came through intact.

**Design guidance:** aim for a wide-ish `viewBox` (roughly 2:1), avoid pure white or pure
black (cards sit on a dark surface), keep to 2–3 colors, and skip fine detail — the card
renders it around 160 px wide.

---

## 6. The agent setup card

Slot `2` holds a card describing **you** — your connection status and what you can do. A fresh
install ships a "No agent connected" placeholder. Replace it once you are wired up.

**It renders as a single-line status strip**, not a full card: title, subtitle, and a live/dead
dot, with `body` and the CTA tucked behind a disclosure. Keep `title` under ~40 characters and
`subtitle` under ~50 so it does not truncate. Put detail in `body`, not the title.

```bash
POST /api/v1/cards
{
  "kind": "agent-setup",
  "title": "Hermes connected",
  "subtitle": "Morning review 07:30 · EOD 23:30",
  "body": "I schedule your day, inject reviews, and rebalance XP. Say 'plan my day' any time.",
  "emoji": "🛰️",
  "themeColor": "#34D399",
  "svg": "<svg viewBox=\"0 0 120 60\" xmlns=\"http://www.w3.org/2000/svg\">…</svg>",
  "meta": { "connected": true, "agent": "hermes", "schedule": ["07:30", "23:30"] },
  "ctaLabel": "What can you do?",
  "webhookOnComplete": false
}
```

Set `meta.connected: true` — the UI shows a live/dead indicator from that field, and the strip
starts collapsed once connected. Keep `xpOnComplete` at `0`; a setup card is information, not a
task.

---

## 7. Quick log (reviews & tasks)

Items flash on the dashboard until complete. While any agent item is open, **habits hide**
from Quick log (the Habits tab still has them).

```bash
POST /api/v1/events
{
  "kind": "review",
  "title": "Feynman: decoherence",
  "body": "3 sentences",
  "priority": 2,
  "xpOnComplete": 15
}

POST /api/v1/reviews
{ "prompt": "Active recall on chapter 4", "link": "obsidian://..." }
```

Kinds: `review` | `task` | `life` | `study` | `reminder` | `other`.

`xpOnComplete` is optional and defaults to `0`. Use it sparingly — the pool is what should
carry the day; event XP is for genuinely extra work you asked for.

---

## 8. Study blocks & timeline

You own the blocks; the user ticks them off. There is no start here either — the duration
recorded is the window you planned, so plan windows that mean something.

```bash
GET    /api/v1/blocks
POST   /api/v1/blocks
PATCH  /api/v1/blocks/:id
DELETE /api/v1/blocks/:id
POST   /api/v1/blocks/:id/complete
```

```json
{
  "category": "Study",
  "label": "Retrieval session",
  "plannedStart": "16:30",
  "plannedEnd": "18:00",
  "source": "agent"
}
```

The day timeline is a continuous colour ribbon (0–24h). The server closes gaps between
blocks automatically, so you do not need to fill the day exactly — but a well-planned day
reads much better than three blocks stretched across 24 hours.

---

## 8a. Internal properties — your own counters

Life OS does not know what a book is. It does not need to. You can invent a value, push to it
whenever something happens on your side, and write goals against it.

```bash
GET    /api/v1/properties
GET    /api/v1/properties/:key
POST   /api/v1/properties
PATCH  /api/v1/properties/:key
POST   /api/v1/properties/:key/increment
DELETE /api/v1/properties/:key
```

Define one:

```bash
POST /api/v1/properties
{
  "key": "books_read",
  "label": "Books finished",
  "kind": "counter",
  "unit": "books",
  "description": "Incremented when the user finishes a book"
}
```

Response includes a **stable `uid`**. Key your own records to that, not to `key` — the label
and even the meaning may drift, the uid never does.

Push data:

```bash
POST /api/v1/properties/books_read/increment
{ "by": 1 }
```

- `key` must be `lower_snake_case`, starting with a letter.
- `kind` is `counter` | `number` | `text` | `json`. Counters start at `0`.
- Incrementing an **undefined** key auto-defines it as a counter rather than failing. A
  forgotten setup call should never lose an increment and leave a goal quietly never firing.
- Redefining an existing key returns `409`, not a silent overwrite. `PATCH` instead.
- Every write re-checks every goal immediately.

---

## 8b. Goals — yours to set, not the user's

**The user does not decide goals. You do.** Deciding what to want is exactly the
executive-function tax this app exists to remove. The Goals page is read-only.

A goal is a title plus a **machine-checkable condition**. The system re-evaluates every goal
after *any* change to the database — HTTP, MCP, or the user tapping a habit — so a goal fires
the moment the thing that completes it is recorded.

```bash
GET    /api/v1/agent/goal-syntax          # the language + live counters. Read this first.
GET    /api/v1/goals
POST   /api/v1/goals
PATCH  /api/v1/goals/:id
DELETE /api/v1/goals/:id
GET    /api/v1/goals/pending-celebration
POST   /api/v1/goals/:id/celebration-seen
POST   /api/v1/goals/evaluate             # force a re-check
```

```bash
POST /api/v1/goals
{
  "title": "Read 10 books this year",
  "whyItMatters": "You said you missed reading.",
  "emoji": "📚",
  "themeColor": "#A78BFA",
  "condition": { "type": "property", "key": "books_read", "op": ">=", "value": 10 }
}
```

### The condition language

Four node types:

```jsonc
// A counter you maintain
{ "type": "property", "key": "books_read", "op": ">=", "value": 10 }

// Something the app already tracks
{ "type": "metric", "metric": "habit_streak", "habitId": "…", "op": ">=", "value": 30 }
{ "type": "metric", "metric": "study_minutes", "window": "30d", "op": ">=", "value": 2400 }

// Combinators
{ "type": "all", "of": [ … ] }   // every leg must hold
{ "type": "any", "of": [ … ] }   // one leg is enough
```

| | Values |
|--|--|
| `op` | `>=` `>` `<=` `<` `==` `!=` |
| `metric` | `total_xp` · `habit_completions` · `habit_streak` · `study_minutes` · `cards_completed` · `days_active` |
| `window` | `all` (default) · `7d` · `30d` · `90d` · `year` |

`habitId` is required for `habit_completions` and `habit_streak`. Invalid conditions are
rejected with **every** problem listed at once, so one round-trip is enough to fix them.

Progress is computed for you: `>=` and `>` give a real ratio, `all` reports its weakest leg,
`any` its strongest. `conditionDetail` carries a human-readable trace of each leaf, which is
what the UI shows.

### Met is not finished

This is the important part.

1. The condition comes true → `conditionMetAt` is stamped and the goal appears in
   `pendingCelebrations` on the dashboard.
2. **The goal stays `status: "active"`.** It is *met*, not *achieved*.
3. The dashboard plays a full-screen celebration. The only way out is the claim button.
4. Claiming calls `POST /api/v1/goals/:id/celebration-seen`, which is the **only** path to
   `status: "achieved"`.

Close the tab instead of claiming and the celebration is waiting next time. A goal the user
never saw completed did not, as far as this product is concerned, complete.

Do not try to set `status: "achieved"` yourself — the create/update schemas do not accept it.

---

## 8c. Database backups

The SQLite file is snapshotted into `data/backups/` on a timer using SQLite's own consistent
copy path, so a snapshot is safe to take while the app is running. Old snapshots are pruned
oldest-first.

```bash
GET  /api/v1/backups     # list + current policy
POST /api/v1/backups     # snapshot now (ignores the enabled flag)

PATCH /api/v1/settings
{ "backupsEnabled": true, "backupIntervalHours": 6, "backupKeep": 24 }
```

Take one before any risky restructure — replacing the habit set, bulk-deleting cards, changing
the XP pool wholesale. `POST /api/v1/backups` costs a fraction of a second.

---

## 9. Webhooks

```bash
PATCH /api/v1/settings
{
  "agentWebhookUrl": "https://your-host/hooks/lifeos",
  "agentWebhookSecret": "shared-secret"
}
```

| Event | When |
|-------|------|
| `card.complete` | User completes a dashboard card |
| `habit.complete` | User completes a habit |

```json
{
  "source": "life-os",
  "event": "card.complete",
  "ts": "2026-08-03T20:00:00.000Z",
  "card": {},
  "xpAwarded": 30,
  "note": null
}
```

Headers: `X-LifeOS-Event`, optional `X-LifeOS-Secret`. Delivery is fire-and-forget with an
8 second timeout — check your own logs if events go missing.

---

## 10. Day boundary

```bash
PATCH /api/v1/settings
{ "dayResetTime": "04:00" }
```

All "today" windows use this, not midnight. A 01:00 study session belongs to the previous
day when the reset is 04:00 — which is exactly what a night owl wants.

---

## 11. The growth meter

The daily progress visual. Two styles:

```bash
PATCH /api/v1/gamification/config
{ "growthStyle": "sprout" }    # or "orb"
```

| Style | Looks like |
|-------|-----------|
| `sprout` | A plant growing leaf by leaf, blooming at 100% |
| `orb` | A sphere filling with light |

> **Naming note.** This was previously `nurtureStyle` with values `plant` / `water` / `both`.
> "Water" was constantly confused with the *drink water* habit, so it was renamed. The old
> keys and values are still accepted and mapped (`plant`→`sprout`, `water`→`orb`,
> `both`→`sprout`), but write `growthStyle` in new code.

---

## 12. Suggested workflows

### Morning
1. `GET /api/v1/dashboard/today`
2. Lay out today's blocks if the schedule drifted
3. Inject light reviews / quests / events
4. Update the reading or focus card
5. Check `GET /api/v1/agent/xp-model` if you changed the habit set

### End of day (~23:30–01:00 local, or the user's night-owl window)
1. `GET /api/v1/dashboard/today` — includes vs-yesterday fields
2. Scan study quality flags (`inspired` / `feynman`) and notes
3. Check `special_event_candidates` via the JSON export if needed
4. Escalate **only special** items to Obsidian (`state/days/…`)
5. Inject tomorrow's reviews, quests, and cards
6. Optionally tune the XP pool or habit themes

### On webhook `card.complete`
1. Read `meta`
2. Update your own memory or the vault
3. `PATCH` the card for the next step, or replace the slot
4. Optionally drop a celebration quest

### Hermes automation
If your runtime supports blueprints or cron, schedule the end-of-day procedure against this
skill. Installing a skill must **not** auto-create jobs without the user accepting.

### OpenClaw
Copy this skill directory under the workspace `skills/` root, or load it from the Life OS repo
path. Invoke with `/skill life-os` or natural language matching the description.

---

## 13. MCP (optional)

If `pnpm mcp` is running on the Life OS machine, these tools map to the same domain logic and
the same SQLite file. Prefer HTTP when in doubt.

| MCP tool | Role |
|----------|------|
| `lifeos_get_today` | Dashboard |
| `lifeos_get_xp_model` | XP rules + current shares |
| `lifeos_rebalance_xp` | Re-slice the pool |
| `lifeos_list_habits` / create / update / delete / complete / set theme | Habits |
| `lifeos_list_cards` / `lifeos_upsert_card` / `lifeos_update_card` / `lifeos_delete_card` / `lifeos_complete_card` | Cards, including `svg` and `agent-setup` |
| `lifeos_list_blocks` / `lifeos_create_block` / `lifeos_update_block` / `lifeos_delete_block` | Timeline |
| `lifeos_list_events` / `lifeos_inject_event` | Quick log |
| `lifeos_inject_quest` / `lifeos_inject_light_review` | Quests and reviews |
| `lifeos_update_xp_rules` | `dailyXpTarget`, `growthStyle`, multipliers |
| `lifeos_get_capabilities` | Card kinds, activity tags, repeat rules, tool list |
| `lifeos_setup_instance` | Reshape a fresh clone in one call |
| `lifeos_update_settings` / `lifeos_get_settings` | **Every** setting, not a subset |
| `lifeos_schedule_card` | Events and reminders, with the ordering rule enforced |
| `lifeos_list_upcoming_cards` / `lifeos_list_due_reminders` | The rail and the chime queue |
| `lifeos_mark_card_notified` | Confirm a chime fired (the client normally does this) |
| `lifeos_complete_block` | Tick off a timeline block |
| `lifeos_list_properties` / `lifeos_define_property` / `lifeos_set_property` / `lifeos_increment_property` / `lifeos_delete_property` | Your own counters |
| `lifeos_get_goal_syntax` | The condition language + worked examples |
| `lifeos_list_goals` / `lifeos_create_goal` / `lifeos_update_goal` / `lifeos_delete_goal` | Goals |
| `lifeos_evaluate_goals` | Force a re-check; lists goals awaiting celebration |
| `lifeos_backup_now` / `lifeos_list_backups` | Database snapshots |
| `lifeos_export_json` | Full dump |

Any mutating MCP call re-checks goals, exactly like the HTTP API. If a goal came due, the
response carries `goalsAwaitingCelebration` alongside your result.

---

## 14. Constraints

| Limit | Value |
|-------|--------|
| Pinned content cards | **2** (slots 0 and 1) |
| Agent setup card | **1** (slot 2, does not consume a content slot) |
| Scheduled cards | 200 live (`event` / `reminder`, unpinned) |
| Card schedule ordering | `showAt <= remindAt < eventAt`, enforced with `400` |
| Activity tags | Closed set of 7 — you may not invent day buckets |
| Goal status `achieved` | Only reachable via `celebration-seen` |
| Inline SVG | 64 KB, single root `<svg>`, no script or external refs |
| Auth | `API_TOKEN` bearer only — no password login, no cookie |
| Levels / social comparison | **None** |
| Obsidian writes from the app | **Never** |

---

## 15. Pitfalls

- Creating a habit without `redistribute` leaves `baseXp` uneven — pass `redistribute: true`
  or call `POST /habits/rebalance-xp`.
- More habits does **not** mean a bigger day. Patch `dailyXpTarget` if that is what you want.
- `409` on habit complete means "already done today", not a failure.
- Webhooks are fire-and-forget; check your endpoint's logs if events seem missing.
- Keep `imageData` small; prefer `svg` or `imageUrl`.
- SVG containing `<script>`, `<use>`, or any `href` is silently stripped — read `svgNotes`.
- Never clone or install Life OS without asking the user first.
- A reminder at or after its own event is a `400`. Put `remindAt` genuinely earlier.
- Do not invent activity tags. Map your content onto one of the seven day buckets.
- Do not try to mark a goal `achieved`. Only the user seeing the animation does that.
- Do not ask the user what their goals should be. That is your job — read their data and set one.
- Key your records to a property's `uid`, not its `key`.
- Take a backup before restructuring anything in bulk.

---

## 16. Verification

```bash
curl -s http://127.0.0.1:8787/health

curl -s http://127.0.0.1:8787/api/v1/agent/xp-model \
  -H "Authorization: Bearer $LIFEOS_API_TOKEN"

curl -s -X POST http://127.0.0.1:8787/api/v1/cards \
  -H "Authorization: Bearer $LIFEOS_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"slot":0,"title":"Smoke test card","emoji":"✅","xpOnComplete":5,
       "svg":"<svg viewBox=\"0 0 40 20\" xmlns=\"http://www.w3.org/2000/svg\"><circle cx=\"20\" cy=\"10\" r=\"8\" fill=\"#34D399\"/></svg>"}'
```

Confirm the card appears on Overview with its graphic, and that completing it awards XP and
moves the growth meter.

---

## 17. Quick reference

| Goal | Call |
|------|------|
| Is it running? | `GET /health` |
| Understand XP | `GET /api/v1/agent/xp-model` |
| Read the day | `GET /api/v1/dashboard/today` |
| Set up a fresh clone | `POST /api/v1/agent/setup` |
| Change literally any setting | `PATCH /api/v1/settings` |
| Reading card | `POST /api/v1/cards` slot 0 |
| Describe yourself | `POST /api/v1/cards` `kind: "agent-setup"` |
| Card artwork | `svg` field on any card |
| Schedule something | `POST /api/v1/cards` `kind: "event"` + `eventAt` |
| Remind before it | `remindAt` — strictly earlier than `eventAt` |
| Spaced repetition | `repeatRule: "spaced"` on a scheduled card |
| Creative time | `activityTag: "Exploration"` |
| Track your own number | `POST /api/v1/properties` then `/increment` |
| Set a goal | `POST /api/v1/goals` with a `condition` |
| Learn the condition language | `GET /api/v1/agent/goal-syntax` |
| See what is waiting on the user | `GET /api/v1/goals/pending-celebration` |
| New habit | `POST /api/v1/habits` + `redistribute: true` |
| Bigger day | `PATCH /api/v1/gamification/config` `{ dailyXpTarget }` |
| Bonus XP | `extraXp` on a habit, `xpOnComplete` on a card or event |
| Growth visual | `PATCH /api/v1/gamification/config` `{ growthStyle }` |
| Webhook | `PATCH /api/v1/settings` `{ agentWebhookUrl }` |
| Snapshot the DB | `POST /api/v1/backups` |

Keep friction low and dopamine honest.
Full product context: `docs/LIFE_OS.md` · Database: `docs/DATABASE.md` ·
Implementation handoff: `docs/development_log.md`
