---
name: life-os
description: >
  Control the Life OS execution app via HTTP (habits, study blocks, dashboard
  cards, the fixed daily XP pool, reviews, webhooks). Use when any long-running
  agent (Hermes, OpenClaw, Claude Code, or similar) should read the user's day,
  customize structure, inject tasks, react to completions, or help the user
  install and start Life OS when no server is running.
version: 2.0.0
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
        default: "lifeos-local-agent-token"
        prompt: Life OS API bearer token name/value for local dev
  openclaw:
    requires:
      bins: []
    # HTTP-only skill; git/node/pnpm are only needed for the optional install flow
homepage: https://github.com/EntangledQuantum/Life_OS
required_environment_variables:
  - name: LIFEOS_API_TOKEN
    prompt: Life OS API bearer token
    help: "From Life OS .env API_TOKEN (default lifeos-local-agent-token)"
    required_for: authenticated API calls
  - name: LIFEOS_API_BASE
    prompt: Life OS API base URL
    help: "Default http://127.0.0.1:8787"
    required_for: connecting to a non-default host
---

# Life OS — Agent Skill

**One skill for every long-running agent** (Hermes, OpenClaw, Cursor, Claude Code, cron bots).
Load this `SKILL.md` and drive the HTTP API (or MCP, if it is running).

You operate **Life OS**: the execution layer for habits, schedule, study blocks, front-page
cards, and personal progress.

> **The user completes. You customize.**

| | |
|--|--|
| Base URL | `$LIFEOS_API_BASE` or `http://127.0.0.1:8787` |
| Auth | `Authorization: Bearer $LIFEOS_API_TOKEN` (default `lifeos-local-agent-token`) |
| Skill path in repo | `docs/skills/life-os/SKILL.md` |
| Repo | https://github.com/EntangledQuantum/Life_OS |

```http
Authorization: Bearer lifeos-local-agent-token
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

Tell the user the login is `admin` / `lifeos` (from `.env`), their database is at
`data/lifeos.db`, and the agent token is `API_TOKEN` in `.env`.

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
GET /api/v1/agent/capabilities   # slots, tools, growth styles
GET /api/v1/agent/xp-model       # the XP rules, plus this user's live numbers
GET /api/v1/dashboard/today      # primary read
GET /api/v1/export/json          # full dump
```

`dashboard/today` is the one call you usually want: habits, cards, timeline, efficiency,
agent events, light reviews, and pulse in a single payload.

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

## 4. Front-page cards

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

You own the blocks; the user starts and completes them, and real elapsed time is logged.

```bash
GET    /api/v1/blocks
POST   /api/v1/blocks
PATCH  /api/v1/blocks/:id
DELETE /api/v1/blocks/:id
POST   /api/v1/blocks/:id/start
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
| `lifeos_update_settings` / `lifeos_get_settings` | Day reset, webhook, theme |

---

## 14. Constraints

| Limit | Value |
|-------|--------|
| Content cards | **2** (slots 0 and 1) |
| Agent setup card | **1** (slot 2, does not consume a content slot) |
| Inline SVG | 64 KB, single root `<svg>`, no script or external refs |
| Auth | Mock admin or `API_TOKEN` |
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

---

## 16. Verification

```bash
curl -s http://127.0.0.1:8787/health

curl -s http://127.0.0.1:8787/api/v1/agent/xp-model \
  -H "Authorization: Bearer lifeos-local-agent-token"

curl -s -X POST http://127.0.0.1:8787/api/v1/cards \
  -H "Authorization: Bearer lifeos-local-agent-token" \
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
| Reading card | `POST /api/v1/cards` slot 0 |
| Describe yourself | `POST /api/v1/cards` `kind: "agent-setup"` |
| Card artwork | `svg` field on any card |
| New habit | `POST /api/v1/habits` + `redistribute: true` |
| Bigger day | `PATCH /api/v1/gamification/config` `{ dailyXpTarget }` |
| Bonus XP | `extraXp` on a habit, `xpOnComplete` on a card or event |
| Growth visual | `PATCH /api/v1/gamification/config` `{ growthStyle }` |
| Webhook | `PATCH /api/v1/settings` `{ agentWebhookUrl }` |

Keep friction low and dopamine honest.
Full product context: `docs/LIFE_OS.md` · Database: `docs/DATABASE.md` ·
Implementation handoff: `docs/development_log.md`
