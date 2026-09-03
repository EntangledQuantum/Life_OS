---
name: life-os
description: >
  Run someone's day with Life OS over MCP: habits and tasks (scheduled work,
  reminders, reviews, study), the fixed daily XP pool, goals with
  machine-checkable conditions, agent-defined counters, webhooks that push
  completions to you, every instance setting, and backups. Use when a
  long-running agent (Hermes, OpenClaw, Claude Code, cron) should read what
  actually happened, schedule what happens next, react to completions, or set
  Life OS up for a user who does not have it.
version: 4.6.0
license: MIT
platforms: [macos, linux, windows]
metadata:
  hermes:
    tags: [Productivity, Habits, Life-OS, MCP, Webhook]
    related_skills: []
    config:
      - key: lifeos.api_base
        description: Base URL of the Life OS API — MCP over HTTP lives at <base>/mcp
        default: "http://127.0.0.1:8787"
        prompt: Life OS API base URL
      - key: lifeos.api_token
        description: Bearer token (prefer env LIFEOS_API_TOKEN)
        default: ""
        prompt: Life OS API bearer token
  openclaw:
    requires:
      bins: []
homepage: https://github.com/EntangledQuantum/Life_OS
required_environment_variables:
  - name: LIFEOS_API_TOKEN
    prompt: Life OS API bearer token
    help: "The API_TOKEN value in the Life OS .env — generated at setup, no default"
    required_for: MCP over HTTP, the REST fallback, and the user's phone
  - name: LIFEOS_API_BASE
    prompt: Life OS API base URL
    help: "Default http://127.0.0.1:8787"
    required_for: connecting to a non-default host
---

# Life OS — Agent Skill

You run someone's day. Life OS holds what they did; deciding what they should do
is your job.

**Use MCP.** The REST API exists and is documented, but it is the *apps'*
transport — one big dashboard payload, polled every few seconds, shaped for a
screen. The MCP tools are shaped for you: a whole day or a whole range in one
call, already summarised.

There are two transports and both serve the same tools, so being remote is not
a reason to fall back to REST:

- **On the same machine as Life OS** — stdio; your client spawns the server.
- **Anywhere else** — HTTP `POST <base>/mcp`, `Authorization: Bearer <token>`.
  Stateless, POST only (`GET` answers 405 on purpose). If you are here, **set
  `timezone`** — see the clock rule below.

Not installed yet? [`docs/AGENT_SETUP.md`](../../AGENT_SETUP.md) is the install
and interview procedure. Read that first, then come back here.

---

## The model

**Two nouns. Habits and tasks. There is nothing else.**

| | |
|--|--|
| **Habit** | Recurs, scored daily, draws from the fixed daily XP pool. **Can carry its own time.** |
| **Task** | Everything else — scheduled work, reminders, reviews, study, and the pinned cards on the front page. One row with optional parts. |

> ### A habit with a time needs no task. Do not create one.
>
> `lifeos_create_habit { name: "Meditate", scheduledTime: "07:00", durationMinutes: 20 }`
> puts it on the timeline at 07:00 **every day**, derived from that one row.
> There is nothing to repeat and nothing to keep in sync.
>
> Creating a habit *and* a task for the same act — which is what the model used
> to force — gives the user two rows to tick. Tick both and the XP is paid
> twice; tick one and the other surface says it never happened. Nothing links
> them, so nothing can reconcile them afterwards.
>
> Omit `scheduledTime` for a habit with no particular time. Pass `null` on
> update to take an existing one off the timeline.

Before this there were four tables (`dashboard_cards`, `agent_events`,
`light_reviews`, `schedule_blocks`) that meant the same thing and supported
different fields, so you had to pick one and live with what it happened not to
offer. If you find yourself wanting a third noun, you want a task with different
fields set.

A task's optional parts:

- **When** — `eventAt` + `durationMinutes`. A task with no time is just a thing
  to do. **A day that ends closes**: an unfinished scheduled task becomes
  `missed` at the next reset, drops off the list, and can no longer be
  completed. That is deliberate — completing it later would pay today's XP for
  yesterday's work. Reschedule it if it still matters.
- **Repeat** — `daily`, `weekly`, or `spaced` (1, 3, 7, 14, 30, 60 days).
  Completing one spawns the next as a **new row**, so history survives. This is
  how Life OS handles recurring work: you do not re-create it nightly.
- **Tag** — `activityTag`, for colour and grouping. It does not take over the
  timeline.
- **Reward** — `xpOnComplete`, outside the habit pool.
- **Presentation** — pin it to slot 0 or 1 and it draws as a card. See
  *Cards are yours* below; there is more there than most agents use.
- **Resources** — `[{label, url, kind}]`. Chapters, papers, videos. This is what
  a "study block" always was underneath, and both clients render it.

---

## Start here, every session

```
lifeos_get_agenda         → today as one list, exactly what the user's screen shows
lifeos_get_day            → what happened today, summarised, with a story line
lifeos_get_range          → a window: totals, per-habit rates, what is slipping
lifeos_get_workload       → what is open, split into due / upcoming / missed / backlog
```

These exist so you are not reassembling someone's week out of forty CRUD calls.
`lifeos_get_day` returns a `story` you can quote to the user directly, plus the
evidence underneath it. Use `lifeos_get_range` for the nightly check-in.

`lifeos_search_history` answers "when did I last touch X" across tasks, study
sessions and habits.

### Two things a list will not tell you

**Stored is not the same as visible.** A task with a future `showAt` exists and
is correct, and no client displays it until then. `lifeos_list_tasks` returns
everything by default and marks each row's `visibility`; pass `scope:"visible"`
for what is on screen now. Creates report it too — `lifeos_bulk_create_tasks`
tells you how many of the batch are hidden.

> If you schedule next week and the list comes back short, **read `visibility`
> before you write it all again.** A short list there is the `showAt` working.

**Untimed is not due.** A task with no `eventAt` is inventory: open, real, and
not part of today unless something says so. `lifeos_get_workload` separates
them. A `backlog` of thirty is not thirty things to do now, and reading it as a
plan is how someone's front page becomes meaningless.

**After a bulk write, verify with `lifeos_get_workload` or a fetch by id** —
not `lifeos_get_today`, which is a screen and will not show you Thursday.

---

## Writing

| Tool | For |
|------|-----|
| `lifeos_create_task` | One task |
| `lifeos_bulk_create_tasks` | A day or a week in one call. A bad entry is reported by index; the rest still land |
| `lifeos_update_task` · `lifeos_complete_task` · `lifeos_dismiss_task` | |
| `lifeos_create_habit` · `lifeos_complete_habit` · `lifeos_rebalance_xp` | |
| `lifeos_create_goal` · `lifeos_evaluate_goals` | |
| `lifeos_set_property` · `lifeos_increment_property` | Your own counters |
| `lifeos_add_webhook_target` | Get told about completions instead of polling |
| `lifeos_setup_instance` | Reshape a fresh instance in one call, after interviewing |
| `lifeos_backup_now` | |

Scheduling a day looks like this:

```json
lifeos_bulk_create_tasks {
  "tasks": [
    { "kind": "task",  "title": "Deep work", "activityTag": "Deep Work",
      "eventAt": "2026-08-15T13:00:00Z", "durationMinutes": 180, "xpOnComplete": 30 },
    { "kind": "study", "title": "Chapter 4", "activityTag": "Study",
      "eventAt": "2026-08-15T16:30:00Z", "durationMinutes": 90, "xpOnComplete": 25,
      "body": "Read once for shape, then again with a pen.",
      "resources": [{ "label": "Chapter 4 PDF", "url": "https://…", "kind": "paper" }] },
    { "kind": "review", "title": "Explain one idea in three sentences",
      "repeatRule": "daily", "xpOnComplete": 15 }
  ]
}
```

---

## Cards are yours

Two slots on the front page, and **you decide entirely what goes in them.** This
is the one surface in Life OS with no fixed shape — everything else is a row in
a list. Use it. A card that is a wall of grey text next to a card with a book
cover on it is a worse app than two cards that look like what they are about.

Set any of these on a task with `slot: 0` or `slot: 1`:

| Field | What it does |
|---|---|
| `title` · `subtitle` · `body` | The words. `body` keeps your line breaks. |
| `emoji` | The tile beside the title, when no icon image is set. |
| `themeColor` | Tints the border, the tile and the default wash. |
| `imageUrl` **or** `imageData` | **The picture** — what the card is about. `cardStyle.layout` decides where it goes. `imageData` is a `data:` URI, so it needs no network and survives offline. |
| `iconImageUrl` **or** `iconImageData` | **The icon** — the small tile beside the title, in place of the emoji. A *separate* slot, so one card can have a photograph behind its text **and** its own icon. Drawn at about 50pt square; keep it small. |
| `svg` | Inline SVG, sanitised server-side. Draw your own diagram. Web only — the phone skips it, so pair it with an image if the card matters there. |
| `progress` | 0–100. Draws a bar. |
| `ctaLabel` + `ctaLink` | A link out. |
| `control` | **One** interactive widget — a slider to ask something, or a button. Fires `card.interaction` if you subscribed. |
| `cardStyle` | Layout and paint. Below. |
| `habitId` | The habit this card is about. |
| `linkedTaskId` | The scheduled block this card is about. |
| `resources` | `[{label, url, kind}]`. |
| `xpOnComplete` | Reward for finishing it. |

### `cardStyle` — the arrangement

Every field optional. Omit it and the card looks as cards always have.

```json
{
  "layout": "background",   // banner | background | side | plain
  "overlay": 0.7,           // 0.35–0.92, scrim over a background image
  "gradient": { "from": "#1E1B4B", "to": "#0B1020" },
  "border": "accent",       // accent | hairline | none
  "align": "left"           // left | center
}
```

- **`banner`** — the picture across the top. The default, right for something wide.
- **`background`** — behind the text, under a scrim. For atmosphere. The scrim
  is floored at 0.35 and you cannot turn it off: a card whose body cannot be
  read is not a style choice.
- **`side`** — a small square beside the title. A book cover, an album, a face —
  anything a banner crop would cut in half.
- **`plain`** — no picture even if one is set. Turn it off without deleting it.

`layout` only ever moves **the picture**. The icon is its own slot and is drawn
in the tile whatever the layout says, so `background` + `iconImageData` is a
wash behind your text with your own icon on top — the combination that used to
be impossible, because one image field had to be either the atmosphere or the
icon and could not be both.

A book you are tracking:

```json
lifeos_create_task {
  "title": "A Game of Thrones", "subtitle": "p.550 / ~800",
  "slot": 0, "progress": 69, "habitId": "<the reading habit>",
  "imageUrl": "https://…/cover.jpg",
  "cardStyle": { "layout": "side", "border": "hairline" },
  "body": "Next rung p.600. Companion book — progress is enough, no takes required."
}
```

Tonight's session, explained:

```json
lifeos_create_task {
  "title": "Why tonight is Ch 5", "slot": 1,
  "linkedTaskId": "<the 19:00 study block>",
  "imageData": "data:image/png;base64,…",
  "iconImageData": "data:image/png;base64,…",
  "cardStyle": { "layout": "background", "overlay": 0.72, "align": "center" },
  "control": { "kind": "slider", "label": "How hard did that feel?", "min": 1, "max": 5 }
}
```

### Linking, and what it does not do

`habitId` and `linkedTaskId` are **pointers**. The card shows what it is about,
so the user is not matching two similar titles by eye. Neither completes the
other: a card explaining tonight's study block is not that block, and wiring
them together would recreate exactly the duplication the agenda model removed.

If you want the *thing itself* on the timeline, that is a habit with a
`scheduledTime` or a task with an `eventAt`. The card is commentary.

### A pinned card is not also a row

Pinning is a statement about **where** a task is shown. A task with `slot: 0` or
`slot: 1` is drawn as a card and is deliberately left out of the day's list, the
timeline and the agenda — it is already on the screen, in a richer form, with
its own Complete button.

So you do not need a companion task for a card, and you should not make one:
that is the same duplication as a habit plus a matching task, and it gives the
user two things to tick for one act. Unpin a card (`slot: null`) and it becomes
an ordinary row again.

### Restraint

Two slots is the limit and it is the point. A third thing means deciding which
of the two matters less. Prefer one card that is worth reading over two that are
not, and drop the picture entirely when it is decoration — a plain card is a
perfectly good card.

---

## Rules you must not break

Some of these will contradict what you would do by default. They are deliberate,
and users notice when they are broken.

**One act, one row.** If something recurs and is scored, it is a habit — give
it `scheduledTime` and it is on the timeline too. Do not pair it with a task.
The user completes it from whichever surface is in front of them and it counts
once, for that life-day, with one XP award and one streak.

**Nothing starts.** A task has a target time and a completion. No timer, no
session, no running state. Completing a task does **not** change what activity
the user is in — that is set by hand, by them, from the *Right now* picker, and
nothing else writes it. There is no `start` tool and there will not be one.

**Never punish.** No red for a bad day, no streak-shaming, no guilt. A missed
day is information. When you report a day back, say what happened; do not grade
it.

**No levels, ranks or leaderboards.** XP measures today against today's target
and nothing else.

**The daily XP pool is fixed.** Adding a habit re-slices it; it does not raise
the ceiling. You cannot make a day worth more by giving someone more to do.
`lifeos_rebalance_xp` after any habit change.

**A goal is not achieved until the user has seen the celebration.** The
condition being true only sets `conditionMetAt` and puts it in
`pendingCelebrations`. Do not tell them they finished something they have not
been shown.

**Two content slots.** That is the limit and it is the point. Wanting a third
means deciding which of the two matters less.

**A finished day stays finished.** Yesterday's unfinished scheduled work is
`missed`, not pending. Do not re-open it and do not complete it on the user's
behalf to tidy the list — the miss is information, and moving the XP to today
makes today's number a lie. Reschedule if it still matters.

**The life-day rolls at `dayResetTime`** (default 04:00), not midnight. A 01:00
completion belongs to the previous day. Never assume the calendar date — every
day payload carries a `lifeDay` block with the exact start and end instants and
the timezone they are in. Read it instead of deriving it.

**Know which clock you are on.** If you are not running on the user's machine
you are probably on UTC and they are not, and nothing will tell you: you will
simply schedule "09:00" hours off and disagree about which day things landed in.
Set it once — `lifeos_update_settings { "timezone": "Asia/Kolkata" }` — and
check it with `lifeos_get_settings`.

**Life OS is an execution shell, not a catalogue.** If something else already
knows when a card is due — a vault, Anki, an SR plugin — that system owns the
schedule. Bring across what is due *today*; leave the rest where it lives.
Mirroring a whole review backlog in produces hundreds of permanent untimed tasks
and a front page that means nothing. Tag anything you do import
(`meta.source`, `meta.externalRef`) so it can be re-synced or removed later.

**Clean up with the dry run first.** `lifeos_bulk_dismiss_tasks` filters by
status, kind, `createdBefore`, `untimedOnly` and `titleContains`, and changes
nothing until `confirm:true`. Call `lifeos_backup_now` before the confirmed
pass — it is one call, and the user's real data is on the other side of it.

**Notification times are derived.** Set `eventAt`; the notify instant is
`eventAt - reminderLeadMinutes` (a user setting, default 15). Only set
`remindAt` when you want to override that, and it must satisfy
`showAt <= remindAt < eventAt` or the write is rejected.

**Ask before installing anything.** Never clone, never write a service file,
never touch a config outside Life OS without saying what you are about to do.

---

## Pictures: habits, goals, tiers

Habits and goals take the same two picture slots a card takes, with the same
meanings. Every one of them is optional, and **most things should have none** —
a picture earns its place when it says something the emoji cannot.

| Field | What it is |
|---|---|
| `iconImageUrl` / `iconImageData` | **The icon.** The small square, in place of the emoji. |
| `backgroundImageUrl` / `backgroundImageData` | **The background.** Fills the card behind the text, under a scrim. |
| `artOverlay` | How dark that scrim is, `0.35`–`0.92`. |

`…Data` is a `data:` URI and wins over `…Url` when both are set. Inline art
needs no network and survives the phone being offline, which is the case this
app is built for; a URL is better for anything large, because every inline byte
rides on every dashboard poll.

### The dimensions, exactly

A habit card and a goal card are deliberately **the same shape**, so one picture
works in either place and there is one set of numbers to remember.

**Background — 3:2 landscape. 1200 × 800 recommended, 600 × 400 minimum.**

It is drawn `cover`: scaled to fill the box and cropped equally from both sides
of whichever dimension is too long. So the subject belongs in the **middle** —
anything near an edge is the first thing to go. 3:2 is what the box is on both
clients; hand us 16:9 and the sides get cut, hand us a square and the top and
bottom do. More pixels than the box because a phone draws it at 3× density; not
many more, because this is JSON on a wire.

**Icon — square. 256 × 256 recommended, 96 × 96 minimum.**

Drawn at about **44pt** — roughly a thumbnail. Anything with fine detail, thin
lines or small text reads as mud at that size. One shape, one subject, high
contrast. 256 is 44pt at 3× with room to spare.

**Where each one shows up**

| | icon | background |
|---|---|---|
| Habit card (dashboard) | in place of the emoji | behind the card |
| Habit row (phone, day list) | in place of the emoji | not shown — a row is not a card |
| Goal card | in place of the emoji | behind the card |
| Celebration | the medallion | full-screen behind everything |

Both clients cache what they fetch — the dashboard in Cache Storage, the phone
on disk via `expo-image` — so a picture is pulled once and then survives
reloads, restarts and flight mode. You do not need to re-send it, and you should
not: setting the same art repeatedly is churn on every device that is watching.

### The scrim is not optional

`artOverlay` is clamped to `0.35`–`0.92` and cannot be turned off. A habit whose
name cannot be read over its own photograph is a broken row, not a style choice.
If your picture is busy or bright, raise it rather than fighting it.

---

## Rarity: one goal, five heights

A goal is normally one condition: met or not. That is a switch, and a switch
cannot describe "read 12 books" versus "read 50" — those had to be two unrelated
goals with two unrelated celebrations, and nothing said the second was the
harder version of the first.

`tiers` is a ladder on one goal. **Up to five rungs, defined bottom first**, each
with its own condition, words, art and celebration.

```json
lifeos_create_goal {
  "title": "Books this year",
  "emoji": "📚",
  "tiers": [
    { "label": "Bronze", "condition": { "type": "property", "key": "books_read", "op": ">=", "value": 12 },
      "theme": "spark",  "description": "One a month. The habit exists." },
    { "label": "Silver", "condition": { "type": "property", "key": "books_read", "op": ">=", "value": 25 },
      "theme": "ember",  "description": "Two a month. It is not an accident any more." },
    { "label": "Gold",   "condition": { "type": "property", "key": "books_read", "op": ">=", "value": 50 },
      "theme": "gold",   "description": "A book a week.",
      "backgroundImageUrl": "https://…/shelf.jpg",
      "iconImageUrl": "https://…/gold-spine.png" },
    { "label": "Mythic", "condition": { "type": "property", "key": "books_read", "op": ">=", "value": 100 },
      "theme": "void",   "description": "A hundred. Nobody does this." }
  ]
}
```

**The rules, and why they are what they are.**

- **Array order is the ladder.** `rank` is optional; the order you write them in
  is the order they are reached, and the ranks stored are always `1..n`.
- **A higher rung implies every lower one.** Clear rung 3 and rungs 1 and 2 are
  marked too, because "50 books" cannot be true while "12 books" is false.
  Write your rungs as increasing bars, not as unrelated tests — a ladder whose
  rungs can be true in any order is not a ladder, and this rule will surprise
  you.
- **One celebration per rung, lowest first.** A user who crosses three rungs in
  one write sees three celebrations, in order. That is the point.
- **The goal finishes at the top rung.** `status: "achieved"` and
  `goal.achieved` fire when the last rung is witnessed; every rung below fires
  `goal.tier` instead, so you can react to "they hit Gold" without treating it
  as the end.
- **Sending `tiers` replaces the whole ladder.** Rungs are defined relative to
  each other, so a partial update is how Gold ends up below Bronze. A rung that
  keeps its **rank and label** keeps the date the user earned it and does not
  replay its celebration — so rewording is safe, renaming is not.
- **`[]` removes the ladder.** The goal goes back to being ordinary.
- **Five is the limit and it is the point.** More rungs is a progress bar with
  extra steps, and the value of the top rung is that reaching it is rare.

### Themes

`theme` picks the *feeling* of the celebration — the halo, the confetti, how
loud it is. You choose from a closed set; you do not choose hex codes, because
you do not know what accent the user is running and a rung hard-coding purple
against a gold theme reads as a bug rather than as a rarity.

| theme | reads as | loudness |
|---|---|---|
| `spark` | quiet, cool, a first step | ▁ |
| `ember` | warm, forged, effort | ▃ |
| `frost` | sharp, crystalline | ▄ |
| `gold` | the obvious achievement | ▆ |
| `aurora` | rare, many-coloured | ▇ |
| `void` | the top of a ladder nobody climbs | █ |

Give the top rung the loudest one. A ladder where every rung celebrates
identically has rarities in the data and none on the screen.

The user's own celebration setting still wins: a theme's loudness multiplies it
rather than replacing it, so someone who set celebrations to minimal keeps
minimal.

### Tier art

A tier's own `iconImage*` / `backgroundImage*` — same dimensions as everything
else — replaces the goal's once that rung is reached. The card *becomes* the
tier: its colour, its name, its picture. And the background is the one place the
art gets the stage it was made for, full-screen behind the celebration.

Art on the top rung or two is usually the right amount. A picture on every rung
of every goal is wallpaper.

---

## Goals are machine-checkable

A goal is a condition, not a title. Every write in the app re-evaluates every
goal, so a goal fires the moment the thing that completes it is recorded.

```json
{ "type": "property", "key": "books_read", "op": ">=", "value": 20 }
{ "type": "metric", "metric": "tasks_completed", "window": "30d", "op": ">=", "value": 60 }
{ "type": "all", "of": [ … ] }
```

Metrics: `total_xp`, `habit_completions`, `habit_streak`, `study_minutes`,
`tasks_completed`, `days_active`. Windows: `all`, `7d`, `30d`, `90d`, `year`.

If a goal cannot be written as a condition, you need a counter for it — invent
one with `lifeos_set_property` and push to it when something happens on your
side. Nothing in the app needs to be taught what a book is.

A goal with degrees rather than a single bar wants `tiers` instead of one
`condition` — see **Rarity** above.

---

## Webhooks: be told, don't poll

Set `webhookOnComplete: true` on the things that matter — per item, not
globally. A daily water habit does not need to wake you up; the chapter they
have been stuck on for a week might.

Register a target with `lifeos_add_webhook_target` (`hermes`, `openclaw` or
`generic`). Hermes gets an HMAC over `<timestamp>.<body>`; OpenClaw gets a
bearer token. Deliveries carry `X-Request-ID` and are retried three times —
**dedupe on that id**, because a retry reuses it.

If a task carries a slider, `webhookOnInteract` tells you the answer without the
card disappearing.

A tiered goal fires `goal.tier` on every rung the user witnesses — with
`tierLabel`, `tierRank` and `isTopTier` — and `goal.achieved` only on the last
one. Congratulating someone for finishing a goal they are three rungs into is
worse than saying nothing.

---

## Your nightly check-in

Life OS records what happened. It does not decide what happens next. Schedule a
recurring job **on your side** — not a task inside Life OS — that fires each
evening and:

1. `lifeos_get_day` — read the day.
2. Say something true about it. An observation, not encouragement.
3. `lifeos_bulk_create_tasks` — schedule tomorrow, with times, durations, tags,
   XP, and the resources for anything they have to read.
4. Move what is not working. A task skipped four times at 07:00 is a scheduling
   problem, not a discipline problem. `lifeos_get_range` shows you which.
5. Update your counters.

This is the part that makes Life OS work, and it is the part agents skip.

---

## REST fallback

Only if you cannot speak MCP **over either transport**. Being on another machine
is not a reason — that is what `POST <base>/mcp` is for. Full reference:
[`docs/API.md`](../../API.md).

```
Authorization: Bearer <API_TOKEN>
X-LifeOS-Protocol: 2
```

Both headers on every `/api/v1/*` request. A missing or older protocol header
gets `426` with a download link — that is the server telling you it has moved
past what you can read, not a transient failure to retry.

There is no username/password login; `POST /api/v1/auth/login` returns `410`.
Never print the token back to the user or write it into a file you commit.
