---
name: life-os
description: >
  Control the Life OS execution app via HTTP (habits, study blocks, max-2
  dashboard cards, daily XP pool, reviews, webhooks). Use when any long-running
  agent (Hermes, OpenClaw, or similar) should read today, customize structure,
  inject tasks, or react to user completions.
version: 1.1.0
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
        description: Bearer token (non-secret path optional; prefer env LIFEOS_API_TOKEN)
        default: "lifeos-local-agent-token"
        prompt: Life OS API bearer token name/value for local dev
  openclaw:
    requires:
      bins: []
    # HTTP-only skill; no special binaries required
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

**One skill for every long-running agent** (Hermes, OpenClaw, Cursor agent, Claude Code, custom cron bots).  
There is no separate Hermes-only doc — install/load this `SKILL.md` and call the HTTP API (or MCP if running).

You operate **Life OS**: the execution layer for habits, schedule, study blocks, front-page cards, and personal progress.  
**The user completes. You customize.**

| | |
|--|--|
| Base URL | `$LIFEOS_API_BASE` or `http://127.0.0.1:8787` |
| Auth | `Authorization: Bearer $LIFEOS_API_TOKEN` (default `lifeos-local-agent-token`) |
| Skill path in repo | `docs/skills/life-os/SKILL.md` |

```http
Authorization: Bearer lifeos-local-agent-token
Content-Type: application/json
```

**Hard rule:** Life OS never writes to Obsidian. You may escalate only **special** moments into the vault after reading Life OS data.

---

## When to use

- Morning/EOD review of the user's day
- Creating or updating habits, study blocks, reviews, quests
- Putting up to **2** front-page cards (e.g. current book)
- Adjusting daily XP pool / nurture style / day reset
- Handling webhooks when the user completes a card or habit
- Wiring automations (Hermes blueprint cron / OpenClaw cron) against Life OS

---

## 1. Connect & discover

```bash
GET /health
GET /api/v1/agent/capabilities
GET /api/v1/dashboard/today
GET /api/v1/export/json
```

Use `dashboard/today` as the primary read. It includes habits, cards, timeline, efficiency, agent events, light reviews, and pulse.

---

## 2. Front-page cards (max 2)

Slots `0` and `1`. Creating into an occupied slot **replaces** it.

```bash
GET    /api/v1/cards
GET    /api/v1/cards/:id
POST   /api/v1/cards
PATCH  /api/v1/cards/:id
DELETE /api/v1/cards/:id
POST   /api/v1/cards/:id/complete   # usually user; agents may call with source=agent
```

```json
{
  "slot": 0,
  "title": "Currently reading",
  "subtitle": "Project Hail Mary · ch. 12",
  "body": "Finish chapter 12. Mark done when finished.",
  "emoji": "📖",
  "themeColor": "#A78BFA",
  "imageUrl": "https://example.com/cover.jpg",
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
| `slot` | `0` or `1` only |
| `title` / `subtitle` / `body` | Copy |
| `emoji` / `themeColor` | Identity |
| `imageUrl` / `imageData` | Remote URL or small `data:image/...;base64,...` |
| `progress` | 0–100 |
| `ctaLabel` / `ctaLink` | Button + optional link |
| `meta` | Free JSON for your memory |
| `xpOnComplete` | Bonus XP (outside habit pool) |
| `webhookOnComplete` | POST to agent webhook on complete |
| `status` | `active` \| `done` \| `hidden` |

---

## 3. Webhooks (agent triggers)

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
  "ts": "2026-08-02T20:00:00.000Z",
  "card": {},
  "xpAwarded": 30,
  "note": null
}
```

Headers: `X-LifeOS-Event`, optional `X-LifeOS-Secret`.

---

## 4. Habits + daily XP redistribution

1. **`dailyXpTarget`** is a fixed pool (default 200).  
2. **New habits do not raise the pool** — `baseXp` is redistributed by `xpWeight`.  
3. **`extraXp`** is bonus outside the pool.  
4. Efficiency = today XP / target; improvement = vs yesterday. **No levels.**

```bash
GET/POST/PATCH/DELETE /api/v1/habits...
POST /api/v1/habits/:id/complete
POST /api/v1/habits/:id/undo
PATCH /api/v1/habits/:id/theme
POST /api/v1/habits/rebalance-xp
PATCH /api/v1/gamification/config
{ "dailyXpTarget": 200, "nurtureStyle": "plant" }
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

---

## 5. Quick log (reviews & tasks)

Flashes on the dashboard until complete. While any agent item is open, **habits hide** from Quick log (Habits tab still has them).

```bash
POST /api/v1/events
{ "kind": "review", "title": "Feynman: decoherence", "body": "3 sentences", "priority": 2 }

POST /api/v1/reviews
{ "prompt": "Active recall on chapter 4", "link": "obsidian://..." }
```

Kinds: `review` | `task` | `life` | `study` | `reminder` | `other`.

---

## 6. Study blocks & timeline

Agents own blocks; user starts/completes with real elapsed time.

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

Day timeline is a continuous color ribbon (0–24h, no black gaps).

---

## 7. Day boundary

```bash
PATCH /api/v1/settings
{ "dayResetTime": "04:00" }
```

All “today” stats use this, not midnight.

---

## 8. Suggested workflows

### Morning
1. `GET /api/v1/dashboard/today`
2. Inject light reviews / quests / events  
3. Update reading card  
4. Adjust blocks if schedule drifted  

### End of day (~23:30–01:00 local, or your night-owl window)
1. `GET /api/v1/dashboard/today` (+ vs-yesterday fields on payload)  
2. Scan study quality flags (`inspired` / `feynman`) and notes  
3. Check `special_event_candidates` via export if needed  
4. Escalate **only special** items to Obsidian (`state/days/…`)  
5. Inject tomorrow’s reviews / quests / cards  
6. Optionally tweak XP pool or habit themes  

### On webhook `card.complete`
1. Read `meta`  
2. Update your memory / vault  
3. `PATCH` card for next step or replace slot  
4. Optional celebration quest  

### Hermes automation (optional blueprint)
If your runtime supports skill blueprints/cron, schedule EOD against this skill’s end-of-day procedure. Installing a skill must **not** auto-create jobs without user accept.

### OpenClaw
Install/copy this skill directory under the workspace `skills/` root (or load from the Life OS repo path). Invoke with `/skill life-os` or natural language that matches the description. No separate OpenClaw skill file is required.

---

## 9. MCP (optional)

If `pnpm mcp` is running on the Life OS machine, tools such as `lifeos_list_habits`, `lifeos_get_today`, `lifeos_complete_habit`, etc. map to the same domain logic. Prefer HTTP when MCP tools lag (e.g. cards). Same SQLite file as the API.

| MCP tool (subset) | Role |
|-------------------|------|
| `lifeos_get_today` | Dashboard |
| `lifeos_list_habits` / create / update / delete / complete | Habits |
| `lifeos_inject_quest` / light review | Quick log |
| `lifeos_update_xp_rules` | Gamification config |
| `lifeos_update_settings` | Day reset, etc. |

---

## 10. Constraints

| Limit | Value |
|-------|--------|
| Dashboard cards | **2** slots |
| Auth | Mock admin or `API_TOKEN` |
| Levels / social | **None** |
| Obsidian writes from app | **Never** |

---

## 11. Pitfalls

- Calling create habit without redistribute can leave uneven `baseXp` — use `redistribute: true` or `POST .../habits/rebalance-xp`.  
- Raising habit count does **not** raise `dailyXpTarget` unless you PATCH gamification.  
- Webhooks are fire-and-forget; check logs if your endpoint is down.  
- `imageData` must stay small; prefer `imageUrl`.  
- Timeline Free/black gaps were fixed server-side; if you see holes, API may be stale — restart API.  

---

## 12. Verification

```bash
curl -s http://127.0.0.1:8787/health
curl -s http://127.0.0.1:8787/api/v1/dashboard/today \
  -H "Authorization: Bearer lifeos-local-agent-token" | head
curl -s -X POST http://127.0.0.1:8787/api/v1/cards \
  -H "Authorization: Bearer lifeos-local-agent-token" \
  -H "Content-Type: application/json" \
  -d '{"slot":0,"title":"Smoke test card","emoji":"✅"}'
```

Confirm the card appears on Overview and complete awards XP / webhook when configured.

---

## 13. Quick reference

| Goal | Call |
|------|------|
| Read day | `GET /api/v1/dashboard/today` |
| Reading card | `POST /api/v1/cards` slot 0 |
| Card done | user complete → webhook |
| New habit | `POST /api/v1/habits` + redistribute |
| Bonus habit | `extraXp` |
| Daily pool | `PATCH /api/v1/gamification/config` |
| Webhook | `PATCH /api/v1/settings` `{ agentWebhookUrl }` |

Keep friction low and dopamine honest. Full product context: `docs/LIFE_OS.md`. Implementation handoff: `docs/development_log.md`.
