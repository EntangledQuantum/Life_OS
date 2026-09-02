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
version: 5.0.0
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
- **Presentation** — pin it to slot 0 or 1 and it draws as a card: emoji, body,
  image, sanitized inline SVG, and one interactive control.
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
