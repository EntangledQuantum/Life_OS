# Life OS HTTP API

Base URL: `http://127.0.0.1:8787`

Auth: `Authorization: Bearer <session-or-API_TOKEN>` on all `/api/v1/*` except login.

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Health check — use this to detect whether Life OS is running |
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
| GET/POST | `/api/v1/goals` | List / create goals |
| PATCH/DELETE | `/api/v1/goals/:id` | Update / delete |
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
| GET/POST | `/api/v1/cards` | List / create dashboard cards |
| GET/PATCH/DELETE | `/api/v1/cards/:id` | Read / update / delete card |
| POST | `/api/v1/cards/:id/complete` | Complete → XP + webhook |
| GET | `/api/v1/export/json` | Full export |
| GET | `/api/v1/agent/capabilities` | Capability list, slots, growth styles |
| GET | `/api/v1/agent/xp-model` | XP rules + this user's live shares |

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
| `slot` | `0` \| `1` \| `2`. `2` implies `kind: "agent-setup"` |
| `kind` | `task` (default) \| `agent-setup` |
| `svg` | Inline SVG markup — sanitized on write, rendered sandboxed |
| `imageUrl` / `imageData` | Remote URL or small base64 data URI |
| `xpOnComplete` | Bonus XP outside the habit pool |

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
