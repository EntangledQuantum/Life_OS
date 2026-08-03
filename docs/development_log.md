# Life OS — Development Log & Agent Handoff

**Last updated:** 2026-08-03  
**Repo:** https://github.com/EntangledQuantum/Life_OS  
**Status:** Phase 1 web MVP working locally; v0.4 shipped the flexible agentic pipeline — agent-owned settings and setup, scheduled/reminder cards with spaced repetition, agent-defined properties, condition-driven goals with must-be-seen celebrations, and automatic database backups. v0.4.1 added the Timeline tab, compacted the dashboard, and made the whole thing reachable over the LAN

**Read this file first** if you are a new human or coding agent picking up the project. Then read:

1. `docs/LIFE_OS.md` — product vision & data model (source of truth for *why*)  
2. `docs/skills/life-os/SKILL.md` — **single** agent skill (Hermes, OpenClaw, any long-running agent)  
3. `docs/API.md` — HTTP surface  
4. `docs/DATABASE.md` — how persistence works  
5. `docs/NETWORK.md` — LAN access and what it exposes  
6. `docs/CLIENT_GUIDE.md` — building a second frontend (mobile app, widget, TUI)  
7. This log — *what was actually built, divergences, and gaps*

---

## 0. What changed in the v0.4.1 pass (2026-08-03)

Follow-up to v0.4, driven by using it: the Upcoming section was too heavy, and the app needed
to be reachable from a phone.

| Area | Change |
|------|--------|
| **Up next is a list, not a grid** | Scheduled cards were tall panels stacked two-across, which turned the dashboard back into a to-do list. Now one compact row each: emoji, title + tag, time, XP, actions. |
| **The left glow is gone** | Each card had a coloured spine glowing down its left edge. Colour now lives in the tag text and (on the Timeline) a hairline rail, not a wash behind the row. |
| **"Done · +25 XP" was a lie** | It looked like a second primary button competing with Start. XP is a *reward*, not an action, so it is now green `+25 XP` text in the meta row, and completing is a small check icon. Start is the only real button. |
| **Dashboard shows 15 minutes** | `isCardImminent()` in `packages/shared/src/schedule.ts`; `dashboard.upcoming` now returns only cards due within 15 minutes, overdue, or already pinged. `dashboard.scheduled` (new) carries the full list. The dashboard answers "what am I doing now" — a card three hours out is planning, not doing. |
| **New Timeline tab** | `apps/web/src/pages/TimelinePage.tsx` at `/app/timeline`: today's shape as a colour ribbon with a live now-marker and the block list, then every scheduled card grouped by day (Today / Tomorrow / weekday) in a calendar-style agenda with a time gutter. Plus a "Done today" tail. |
| **Dashboard reordered** | Up next moved to the bottom. Order is now: pulse header → today vs yesterday → agent cards → right now → day timeline → growth + quick log + XP chart → up next. |
| **LAN access** | `API_HOST=0.0.0.0` now works end to end. New `apps/api/src/net.ts` replaces the hard-coded CORS origin list with a policy that allows **loopback and RFC1918 origins on any port** and requires anything public to be named in `CORS_ORIGINS`. A wildcard would have let any page the user happens to be browsing talk to their instance. Vite binds all interfaces and proxies `/api` same-origin, which is what makes a phone work with zero configuration. The boot banner prints the reachable addresses and states plainly what is exposed. |
| **`/health` reports its reach** | Now returns `host` and `lan`, so a phone or a future native client can confirm it hit the right box. |
| **`VITE_API_URL` must be empty** | `.env.example` used to hard-code `http://127.0.0.1:8787`, which breaks LAN access silently — the phone tries *its own* loopback and the app looks dead. Now empty by default with the reason written down. |
| **`docs/NETWORK.md`** | How to turn it on, why `VITE_API_URL` stays empty, the CORS table, firewall notes, and an honest section on what LAN exposure actually means (one shared token, no rate limiting, plain HTTP — fine for home Wi-Fi, not for anything else, use a VPN for remote). |
| **`docs/CLIENT_GUIDE.md`** | Written for an agent building a *second* frontend — a native app, widget, TUI. Connect + auth, the `dashboard/today` payload field by field, what each surface means, and the five behavioural contracts a client can silently break: the life-day boundary, celebration-before-achieved, fire-once reminders, the fixed XP pool with no levels, and honouring `reducedMotion` / `celebrationIntensity`. Ends with a parity checklist and an explicit "what not to build" (no goal-creation UI, no leaderboards, no telemetry, no vault writes). |

Verified live: the API bound `0.0.0.0` and printed `192.168.29.131:8787`; a preflight from
`http://192.168.29.131:5173` came back with a matching `access-control-allow-origin`, while one
from `https://evil.example.com` got **no** allow-origin header. Dashboard shows exactly one
imminent row with `+3 later · timeline →`; the Timeline tab renders four items across the day
with tags, repeat badges, reminder bells and the ribbon.

---

## 0.0 What changed in the v0.4 pass (2026-08-03)

The theme of this pass: **make the agentic pipeline open-ended.** Before it, an agent could
only manipulate concepts the app already knew about. Now it can invent its own values, write
its own success conditions against them, and schedule things into the future.

### 0.1 Agents own the settings and the setup

`lifeos_update_settings` previously exposed six of twenty-five fields. It now exposes all of
them, and the skill says so in as many words — agents were being unnecessarily timid about
tuning an instance they are supposed to own.

New `POST /api/v1/agent/setup` (`lifeos_setup_instance`) reshapes a fresh clone in one call:
replace or add habits, set the XP pool and growth style, set wake/sleep/quiet hours, and
publish the setup card. Composed from the existing services, so there is no second source of
truth — see `apps/api/src/services/setup.ts`.

### 0.2 Scheduled cards: events, reminders, spaced repetition

Cards gained two kinds, `event` and `reminder`, which are **unpinned** (`slot: -1`) and live
in a new Upcoming rail. This was the key design call: reminders must not compete for the two
front-page slots, or queueing a week of reviews would evict whatever the user actually needs
to see today. A card sent with `eventAt`/`remindAt` but no `kind` is coerced to scheduled
rather than silently evicting a pinned card.

Three instants, with an ordering rule the server enforces:

```
showAt   <=   remindAt   <   eventAt
(appears)     (chimes)       (happens)
```

The rule is *the user is always told about a thing before the thing*. A reminder at or after
its own event returns `400` naming the violated leg, rather than being quietly reordered — an
agent that gets this wrong should find out at call time, not at 3am when the chime never came.
`PATCH` re-validates the **resulting** schedule, not just the patched fields, because moving
`eventAt` earlier can invalidate a `remindAt` that was already stored; a changed instant also
re-arms `notifiedAt`.

`activityTag` is a **closed set**: `Deep Work · Study · Sleep · Exercise · Break · Life Admin ·
Exploration`. Agents may invent any content but must map it onto a day shape the timeline
already understands, which is what makes "read a chapter" tagged `Study` auto-activate the
Study bucket when started. `Exploration` is new — the creative/curiosity bucket, so play does
not have to masquerade as Deep Work.

`repeatRule: "spaced"` walks `1, 3, 7, 14, 30, 60` days on each completion (overridable via
`repeatOffsetsDays`), preserving the lead times between the three instants. Completing a
repeating card inserts the next occurrence as a **new** row and leaves the completed one as
`done` — rewinding the same row would have destroyed the completion record that daily XP and
`cards_completed` are counted from.

### 0.3 Agent-defined properties

New `agent_properties` table and service. An agent defines a counter (`books_read`), pushes to
it, and writes goals against it. Each property has a stable `uid` separate from its
human-readable `key`, so external records survive a relabel.

Incrementing an **undefined** key auto-defines it as a counter instead of failing. That was a
deliberate choice: the failure mode of the strict version is a lost increment and a goal that
then quietly never fires, which is far worse than an extra row. Redefining an existing key
returns `409` rather than silently overwriting.

### 0.4 Goals are the agent's job, and "met" is not "finished"

Goals now carry a machine-checkable condition (`packages/shared/src/conditions.ts`): a small
DSL of `property` / `metric` / `all` / `any` nodes with the usual comparison operators, over
windows of `all | 7d | 30d | 90d | year`. Invalid conditions return **every** problem at once
rather than zod's first-failure union noise, so one round-trip is enough to fix them.

Evaluation runs from a Hono middleware after **any** successful non-`GET` request, and after
any mutating MCP tool. The hook lives at the middleware rather than inside each service so a
new endpoint gets goal checking for free instead of silently not having it. That is the
contract the skill advertises: any change to the database can complete a goal.

The important semantic: crossing the line stamps `conditionMetAt` but **deliberately leaves
`status: "active"`**. `status: "achieved"` is only reachable through
`POST /api/v1/goals/:id/celebration-seen`, which the dashboard calls after the user dismisses
the full-screen animation. A goal the user never saw complete has not, as far as this product
is concerned, completed. `createGoal`/`updateGoal` do not accept `"achieved"` as input.

`GoalsPage` was rewritten read-only to match: the user does not type in goals. Deciding what to
want is exactly the executive-function tax the app exists to remove.

### 0.5 Reminders that actually land

`apps/web/src/lib/notify.ts` synthesizes the chime with WebAudio rather than shipping an audio
file — nothing to 404, no extra request, and it works identically on the Pages build. Browsers
block audio until a gesture, so the context is armed on first click/keypress and the visual
channel never depends on the audio one succeeding.

`ReminderRunner` is headless and consumes the server's `dueReminders`. The server owns *whether*
a reminder is due (it has the clock and the once-only flag); the client only decides *how* it
lands: chime, accent wash across the viewport, flashing tab title, and an OS notification when
permitted. It POSTs `/cards/:id/notified` immediately so a refresh or second tab cannot replay
it, while the card keeps pulsing in the rail until it is dealt with — being told about a thing
is not the same as doing it.

### 0.6 Database backups

`packages/db/src/backup.ts` uses SQLite `VACUUM INTO`, which writes a consistent, compacted
copy while the database is open — unlike a file copy, which can catch a half-written WAL.
Snapshots land in `data/backups/` (now gitignored) and are pruned oldest-first to `backupKeep`.

The scheduler polls every 15 minutes and compares against `lastBackupAt` rather than sleeping
for the whole interval. Two reasons: the interval is a live setting that can change underneath
a long timer, and a laptop that suspends never fires one at all. The `lastBackupAt` comparison
also means a machine asleep for two days takes one snapshot on wake, not the dozen it "missed".

### 0.7 Verification

29/29 end-to-end assertions passed against a running API, including: the goal reaching 33% on
one increment then metering to met; the goal staying `active` while pending and only flipping
to `achieved` after `celebration-seen`; `remindAt` after `eventAt` rejected; `activityTag:
"Vibes"` rejected; scheduled cards not consuming pinned slots; a due reminder appearing and
then not reappearing after `/notified`; `start` creating a Study block and running session;
a spaced completion scheduling the next rung at +1 day; and a 196 KB snapshot appearing.
The boot scheduler was verified by backdating `lastBackupAt` and restarting — it fired and
logged, and correctly skipped when not due. MCP went 30 → **53 tools**, verified over stdio.
All five packages typecheck clean and the web app builds.

---

## 0.8 What changed in the v0.3 pass (2026-08-03)

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
12. v0.3: XP integrity fix, growth-meter rename, one-command setup, rebuilt landing page,
    GitHub Pages deploy, profile card SVG.  
13. v0.4: agent-owned settings + one-call setup, scheduled/reminder cards with spaced
    repetition and the `showAt ≤ remindAt < eventAt` rule, the `Exploration` day bucket,
    agent-defined properties, condition-driven goals whose celebration must be seen, and
    automatic database backups.

---

## 14. Suggested next work (priority)

1. Tests for `redistributeDailyXp`, snapshot XP aggregation, SVG sanitizing, timeline
   continuity, `validateCardSchedule`, and `evaluateCondition`. The smoke script in this
   pass covers the behaviour end-to-end but nothing is pinned at unit level yet.
2. CI: typecheck + seed smoke on PR (typecheck is green now, so this is cheap to add).
3. Day-rollover job: reset done cards / inject tomorrow from agent.
4. Respect `quietHoursStart`/`quietHoursEnd` in `ReminderRunner` — a reminder scheduled into
   quiet hours currently still chimes. The setting exists; the runner does not read it yet.
5. Goal evaluation is O(goals × conditions) on every write. Fine at current scale; if someone
   accumulates hundreds of goals it wants an index or a dirty-set.
6. Complete the Supabase storage adapter or remove the Settings UI until it is real.
7. Align `LIFE_OS.md` (still mentions Flutter and levels) with the shipped product.

---

**End of development log.**  
If anything in code conflicts with `LIFE_OS.md`, prefer **running code + this log + `docs/skills/life-os/SKILL.md`**, then update the spec.
