# Database

Life OS stores everything in a **single local SQLite file**. There is no server to
provision, no account to create, and no network call. Every person who clones the
repo gets their own private database automatically.

---

## Where the data lives

| | |
|--|--|
| Default path | `data/lifeos.db` (relative to the repo root) |
| Configured by | `DATABASE_PATH` in `.env` |
| Engine | SQLite via Node's built-in `node:sqlite` |
| Journal mode | WAL — you will also see `lifeos.db-wal` and `lifeos.db-shm` |
| In git? | **No.** `data/*.db` is gitignored; only `data/.gitkeep` is tracked |

The path is resolved to an absolute path at startup, so it does not matter which
directory you launch from. An absolute `DATABASE_PATH` is used as-is, which is how
you point Life OS at a synced folder or an external drive.

**It is permanent.** The file survives restarts, rebuilds, `pnpm install`, and
`git pull`. Nothing clears it except you deleting the file.

---

## How it gets created

Three separate paths all converge on the same result, so you cannot end up with a
half-built schema:

1. **`pnpm setup`** — creates `.env`, installs dependencies, creates the DB,
   applies migrations, and seeds starter data.
2. **`pnpm dev`** — the API calls `bootstrapDatabase()` on boot, which creates the
   file and directory if missing and brings the schema up to date. Running the app
   is enough; the migrate step is not something you can forget.
3. **`pnpm db:migrate`** — the same bootstrap, run explicitly.

All three are **idempotent**. Re-running them never drops a table or deletes a row.

### The two-layer schema

| Layer | File | Role |
|-------|------|------|
| Drizzle migrations | `packages/db/drizzle/*.sql` | Creates the core tables on a new database |
| `ensureSchema()` | `packages/db/src/ensure-schema.ts` | Adds columns and newer tables to databases that already exist |

`ensureSchema()` exists because SQLite's `ALTER TABLE` is limited and full
re-migration on Windows is painful. It only ever **adds** — new columns with
defaults, and `CREATE TABLE IF NOT EXISTS`-style guards. It also folds renamed
config keys forward (for example the old `nurtureStyle` → `growthStyle`), so an old
database keeps working after an upgrade.

---

## What is stored

| Table | Holds |
|-------|-------|
| `habits`, `habit_logs` | Habit definitions, themes, XP weights, and every completion |
| `schedule_blocks`, `study_sessions` | The agent-owned day timeline and logged study |
| `dashboard_cards` | Front-page cards (2 content slots + the agent-setup card) |
| `agent_events`, `light_reviews`, `quests` | The Quick log queue injected by agents |
| `goals`, `goal_habit_links` | Goals and their linked habits |
| `daily_snapshots` | Per-day aggregates that power "you vs yesterday" |
| `user_progress` | Lifetime XP and the latest improvement pulse |
| `gamification_config` | Daily XP pool, multipliers, growth-meter style |
| `settings` | Day reset time, quiet hours, theme, agent webhook |
| `achievements`, `sleep_logs`, `active_sessions`, `auth_sessions` | Badges, sleep, the Right Now timer, mock login sessions |

Life OS **never writes to your Obsidian vault.** Agents read from here and escalate
only what is genuinely special into the vault themselves.

---

## Backing up

The database is one file. Copy it while the app is stopped:

```bash
cp data/lifeos.db ~/backups/lifeos-$(date +%F).db
```

If the app is running, include the WAL sidecar files, or use SQLite's safe copy:

```bash
sqlite3 data/lifeos.db ".backup ~/backups/lifeos.db"
```

For a portable, human-readable export that does not depend on SQLite:

```bash
curl -s http://127.0.0.1:8787/api/v1/export/json \
  -H "Authorization: Bearer $LIFEOS_API_TOKEN" > lifeos-export.json
```

Settings → Export JSON does the same thing from the UI.

---

## Moving or syncing it

Point `DATABASE_PATH` at any absolute path:

```env
DATABASE_PATH=D:/Dropbox/life-os/lifeos.db
```

One caveat: SQLite in WAL mode does not tolerate **two machines writing the same
file at once** over a sync service. Keep one machine as the writer, or stop the app
before switching machines.

---

## Resetting

```bash
# Wipe everything and start clean
rm data/lifeos.db data/lifeos.db-wal data/lifeos.db-shm
pnpm db:migrate
pnpm db:seed
```

Reseeding an existing database is safe on its own — the seed only fills tables that
are empty, so it will not duplicate your habits.

---

## Inspecting it

```bash
pnpm db:studio          # Drizzle Studio in the browser
sqlite3 data/lifeos.db  # or any SQLite client
```

---

## Remote storage

`STORAGE_MODE=supabase` and the Supabase fields in Settings are **scaffolding, not a
working driver**. Local SQLite is the only supported store today. Use the JSON
export if you need the data somewhere else.
