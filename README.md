# Life OS

**ADHD-friendly execution layer** for habits, study blocks, sleep rhythms, personal progress, and **agent control** (Hermes / MCP / any OpenClaw-style agent).

Local-first. Mock login. Real data. No social comparison — only **you vs yesterday**.

---

## What it is

| Layer | System | Owns |
|-------|--------|------|
| Permanent brain | Obsidian Learning Vault (Hermes) | Knowledge, special memories |
| **Execution OS** | **This app** | Completions, streaks, XP targets, day timeline, efficiency |
| Intelligence | Hermes / MCP agents | Habits, study blocks, quests, reviews, XP rules |

The app **never writes to Obsidian**. Agents read Life OS and escalate only what is special.

---

## Features

- **Open dashboard** — no heavy card chrome; metric rails + live timer
- **Continuous day timeline** — agent schedule fills 0–24h (gaps = Free, not black holes)
- **Quick log**
  - Agent revisions / reviews / tasks appear **on top** and **flash until complete**
  - Completions stored in SQLite (`agent_events`, `light_reviews`) for later retrieval
  - Habits show here only when the agent queue is empty (Habits tab always available)
- **Right Now** — clock + elapsed timer for current activity
- **Nurture visuals** — plant or water fill for daily XP target vs current (no levels)
- **Efficiency %** and **improvement %** vs yesterday
- **Custom day reset** (default `04:00`, night-owl friendly)
- **HTTP API + MCP** for full agent control
- **Local SQLite** via Node `node:sqlite` (optional Supabase storage mode in Settings)

---

## Stack

| Piece | Choice |
|-------|--------|
| Web | Vite · React 19 · Tailwind v4 · Figtree · JetBrains Mono |
| API | Hono · Zod · TypeScript |
| DB | Drizzle ORM · SQLite (`node:sqlite`) |
| Agents | REST `/api/v1` · MCP stdio (`pnpm mcp`) |

---

## Quick start

**Requirements:** Node.js **22.5+** (built-in SQLite) or **25+**, [pnpm](https://pnpm.io).

```bash
git clone <your-repo-url> Life_OS
cd Life_OS
cp .env.example .env
pnpm install
pnpm db:migrate
pnpm db:seed
pnpm dev
```

| Service | URL |
|---------|-----|
| Web | http://127.0.0.1:5173 |
| API | http://127.0.0.1:8787 |

**Mock login:** `admin` / `lifeos`  
(change in `.env`: `ADMIN_USER`, `ADMIN_PASS`)

---

## Scripts

| Command | Description |
|---------|-------------|
| `pnpm dev` | API + web together |
| `pnpm dev:api` | API only (`:8787`) |
| `pnpm dev:web` | Vite only (`:5173`) |
| `pnpm db:generate` | Drizzle migrations from schema |
| `pnpm db:migrate` | Apply migrations + ensure columns |
| `pnpm db:seed` | Seed habits, blocks, achievements, sample agent tasks |
| `pnpm mcp` | MCP server (stdio) for Hermes / Claude / Cursor |

---

## Agent integration

**Full skill for Hermes / any agent:** [`docs/skills/life-os/SKILL.md`](docs/skills/life-os/SKILL.md)

Copy or point your agent at that skill so it can create front-page cards, rebalance XP, inject reviews, and receive webhooks.

### HTTP

```bash
# Session login
curl -s -X POST http://127.0.0.1:8787/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"lifeos"}'

# Or API_TOKEN from .env
curl -s http://127.0.0.1:8787/api/v1/dashboard/today \
  -H "Authorization: Bearer lifeos-local-agent-token"
```

Useful endpoints:

- `POST /api/v1/events` — inject revision/task (shows in Quick log, flashes until done)
- `POST /api/v1/reviews` — light review prompts
- `POST /api/v1/blocks` — study/life timeline blocks (agent-owned)
- `POST /api/v1/habits` · `.../complete` — habits
- `PATCH /api/v1/gamification/config` — `dailyXpTarget`, `nurtureStyle` (`plant` \| `water`)
- `PATCH /api/v1/settings` — `dayResetTime`, quiet hours, theme
- `GET /api/v1/export/json` — full dump

See [`docs/API.md`](docs/API.md) and the unified agent skill [`docs/skills/life-os/SKILL.md`](docs/skills/life-os/SKILL.md) (Hermes, OpenClaw, or any long-running agent).

### MCP

```bash
pnpm mcp
```

Tools include habit CRUD/complete, blocks, events, reviews, dashboard, XP rules, settings.

---

## Project layout

```
apps/web/          React SPA
apps/api/          Hono API + domain services
packages/db/       Schema, migrations, seed, SQLite client
packages/shared/   Types, Zod schemas, XP/efficiency math
packages/mcp/      MCP stdio server
docs/              Spec (LIFE_OS.md), design handoff, API notes
data/              Local SQLite file (gitignored)
```

---

## Spec & design

- **Handoff log (read first for agents):** [`docs/development_log.md`](docs/development_log.md)
- Full product rules: [`docs/LIFE_OS.md`](docs/LIFE_OS.md)
- Agent skill: [`docs/skills/life-os/SKILL.md`](docs/skills/life-os/SKILL.md)
- Design handoff (inspiration only): [`docs/design_handoff_lifeos_dashboard/`](docs/design_handoff_lifeos_dashboard/)
- Brand icon: [`docs/icon.png`](docs/icon.png)

**Product notes**

- Login is mock; application data is real and local.
- No levels — efficiency and improvement percentages only.
- Users complete and report; agents customize structure.
- Mundane logs stay in Life OS; special moments go to Obsidian via Hermes only.

---

## Environment

Copy `.env.example` → `.env`:

```env
ADMIN_USER=admin
ADMIN_PASS=lifeos
API_PORT=8787
API_TOKEN=lifeos-local-agent-token
DATABASE_PATH=./data/lifeos.db
STORAGE_MODE=local
```

---

## License

Private repository. Intended for personal / open-source evolution per `LIFE_OS.md` § open-source intent when you choose to publish.
