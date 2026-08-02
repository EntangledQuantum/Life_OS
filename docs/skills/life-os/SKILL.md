---
name: life-os
description: >
  Control the Life OS personal execution app (habits, study blocks, dashboard
  cards, XP pool, reviews, webhooks). Use when Hermes/any agent should read
  today's state, create or edit front-page cards (max 2), redistribute daily XP,
  inject reviews/tasks, or react to user completions via webhook.
---

# Life OS — Agent Skill

You are operating **Life OS**, the execution layer for habits, schedule, study
blocks, and personal progress. The user completes; **you customize**.

**Base URL (local default):** `http://127.0.0.1:8787`  
**Auth:** `Authorization: Bearer <API_TOKEN>`  
Default token in `.env`: `lifeos-local-agent-token` (or login as admin and use session token).

```http
Authorization: Bearer lifeos-local-agent-token
Content-Type: application/json
```

Never write mundane completions into Obsidian. Only escalate **special** moments
after reading Life OS data.

---

## 1. Connect & discover

```bash
# Health
GET /health

# What you can do
GET /api/v1/agent/capabilities

# Full day state (habits, cards, timeline, efficiency, events, reviews)
GET /api/v1/dashboard/today
```

Export everything:

```bash
GET /api/v1/export/json
```

---

## 2. Front-page cards (max 2)

Custom UI cards on the Overview. Slot `0` or `1`. Creating into an occupied slot
**replaces** that slot.

### List / read

```bash
GET /api/v1/cards
GET /api/v1/cards/:id
```

Cards also appear in `GET /api/v1/dashboard/today` → `cards[]`.

### Create

```bash
POST /api/v1/cards
```

```json
{
  "slot": 0,
  "title": "Currently reading",
  "subtitle": "Project Hail Mary · ch. 12",
  "body": "Finish chapter 12 tonight. Mark done when finished.",
  "emoji": "📖",
  "themeColor": "#A78BFA",
  "imageUrl": "https://example.com/cover.jpg",
  "progress": 40,
  "ctaLabel": "Finished chapter",
  "ctaLink": null,
  "meta": {
    "type": "reading",
    "book": "project-hail-mary",
    "chapter": 12
  },
  "xpOnComplete": 30,
  "webhookOnComplete": true,
  "status": "active"
}
```

**Fields you control**

| Field | Purpose |
|-------|---------|
| `slot` | `0` or `1` only |
| `title`, `subtitle`, `body` | Copy |
| `emoji`, `themeColor` | Visual identity |
| `imageUrl` | Remote image URL |
| `imageData` | Optional `data:image/...;base64,...` (keep small) |
| `progress` | 0–100 bar |
| `ctaLabel` / `ctaLink` | Button + optional external link |
| `meta` | Free JSON for your memory (book slug, IDs, etc.) |
| `xpOnComplete` | Bonus XP when user completes (outside habit pool) |
| `webhookOnComplete` | Fire agent webhook on complete (default true) |
| `status` | `active` \| `done` \| `hidden` |

### Update / delete

```bash
PATCH /api/v1/cards/:id
DELETE /api/v1/cards/:id
```

### User completes card

```bash
POST /api/v1/cards/:id/complete
{ "source": "user", "note": "optional" }
```

Awards `xpOnComplete`, sets `status: done`, and if webhook enabled POSTs to your
configured webhook URL.

**Example card ideas:** current book, weekly quest, deep-work streak goal,
startup milestone, “protect sleep tonight”.

---

## 3. Webhooks (agent triggers)

User sets URL in **Settings → Agent webhook**, or you set:

```bash
PATCH /api/v1/settings
{
  "agentWebhookUrl": "https://your-agent-host/hooks/lifeos",
  "agentWebhookSecret": "shared-secret"
}
```

### Events fired

| Event | When |
|-------|------|
| `card.complete` | User completes a dashboard card |
| `habit.complete` | User one-tap completes a habit |
| `habit.undo` | (if wired) undo |
| Others | reviews/events/blocks as implemented |

### Payload shape

```json
{
  "source": "life-os",
  "event": "card.complete",
  "ts": "2026-08-02T20:00:00.000Z",
  "card": { "...full card object..." },
  "xpAwarded": 30,
  "source": "user",
  "note": null
}
```

Headers:

- `Content-Type: application/json`
- `X-LifeOS-Event: card.complete`
- `X-LifeOS-Secret: <secret>` if configured

Use this to update Obsidian, advance reading state, inject tomorrow’s review, etc.

---

## 4. Habits + daily XP redistribution

### Rules (important)

1. **`dailyXpTarget`** is a **fixed daily pool** (default 200). Change only via:
   ```bash
   PATCH /api/v1/gamification/config
   { "dailyXpTarget": 200, "nurtureStyle": "plant" }
   ```
2. **Adding a habit does not raise the pool.** Base XP is **redistributed** by
   `xpWeight` across active habits (`POST /api/v1/habits/rebalance-xp` or automatic
   on create/delete when `redistribute: true`).
3. **`extraXp`** on a habit is **bonus on top of the pool** (not redistributed).
   Use sparingly for special habits.
4. Completing a habit awards `baseXp` (+ tiny/block multipliers) + `extraXp`.
5. Efficiency = today’s total XP / `dailyXpTarget`. Improvement = vs yesterday.

### CRUD habits

```bash
GET    /api/v1/habits
POST   /api/v1/habits
PATCH  /api/v1/habits/:id
DELETE /api/v1/habits/:id
POST   /api/v1/habits/:id/complete
POST   /api/v1/habits/:id/undo
PATCH  /api/v1/habits/:id/theme
POST   /api/v1/habits/rebalance-xp
```

Create example:

```json
{
  "name": "Tiny stretch",
  "emoji": "🧘",
  "category": "Health",
  "isTiny": true,
  "xpWeight": 1,
  "extraXp": 0,
  "redistribute": true,
  "anchor": "after water",
  "themeColor": "#34D399",
  "themeGraphic": "ring"
}
```

---

## 5. Quick log (reviews & tasks)

Shows on the dashboard and **flashes until complete**. While any agent item is
open, **habits are hidden** from Quick log (Habits tab still has them).

```bash
POST /api/v1/events
{
  "kind": "review",
  "title": "Feynman: quantum decoherence",
  "body": "Explain in 3 sentences",
  "link": null,
  "priority": 2
}

POST /api/v1/reviews
{
  "prompt": "Active recall on chapter 4",
  "link": "obsidian://..."
}
```

Kinds: `review` | `task` | `life` | `study` | `reminder` | `other`.

---

## 6. Study blocks & timeline

Agents own schedule blocks (user starts/completes with real elapsed time):

```bash
POST /api/v1/blocks
{
  "category": "Study",
  "label": "Retrieval session",
  "plannedStart": "16:30",
  "plannedEnd": "18:00",
  "source": "agent"
}
```

Day bar is a continuous color ribbon (gaps snap closed visually).

---

## 7. Day boundary

```bash
PATCH /api/v1/settings
{ "dayResetTime": "04:00" }
```

All “today” stats use this reset, not midnight.

---

## 8. Suggested agent workflows

### Morning
1. `GET /dashboard/today`
2. Inject light reviews / quests
3. Update reading card progress
4. Adjust notification timing if patterns drifted

### End of day
1. `GET /dashboard/today` + `vs-yesterday`
2. Scan study quality flags / special notes
3. Escalate only special items to Obsidian
4. Set tomorrow’s cards / blocks / reviews
5. Optionally tweak `dailyXpTarget` or `extraXp` if progression feels off

### On webhook `card.complete`
1. Read `meta` (e.g. book chapter)
2. Advance your memory / vault
3. `PATCH` card for next chapter or create replacement card
4. Optionally inject a celebration quest

---

## 9. Constraints

| Limit | Value |
|-------|--------|
| Dashboard cards | **2** slots (0, 1) |
| Auth | Mock admin or `API_TOKEN` |
| Social / levels | **None** |
| Obsidian writes | **Never from Life OS app** — agent only |

---

## 10. MCP (optional)

If MCP is running (`pnpm mcp` in the Life OS repo), prefer tools that map 1:1 to
the HTTP surface. Otherwise use HTTP as documented above.

---

## 11. Quick reference

| Goal | Call |
|------|------|
| Read day | `GET /api/v1/dashboard/today` |
| Put reading card | `POST /api/v1/cards` slot 0 |
| Finish card | user → `POST .../cards/:id/complete` → your webhook |
| New habit (no XP inflation) | `POST /api/v1/habits` + redistribute |
| Special bonus habit | set `extraXp` |
| Change daily pool | `PATCH /api/v1/gamification/config` `{ dailyXpTarget }` |
| Set webhook | `PATCH /api/v1/settings` `{ agentWebhookUrl }` |

You now have full control of structure, cards, XP distribution, and completion
feedback. Keep friction low and dopamine honest.
