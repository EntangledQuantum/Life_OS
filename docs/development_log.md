# Life OS — Development Log & Agent Handoff

**Last updated:** 2026-08-03  
**Repo:** https://github.com/EntangledQuantum/Life_OS  
**Status:** Phase 1 web MVP working locally; v0.3 pass shipped XP integrity, growth-meter rename, agent-setup cards, one-command setup, and a rebuilt landing page

**Read this file first** if you are a new human or coding agent picking up the project. Then read:

1. `docs/LIFE_OS.md` — product vision & data model (source of truth for *why*)  
2. `docs/skills/life-os/SKILL.md` — **single** agent skill (Hermes, OpenClaw, any long-running agent)  
3. `docs/API.md` — HTTP surface  
4. `docs/DATABASE.md` — how persistence works  
5. This log — *what was actually built, divergences, and gaps*

---

## 0. What changed in the v0.3 pass (2026-08-03)

| Area | Change |
|------|--------|
| **XP integrity (bug fix)** | `refreshTodaySnapshot()` only summed habit logs + study sessions. Card, agent-event, quest, and achievement XP called `addXp()` — raising lifetime `total_xp` — but **never appeared in today's XP, efficiency, the growth meter, or vs-yesterday**. All five sources now feed the daily snapshot. |
| **Pulse target** | `computeImprovementPulse()` was called without `recentTargets`, so "target met" used the library default (200) instead of the user's configured pool. Now passes the real target. |
| **Growth meter rename** | `nurtureStyle` (`plant`/`water`/`both`) → `growthStyle` (`sprout`/`orb`). "Water" collided with the drink-water habit. Legacy keys and values are accepted and mapped on read, write, and in `ensureSchema()` (which folds stored configs forward). |
| **Growth animation** | `NurtureVisual.tsx` deleted, replaced by `GrowthMeter.tsx`. The 100% state is now drawn as a ghost layer behind the live state, so remaining distance is always visible. Spring motion, animated wave crests on the orb, bloom + glow at full, reduced-motion respected. |
| **Agent-setup card** | New card `kind` (`task` \| `agent-setup`) and reserved singleton slot `2` that does **not** consume a content slot. Seeded with a "No agent connected" placeholder the agent replaces. |
| **Card SVG** | New `svg` field on cards. Sanitized server-side (`packages/shared/src/svg.ts`) and rendered through an `<img>` data URI, so it cannot execute script. Create responses return `svgNotes` listing anything stripped. |
| **XP discovery** | New `GET /api/v1/agent/xp-model` and MCP `lifeos_get_xp_model` return the rules **and** the live per-habit shares. `XP_MODEL_DOC` in `packages/shared/src/xp.ts` is the single source. |
| **Event XP** | `agent_events.xp_on_complete` added; completing an agent event now awards bonus XP and refreshes the snapshot. |
| **Status codes** | Habit complete now returns `409` for "already completed today" (was `200` with an error body) and `404` for unknown. Event complete returns `404` for unknown. |
| **MCP parity** | Added cards (incl. SVG + agent-setup), blocks, events, rebalance, and xp-model tools. Was HTTP-only for all of these. |
| **One-command setup** | `scripts/setup.mjs` → `pnpm setup`. Node version check, `.env` creation, install, migrate, seed. Idempotent; prompts before reseeding an existing DB and skips the prompt entirely when stdin is not a TTY. |
| **DB bootstrap** | `packages/db/src/bootstrap.ts`; the API now migrates on boot, so `pnpm dev` works on a fresh clone with no separate migrate step. |
| **Dashboard UI** | Agent cards are collapsible with a summary strip and persisted state (`AgentCardsSection.tsx`). Background replaced with a layered aurora + grain + vignette. |
| **Landing page** | Rewritten as a long scroll: hero with dashboard mock, three-layer diagram, feature vignettes, an interactive growth-meter demo, agent flow diagram, XP pool explainer, quick start, database section. All hand-built SVG, no external assets. |
| **Fresh clone was broken** | `pnpm-workspace.yaml` shipped pnpm 11's `allowBuilds` stub with the literal placeholder `set this to true or false`. On any machine without an existing install, `pnpm install` aborted with `ERR_PNPM_IGNORED_BUILDS` — so clone-and-run did not work at all. Now answered explicitly: `esbuild: true` (Vite needs its platform binary), `better-sqlite3: false` (transitive via drizzle-kit, unused at runtime, and building it needs VS C++ on Windows). Verified by copying the tree to a clean directory with no `.env` and no `data/` and running `pnpm setup` end to end. |
| **Typecheck (was broken)** | `pnpm typecheck` failed with 150+ errors. Fixed: `QualityFlag` imported from the wrong module in `xp.ts`; `apps/api` pinned drizzle `^0.41` while `packages/db` pinned `^0.44`, producing two copies and type-identity failures; `packages/mcp` had `rootDir: src` while importing from `apps/api`; untyped Hono context; a self-referential `cursor` inference in `computeStreaks`; and an intersection type that made `baseMultipliers` accidentally required. **All five packages now typecheck clean.** |

### Follow-up pass (same day)

| Area | Change |
|------|--------|
| **Sign-in removed from the flow** | Life OS is single-user and self-hosted, so `RequireAuth` now auto-signs-in with the mock credentials and drops straight into the app. `/login` still exists as a fallback for a customised `ADMIN_USER`/`ADMIN_PASS`. The header sign-out button is gone. Multi-user auth is explicitly **on hold**, and both the README and the landing page say so. |
| **GitHub Pages deploy** | Live at **https://entangledquantum.github.io/Life_OS/** (Pages source is set to GitHub Actions). `pnpm build:pages` builds a landing-page-only bundle (580 kB vs 1055 kB — the dashboard is not shipped) with `base=/Life_OS/`, plus `.nojekyll` and a `404.html` fallback. `.github/workflows/pages.yml` deploys it on push to `master`. Because a static host has no API or database, every "Open dashboard" affordance is hidden on that build and replaced with "Get started"; `IS_PAGES` in `apps/web/src/lib/deploy.ts` is the single switch. |
| **Positioning rewritten** | "Your execution layer. Not another guilt app." meant nothing to a first-time reader. Headline is now "An ADHD life manager your AI agent runs for you", with a subline that names what it tracks. The `local-first · agent-native` badge was removed. README rewritten to match. |
| **Three-layer diagram rebuilt** | Was one flat SVG with unreadable labels. Now real cards (`LayersStack.tsx`) with a proper Obsidian crystal mark, the Life OS brand icon, an agent orbit mark, colour spines, role labels, and tags. |
| **Agent brief on the landing page** | Replaced the curl-snippet block with a literal paste-into-your-agent brief: health check, permission-gated clone, `pnpm setup`, where the skill is, the XP discovery call, per-runtime notes for Hermes / OpenClaw / Claude Code, and the hard rules. |
| **Agent setup card shrunk** | Was a full-width card with a large graphic. Now a one-line status strip with a live/dead dot that expands on click. It sits outside the collapsible block, since status is always worth seeing. |
| **Header logo links home** | Clicking LIFE OS in the dashboard header returns to the landing page. |
| **Screenshots** | `pnpm screenshots` (`scripts/screenshots.mjs`) captures the README images from the running app in headless Chromium with reduced motion, so they are reproducible. Playwright is deliberately **not** a project dependency — install it only to recapture. |

### Naming migration cheat-sheet

| Old | New |
|-----|-----|
| `nurtureStyle` | `growthStyle` |
| `plant` | `sprout` |
| `water` | `orb` |
| `both` | `sprout` |
| `NurtureVisual` | `GrowthMeter` |

Old values still work everywhere; the dashboard payload also mirrors `growthStyle` into a
deprecated `nurtureStyle` field for any pre-rename client.

---

## 1. Original goals (what the user asked for)

### 1.1 Product intent (from `docs/LIFE_OS.md` + conversation)

- Build **Life OS**: execution/measurement layer for an ADHD-optimized personal OS.
- **Three layers:** Obsidian vault (brain) · **Life OS (this app)** · Hermes/agents (intelligence).
- Mundane completions live **only** in Life OS SQLite; app **never** writes to Obsidian.
- **Local-first**, self-hostable; later optional cloud storage (Supabase data only, not Auth).
- **Login mock** (username/password); **application data fully real**.
- ADHD-friendly: one-tap complete, forgiving streaks, gamification toggleable, **you vs yesterday only** (no social comparison).
- **Agents fully control** structure: habits, schedules, XP rules, quests, reviews, UI themes for habits, etc.
- Progress visuals: growing plant / filling water, etc., for “progress is happening.”
- Simple landing + login; rich dashboard.
- Settings for times, quiet hours, gamification, storage mode.
- Design handoff in `docs/design_handoff_lifeos_dashboard/` is **inspiration only**, not locked.
- Brand icon: `docs/icon.png` (square, transparent, no wordmark).
- Web app first (not Flutter for this phase), with a real backend so future mobile can talk to the same API.
- Research modern UI stacks (shadcn/Magic UI etc.); pick practical stack and ship.

### 1.2 User refinements during implementation (overrides / clarifications)

| Topic | Original / design handoff | What user required |
|-------|---------------------------|-------------------|
| Stack | Spec suggested Flutter | **Web + Node API only** for now |
| Levels | Spec had XP levels | **No levels** — efficiency % and improvement % only |
| Auth | Full later | Mock admin only |
| UI density | Card-heavy handoff | Open layout, less card chrome, no card glow |
| Typography | Space Grotesk / later Syne / Fraunces | **Figtree + JetBrains Mono** only (no display serif) |
| Timeline | Segments with gaps | **Solid continuous color bar** 0–24h (no black Free holes) |
| Study | Free-form log | **Agent-defined blocks** on timeline; user start/complete with real time |
| Quick log | Habits only | Agent reviews/tasks **on top**, flash until done; **hide habits** while agent queue non-empty |
| Day boundary | Midnight | **Custom day reset** (default 04:00) |
| Agent cards | Not in early MVP | Up to **2 agent custom front-page cards** + images + complete webhook |
| XP model | Per-habit fixed baseXp | **Fixed daily pool** redistributed by weight; **extraXp** bonus outside pool |
| Agent skill | Was split Hermes md + skill | **One** skill: `docs/skills/life-os/SKILL.md` (Hermes + OpenClaw compatible) |
| Repo | Local only | Private GitHub under EntangledQuantum |

### 1.3 Where we are vs original goals

| Goal | Status |
|------|--------|
| Spec-readable product | Done (LIFE_OS.md kept; implementation diverged on stack/levels) |
| Web MVP running | Done (`pnpm dev` → web :5173, API :8787) |
| Real local DB | Done (SQLite via `node:sqlite`) |
| Mock login | Done (`admin` / `lifeos`) |
| Habits one-tap + undo + streaks | Done |
| Today vs yesterday + Improvement Pulse | Done |
| Study as agent blocks + timer | Done (partial polish) |
| Goals light MVP | Done (basic) |
| Analytics | Done (basic) |
| Settings | Done (incl. day reset, webhook, theme) |
| Agent HTTP API | Done (broad surface) |
| MCP server | Scaffolded (`packages/mcp`) — **needs verification / card tools update** |
| Optional Supabase storage | UI + settings fields only — **not dual-driver complete** |
| Browser notifications | **Not done** |
| Flutter / mobile | Explicitly out of scope this phase |
| Full OpenAPI generator | Markdown API only |
| Automated tests | **None** |
| Production deploy | **Not done** |

---

## 2. Tech stack & architecture

### 2.1 Monorepo (pnpm workspaces)

```
life-os/
├── apps/web/          # Vite + React 19 SPA
├── apps/api/          # Hono HTTP server
├── packages/db/       # Drizzle schema, migrate, seed, SQLite client
├── packages/shared/   # Types, Zod schemas, XP/efficiency math
├── packages/mcp/      # MCP stdio (partial)
├── docs/              # Spec, skill, API, this log
├── data/              # lifeos.db (gitignored)
├── package.json
├── pnpm-workspace.yaml
└── README.md
```

### 2.2 Why these choices

| Decision | Choice | Rationale / tradeoff |
|----------|--------|----------------------|
| Not Flutter | React + Hono | User wanted web + reusable backend for future mobile |
| ORM | Drizzle + SQLite | Type-safe schema; matches “SQLite source of truth” |
| SQLite driver | Node built-in `node:sqlite` + better-sqlite3-shaped shim | **No native compile** on Windows/Node 25 (better-sqlite3 needs VS C++) |
| HTTP | Hono | Small, fast, typed, easy CORS |
| UI | Tailwind v4, custom CSS (minimal shadcn install) | Speed; Magic UI researched but not heavily installed |
| Charts | Recharts | Target vs current XP series |
| Motion | Motion (Framer) | Celebrations / light animation |
| State | TanStack Query + Zustand (UI theme only) | Server state via API |
| Fonts | Figtree + JetBrains Mono | User rejected geometric/serif “display” faces |
| Package manager | pnpm | Workspace monorepo |

### 2.3 Runtime requirements

- **Node.js 22.5+ recommended** (for `node:sqlite`); developed on Node **25.5**.
- `pnpm` 11.x  
- Default ports: API **8787**, web **5173** (Vite proxies `/api` → API)

### 2.4 Auth model

- **Mock only:** env `ADMIN_USER` / `ADMIN_PASS` (defaults `admin` / `lifeos`).
- Session token in `auth_sessions` table + Bearer header; cookie optional.
- Agents: `API_TOKEN` env bearer without login.
- **No** OAuth, multi-user, or Supabase Auth.

### 2.5 Data / day boundary

- All “today” windows use **`dayResetTime`** from settings (default `04:00`), via `getDayBounds()` in `@life-os/shared`.
- Timestamps stored UTC ISO; display local.

---

## 3. Features implemented (detail)

### 3.1 Public surfaces

- **Landing** (`/`) — brand icon, pitch, CTA to login  
- **Login** (`/login`) — mock form  
- **App shell** (`/app/*`) — nav: Overview, Habits, Study, Goals, Analytics, Settings  
- Efficiency chip in header (not level)  
- Notification badge count for pending agent queue items  

### 3.2 Overview (open layout, no heavy cards)

- Masthead: Improvement Pulse word + explanation + efficiency/improvement % + live clock/timer  
- **Today vs yesterday** metric rail (habits, XP, efficiency, study, sleep)  
- **Agent cards** (up to 2) — image, body, progress, complete → XP + webhook  
- **Right Now** activity pills + elapsed timer  
- **Day timeline** — continuous solid color ribbon 0–24h (gaps snapped, no Free black holes)  
- **Nurture** plant/water visual for daily XP target progress  
- **Quick log**  
  - Pending light reviews + agent events first (flash until complete)  
  - Habits only when agent queue empty  
- XP chart: target vs current (7 days)  

### 3.3 Habits

- List, complete, undo  
- Themes: emoji, color, graphic type (`ring` / `liquid` / etc.)  
- Streaks (forgiving: history preserved)  
- Create/edit primarily agent-side (UI create removed from Habits page)  
- **XP:** `baseXp` from redistributed pool; `extraXp` bonus; `xpWeight` for share  

### 3.4 Study

- Agent-defined schedule blocks (category Study)  
- User **Start** → active session + Right Now  
- User **Complete** → real duration logged as study session + XP  

### 3.5 Goals / Analytics / Settings

- Goals: simple CRUD-ish list with progress  
- Analytics: efficiency, XP series, category consistency, achievements  
- Settings: day shape, day reset, gamification toggles, celebration intensity, accent theme (Nebula/Quantum/Terminal/Ember), nurture plant/water, storage mode UI, **agent webhook URL/secret**, export JSON  

### 3.6 Agent surface (HTTP)

Documented in `docs/API.md` and skill. Includes:

- Auth, dashboard, habits (+ rebalance-xp), blocks, study, goals  
- Events, reviews, quests, achievements  
- **Cards** CRUD + complete  
- Gamification config, settings, export, capabilities  

### 3.7 Webhooks

- `fireAgentWebhook` on habit complete and card complete  
- Payload: `source: life-os`, `event`, `ts`, entity data  
- Headers: `X-LifeOS-Event`, `X-LifeOS-Secret`  

### 3.8 MCP

- `packages/mcp` stdio server wrapping some services  
- **Not fully updated** for cards / latest schemas — verify before relying on it  

### 3.9 Hermes skill

- Path: **`docs/skills/life-os/SKILL.md`**  
- Frontmatter `name: life-os`  
- Full connect, cards, XP redistribute, webhooks, workflows  

---

## 4. XP model (current truth)

```
dailyXpTarget  (fixed pool, agent-editable, default 200)
      │
      ├── redistribute by xpWeight across active habits → habit.baseXp
      │
      └── habit.extraXp  (optional bonus, NOT from pool)

On habit complete: award baseXp * multipliers + extraXp
On card complete:  award card.xpOnComplete (bonus, not from habit pool)

efficiencyPct  = todayXpEarned / dailyXpTarget
improvementPct = today efficiency − yesterday efficiency
```

**No levels.** Spec levels were removed by user request.

Rebalance triggers: habit create/delete (default), `POST /habits/rebalance-xp`, dailyXpTarget patch.

---

## 5. Database tables (SQLite)

Core (from schema + ensure-schema additive columns):

| Table | Role |
|-------|------|
| `habits` | Habit definitions + theme + baseXp/extraXp/xpWeight |
| `habit_logs` | Completions with xp_awarded, source user\|agent |
| `sleep_logs` | Sleep quality / times |
| `schedule_blocks` | Agent day blocks (planned + actual + status) |
| `study_sessions` | Logged study (often from block complete) |
| `goals` / `goal_habit_links` | Light goals |
| `light_reviews` | Agent light reviews (Quick log) |
| `agent_events` | Agent tasks/reminders (Quick log) |
| `dashboard_cards` | Max 2 front-page agent cards |
| `achievements` | Badges |
| `user_progress` | total_xp, pulse (level column legacy unused for UI) |
| `quests` | Optional challenges |
| `daily_snapshots` | Day aggregates for vs-yesterday |
| `gamification_config` | JSON config (dailyXpTarget, growthStyle, multipliers) |
| `settings` | Day reset, quiet hours, theme, webhook, storage mode |
| `active_sessions` | Right Now timer |
| `auth_sessions` | Mock login tokens |
| `special_event_candidates` | Escalation candidates for Hermes |

Migrations: Drizzle `packages/db/drizzle/` + runtime **`ensureSchema()`** for additive columns (Windows-friendly without full remigrate pain).

---

## 6. File map (what each file does)

### Root

| File | Purpose |
|------|---------|
| `package.json` | Workspace scripts: dev, db:*, mcp |
| `pnpm-workspace.yaml` | apps/* + packages/*; onlyBuiltDependencies esbuild |
| `README.md` | Quick start, stack, agent pointer |
| `.env.example` | Admin, ports, token, DB path |
| `.gitignore` | node_modules, .env, data/*.db, dist |
| `docs/development_log.md` | **This file** |

### `apps/api`

| File | Purpose |
|------|---------|
| `src/index.ts` | Boot ensureSchema, open DB, serve Hono |
| `src/app.ts` | All routes under `/api/v1`, CORS, errors |
| `src/env.ts` | dotenv from monorepo root |
| `src/middleware/auth.ts` | Bearer / cookie session or API_TOKEN |
| `src/services/auth.ts` | Mock login, sessions |
| `src/services/habits.ts` | Habit CRUD, complete/undo, rebalance XP, webhook on complete |
| `src/services/blocks.ts` | Schedule blocks, start/complete study path |
| `src/services/study.ts` | Study session logs + quality flags |
| `src/services/cards.ts` | Dashboard cards max 2, complete + XP + webhook |
| `src/services/events.ts` | Agent events for Quick log |
| `src/services/quests.ts` | Quests + light reviews |
| `src/services/goals.ts` | Goals CRUD light |
| `src/services/achievements.ts` | Unlock checks |
| `src/services/dashboard.ts` | Compose dashboard + **timeline continuous strip** |
| `src/services/snapshots.ts` | Daily snapshots, vs-yesterday, XP series, pulse |
| `src/services/settings.ts` | Settings + gamification config + webhook fields |
| `src/services/webhook.ts` | POST to agent webhook |
| `src/services/helpers.ts` | Day bounds, mapHabit, load config, addXp |

### `apps/web`

| File | Purpose |
|------|---------|
| `src/main.tsx` | Router, QueryClient, Toaster |
| `src/index.css` | Figtree/Mono, tokens, open layout helpers, quicklog flash |
| `src/components/AppShell.tsx` | Nav, efficiency chip, pending badge |
| `src/components/AgentCard.tsx` | Renders agent dashboard card |
| `src/components/HabitCard.tsx` | Habit UI (used Habits page; Overview uses HabitRow) |
| `src/components/graphics/GrowthMeter.tsx` | Growth meter (sprout/orb) with ghosted 100% overlay |
| `src/components/AgentCardsSection.tsx` | Collapsible agent-card block with summary strip |
| `src/components/AgentSetupCard.tsx` | Agent-setup card (slot 2) incl. sandboxed SVG |
| `src/components/landing/Reveal.tsx` | Scroll-reveal wrapper, section heading, copyable code block |
| `src/components/landing/illustrations.tsx` | All landing-page SVG art |
| `src/lib/useReveal.ts` | IntersectionObserver reveal hook |
| `src/components/graphics/*` | Legacy ring/tree/liquid (partially superseded) |
| `src/pages/OverviewPage.tsx` | Main open dashboard |
| `src/pages/HabitsPage.tsx` | Habits complete-only UI |
| `src/pages/StudyPage.tsx` | Agent blocks start/complete |
| `src/pages/GoalsPage.tsx` | Light goals |
| `src/pages/AnalyticsPage.tsx` | Charts + achievements |
| `src/pages/SettingsPage.tsx` | Times, gamification, theme, storage, webhook |
| `src/pages/LandingPage.tsx` / `LoginPage.tsx` / `RequireAuth.tsx` | Public + gate |
| `src/lib/api.ts` | Fetch helpers |
| `src/lib/store.ts` | Accent/celebration UI store |
| `src/lib/celebrate.ts` | Confetti |
| `public/icon.png` | Brand |

### `packages/shared`

| File | Purpose |
|------|---------|
| `src/types.ts` | Domain TypeScript types |
| `src/schemas.ts` | Zod request schemas |
| `src/constants.ts` | Categories, themes, seed habit defaults |
| `src/xp.ts` | redistributeDailyXp, awardXp, efficiency, day bounds, pulse |

### `packages/db`

| File | Purpose |
|------|---------|
| `src/schema.ts` | Drizzle table definitions |
| `src/client.ts` | node:sqlite + better-sqlite3-compatible shim for Drizzle |
| `src/ensure-schema.ts` | ALTER TABLE / CREATE missing tables |
| `src/migrate.ts` | drizzle migrate + ensureSchema |
| `src/seed.ts` | Default habits, blocks, achievements, sample card/events |
| `drizzle/*` | Generated SQL migration |

### `packages/mcp`

| File | Purpose |
|------|---------|
| `src/index.ts` | Stdio MCP tools (habits, dashboard, etc.) — **cards tools not fully synced** |

### `docs`

| File | Purpose |
|------|---------|
| `LIFE_OS.md` | Original full product spec (Flutter/levels may disagree with code) |
| `API.md` | HTTP reference |
| `skills/life-os/SKILL.md` | **Only** agent skill (HTTP + EOD + webhooks + MCP notes) |
| `design_handoff_lifeos_dashboard/*` | Inspiration HTML prototype |
| `icon.png` | Brand |
| `development_log.md` | This handoff log |

---

## 7. Git history (high level)

| Commit | Topic |
|--------|--------|
| `434b79b` | Initial monorepo MVP (API, web, seed, docs) |
| `6a95502` | Continuous day timeline (no black Free gaps) |
| `03b1d7d` | Agent cards, webhooks, XP redistribution, skill |
| `332d966` | README skill link |

Branch: `master` → `origin/master` on GitHub private repo.

---

## 8. Challenges & tradeoffs

1. **better-sqlite3 vs Node 25 on Windows**  
   Native build needs Visual Studio C++. Solved with **`node:sqlite` + API-compat shim** so Drizzle’s better-sqlite3 dialect still works. Experimental Node API; pin Node carefully.

2. **Spec vs user direction**  
   LIFE_OS.md still mentions Flutter, levels, Drift. Code intentionally diverged. Prefer **code + this log + skill** over outdated sections of the spec.

3. **Timeline “black gaps”**  
   First fix filled gaps with dark Free color (looked black). Final fix: **snap segment boundaries** and paint only category colors end-to-end.

4. **UI iteration**  
   Handoff was card-heavy/minimal techno. User wanted less flat fonts, no glow, open layout, agent-first Quick log. Overview is open; Settings still uses light bordered panels for forms.

5. **Drizzle dual SQLite/Postgres for Supabase**  
   Not finished. Settings fields exist; provider switch is incomplete.

6. **MCP lag**  
   HTTP is source of truth for agents; MCP package may miss cards/webhooks.

7. **No automated tests**  
   Manual curl/UI verification only.

8. **pnpm ignored build scripts**  
   Needed `onlyBuiltDependencies` for esbuild; better-sqlite3 abandoned for runtime.

---

## 9. Not finished / known gaps

### Product (from LIFE_OS.md Phase 1–2)

- [ ] Real multi-user / real auth  
- [ ] Full Supabase Postgres driver path (dual storage)  
- [ ] Browser push notifications  
- [ ] Rich sleep logging UI  
- [ ] “What went wrong” reflection flow  
- [ ] Full goal hierarchy (Dream → projects)  
- [ ] OpenAPI machine-readable spec  
- [ ] Unit/integration tests  
- [ ] Mobile clients  

*(MCP/HTTP parity was closed in v0.3.)*

### Technical debt

- [ ] `user_progress.current_level` still in schema (legacy; UI ignores levels)  
- [ ] Some graphics components (`XpRing`, `GrowthTree`) partially orphaned  
- [ ] Settings gamification config patch uses rebalance via import — watch circular deps  
- [ ] Card `imageData` size limits not enforced hard beyond Zod max  
- [ ] Seed uses life-day date from local midnight in one place vs dayResetTime — verify for night-owl edge cases  
- [ ] Complete card webhook is async in habits (void fire); cards await — unify pattern  
- [ ] Typecheck not run in CI (it now **passes** cleanly across all 5 packages — worth wiring up)  
- [ ] `packages/mcp` imports API service source across package boundaries; `rootDir` had to be dropped. Long term it should call the HTTP API or the services should move into a shared package  
- [ ] `getXpSeries` uses the *current* `dailyXpTarget` for historical days rather than the target stored on each snapshot  
- [ ] `GET /api/v1/session/active` composes the whole dashboard just to read one row  

### UX polish still soft

- [ ] Empty states for no timeline blocks  
- [ ] Card “reactivate” / reset from done for next day  
- [ ] Agent events complete → optional XP  
- [ ] Habits page bulk theme tools  

---

## 10. How to run (next agent)

```bash
git clone https://github.com/EntangledQuantum/Life_OS.git
cd Life_OS
# Node 22.5+
pnpm setup     # .env + install + database + migrations + seed (idempotent)
pnpm dev
```

The API also bootstraps the database on boot, so `pnpm dev` alone works on a fresh clone.

- Web: http://127.0.0.1:5173  
- API: http://127.0.0.1:8787  
- Login: `admin` / `lifeos`  
- Agent: `Authorization: Bearer lifeos-local-agent-token`  

Give any agent (Hermes, OpenClaw, …): **`docs/skills/life-os/SKILL.md`** only.

---

## 11. Conventions for future agents

0. **Any new XP source must be added to `refreshTodaySnapshot()`**, not just `addXp()` — otherwise it silently misses today's efficiency and the growth meter.  
1. **Do not reintroduce levels** or social comparison.  
2. **Agents customize structure; users complete.** Prefer API over large user forms.  
3. **Max 2 dashboard cards.**  
4. **New habits → redistribute XP**, don’t inflate daily target unless agent explicitly raises `dailyXpTarget`.  
5. **App never writes Obsidian.**  
6. Prefer `ensureSchema()` for additive SQLite columns on Windows.  
7. Overview stays open/layout-light; don’t force everything into glowing cards.  
8. Timeline must remain a **solid continuous ribbon**.  
9. Update **this log** when you ship significant features.  
10. Push private GitHub `master` after meaningful work.

---

## 12. Environment variables (reference)

| Variable | Default | Role |
|----------|---------|------|
| `ADMIN_USER` | admin | Mock login |
| `ADMIN_PASS` | lifeos | Mock login |
| `API_PORT` | 8787 | API port |
| `API_HOST` | 127.0.0.1 | Bind |
| `API_TOKEN` | lifeos-local-agent-token | Agent bearer |
| `SESSION_SECRET` | (dev) | Session signing (if used) |
| `DATABASE_PATH` | ./data/lifeos.db | SQLite file |
| `STORAGE_MODE` | local | local \| supabase (partial) |
| `SUPABASE_URL` / `KEY` | — | Optional remote (incomplete) |
| `VITE_API_URL` | empty | Web uses Vite proxy if empty |

---

## 13. Conversation arc (condensed)

1. Plan from LIFE_OS.md + design handoff + Firecrawl research → monorepo plan.  
2. Scaffold API/web/db/shared/mcp; seed; mock auth.  
3. Dashboard features, gamification, analytics.  
4. User feedback: icon size, timeline empty height, no levels, fonts, no card glow.  
5. Open dashboard redesign.  
6. Timeline black Free gaps → solid snap colors.  
7. Quick log agent-first + flash.  
8. Agent cards (max 2) + webhooks + XP redistrib + skill.  
9. Private GitHub + README.  
10. **This development log** for full handoff.  
11. Icon resync to web; collapsed Hermes md into single `SKILL.md` for all agents.

---

## 14. Suggested next work (priority)

1. Day-rollover job: reset done cards / inject tomorrow from agent.  
2. Tests for `redistributeDailyXp`, snapshot XP aggregation, SVG sanitizing, and timeline continuity.  
3. CI: typecheck + seed smoke on PR (typecheck is green now, so this is cheap to add).  
4. Complete the Supabase storage adapter or remove the Settings UI until it is real.  
5. Align `LIFE_OS.md` (still mentions Flutter and levels) with the shipped product.  
6. Browser notifications for quiet-hours-aware reminders.

---

**End of development log.**  
If anything in code conflicts with `LIFE_OS.md`, prefer **running code + this log + `docs/skills/life-os/SKILL.md`**, then update the spec.
