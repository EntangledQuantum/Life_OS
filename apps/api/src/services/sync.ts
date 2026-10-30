/**
 * Incremental sync: the read side.
 *
 * One question, asked cheaply: *has anything changed since I last asked?* A
 * trigger on every table a client holds bumps a single counter, so the answer
 * is an integer comparison against one page of one row — no content is read, no
 * aggregate is computed, and the response is a couple of hundred bytes. Only
 * when the counter has moved does anything expensive happen, and then only for
 * the things that moved.
 *
 * The design and the prior art it came from are written out in `docs/SYNC.md`.
 * The three decisions worth repeating here, because they are the ones the code
 * would otherwise quietly violate:
 *
 * - **Nothing in a response may depend on the current time.** The server sends
 *   instants; the client compares them against its own clock. This is what
 *   makes an unchanged poll genuinely empty — the old payload had the
 *   now-marker baked into it, so it was different on every single poll by
 *   construction, and no amount of caching could have helped.
 * - **A change log of entities, not of changes.** The trigger overwrites an
 *   entity's row rather than appending, so a client that has been away for a
 *   month gets each changed thing once, and the table is bounded by the size of
 *   the world rather than by its history.
 * - **A stale cursor is answered, not refused.** There is no error code for
 *   "you are too far behind": the envelope says `reset: true` and carries the
 *   whole state. A client needs a reset path anyway for its first run, so
 *   giving it a second one to implement would only add a way to get it wrong.
 */
import { createHash } from "node:crypto";
import { and, eq, gt, lt, max, ne, sql } from "drizzle-orm";
import type { LifeOsDb } from "@life-os/db";
import * as schema from "@life-os/db";
import {
  SYNC_COLLECTIONS,
  activityColor,
  efficiencyPct,
  expiresAt,
  notifyAt,
  REMINDER_SHELF_LIFE_MINUTES,
  type AgendaItem,
  type LifeDay,
  type LoggedInterval,
  type RibbonSegment,
  type SyncChanged,
  type SyncCollection,
  type SyncDeleted,
  type SyncDocName,
  type SyncDocs,
  type SyncEnvelope,
  type SyncedTask,
  type Task,
  PROTOCOL_VERSION,
} from "@life-os/shared";
import { externalizeArt, externalizeOne, externalizePicture } from "./assets.js";
import {
  getLocalDayBounds,
  getProgressRow,
  getSettingsRow,
  loadGamificationConfig,
} from "./helpers.js";
import { agendaLifeDay, getAgenda, rolloverPastDays } from "./agenda.js";
import { listHabits } from "./habits.js";
import { listTasks } from "./tasks.js";
import { listGoals } from "./goals.js";
import { listProperties } from "./properties.js";
import { listQuests } from "./quests.js";
import { listAchievements } from "./achievements.js";
import { listStudySessions } from "./study.js";
import { getActiveSession, listActivityLog } from "./sessions.js";
import { getSettings, getGamificationConfig } from "./settings.js";
import {
  getConsistencySeries,
  getPulse,
  getTodayXp,
  getVsYesterday,
  getXpSeries,
} from "./snapshots.js";

/** How long a tombstone is kept before a cursor older than it forces a reset. */
export const TOMBSTONE_RETENTION_DAYS = 30;

interface SyncStateRow {
  version: number;
  lifeDay: string | null;
  tombstoneFloor: number;
  epoch: string;
}

function newEpoch(): string {
  return `${Date.now().toString(36)}${Math.floor(Math.random() * 1e9).toString(36)}`;
}

function readState(db: LifeOsDb): SyncStateRow {
  const row = db
    .select()
    .from(schema.syncState)
    .where(eq(schema.syncState.id, 1))
    .get();
  if (row) {
    return {
      version: row.version,
      lifeDay: row.lifeDay ?? null,
      tombstoneFloor: row.tombstoneFloor,
      epoch: row.epoch,
    };
  }
  /*
   * A database whose single row was lost. Seed it rather than throwing: an
   * epoch that did not exist a moment ago is new to every client anyway, so
   * every outstanding cursor is correctly refused and every client resets once.
   */
  const epoch = newEpoch();
  db.insert(schema.syncState)
    .values({ id: 1, version: 1, tombstoneFloor: 0, epoch })
    .run();
  return { version: 1, lifeDay: null, tombstoneFloor: 0, epoch };
}

/**
 * A cursor is `<epoch>.<version>`, and opaque.
 *
 * The epoch is in there because the counter alone is a lie after a restore from
 * backup: the database legitimately goes back to an earlier version, and a
 * client holding a higher number would be told "nothing has changed" forever
 * while showing a day that no longer exists. Comparing epochs turns that into a
 * one-off reset, which is the correct and survivable outcome.
 */
export function cursorOf(epoch: string, version: number): string {
  return `${epoch}.${version}`;
}

function parseCursor(
  raw: string | null | undefined,
): { epoch: string; version: number } | null {
  if (!raw) return null;
  const dot = raw.lastIndexOf(".");
  if (dot <= 0) return null;
  const epoch = raw.slice(0, dot);
  const version = Number(raw.slice(dot + 1));
  if (!Number.isInteger(version) || version < 0) return null;
  return { epoch, version };
}

/** Bump the counter without writing to a watched table. */
function bumpVersion(db: LifeOsDb): number {
  db.update(schema.syncState)
    .set({ version: sql`${schema.syncState.version} + 1` })
    .where(eq(schema.syncState.id, 1))
    .run();
  return readState(db).version;
}

/**
 * Bring the server's own day forward before answering anything.
 *
 * Two things change at 04:00 with nobody writing anything: a habit's
 * `completedToday` and its streak, and which tasks have been missed. A client
 * polling across the boundary would otherwise be told "nothing has changed" and
 * sit there showing yesterday — the one moment an incremental protocol is most
 * tempted to be wrong.
 *
 * `rolloverPastDays` writes through the triggers, so tasks take care of
 * themselves. Habits have no row to touch: their projection moved, not their
 * data, so they are stamped into the change log explicitly. Once per day, not
 * once per poll.
 */
function advanceDay(db: LifeOsDb, now: Date): void {
  rolloverPastDays(db, now);
  const state = readState(db);
  const today = getLocalDayBounds(db, now).dateStr;
  if (state.lifeDay === today) return;

  const version = bumpVersion(db);
  const at = now.toISOString();
  db.run(
    /*
     * `WHERE true` is not padding. SQLite cannot parse an upsert attached to an
     * INSERT…SELECT without a WHERE clause to end the SELECT — the grammar is
     * ambiguous about whether `ON` begins a join — and the error it gives is
     * `near "DO": syntax error`, which points nowhere near the cause.
     */
    sql`INSERT INTO change_log (collection, entity_id, version, op, at)
        SELECT 'habits', id, ${version}, 'put', ${at} FROM habits WHERE true
        ON CONFLICT(collection, entity_id) DO UPDATE SET
          version = excluded.version, op = excluded.op, at = excluded.at`,
  );
  db.update(schema.syncState)
    .set({ lifeDay: today })
    .where(eq(schema.syncState.id, 1))
    .run();
  pruneTombstones(db, now);
}

/**
 * Drop tombstones older than the retention window and raise the floor.
 *
 * A tombstone is the only thing in the log that must be kept after the row it
 * describes is gone, and keeping them all forever means a table that only grows
 * for a database that never shrinks. Thirty days is longer than any phone is
 * plausibly offline and shorter than forever; Microsoft Graph bounds directory
 * delta tokens at seven, Gmail guarantees a history id for about a week.
 *
 * Raising `tombstone_floor` is the part that matters: it is the server
 * admitting it can no longer say what a client at that cursor should delete, so
 * such a client is handed the whole state instead of a delta that would leave
 * it showing something that was removed.
 */
export function pruneTombstones(db: LifeOsDb, now = new Date()): number {
  const cutoff = new Date(
    now.getTime() - TOMBSTONE_RETENTION_DAYS * 86_400_000,
  ).toISOString();
  const stale = and(eq(schema.changeLog.op, "del"), lt(schema.changeLog.at, cutoff));
  const highest = db
    .select({ v: max(schema.changeLog.version) })
    .from(schema.changeLog)
    .where(stale)
    .get();
  const floor = Number(highest?.v ?? 0);
  if (!floor) return 0;
  db.delete(schema.changeLog).where(stale).run();
  db.update(schema.syncState)
    .set({ tombstoneFloor: sql`MAX(${schema.syncState.tombstoneFloor}, ${floor})` })
    .where(eq(schema.syncState.id, 1))
    .run();
  return floor;
}

/* ------------------------------------------------------------ projections */

/**
 * The four instants that let a client decide what is current and what chimes.
 *
 * Pure functions of the row and the user's lead — no clock is read — so they
 * can be cached with the row and compared against the client's own clock
 * forever. `currentFrom` is deliberately `eventAt - lead` rather than the
 * explicit `remindAt`, because that is what `isCardImminent` has always
 * compared against; a client reimplementing this from scratch is exactly the
 * sort of near-miss that makes the phone and the dashboard disagree about which
 * task is urgent.
 */
function withWindows(task: Task, lead: number): SyncedTask {
  const ping = notifyAt(task, lead);
  const gone = expiresAt(task);
  const event = task.eventAt ? Date.parse(task.eventAt) : null;

  const currentFrom =
    event !== null ? new Date(event - lead * 60_000).toISOString() : ping;
  const dueUntil =
    gone !== null
      ? new Date(gone).toISOString()
      : ping
        ? new Date(Date.parse(ping) + REMINDER_SHELF_LIFE_MINUTES * 60_000).toISOString()
        : null;

  return {
    ...task,
    currentFrom,
    currentUntil: gone !== null ? new Date(gone).toISOString() : null,
    dueFrom: ping,
    dueUntil,
  };
}

function leadMinutes(db: LifeOsDb): number {
  const row = getSettingsRow(db) as { reminderLeadMinutes?: number };
  const n = Number(row.reminderLeadMinutes);
  return Number.isFinite(n) && n >= 0 ? n : 15;
}

/**
 * Everything a client holds as rows, keyed by id.
 *
 * Built in full and then filtered to the ids that changed. These tables are
 * small — tens of habits, hundreds of tasks — and a projection per entity would
 * mean a second set of loaders to keep in step with the first. It only runs
 * when the counter has moved; an unchanged poll never reaches this function.
 */
function projectAll(db: LifeOsDb, base: string, now: Date) {
  const lead = leadMinutes(db);
  return {
    habits: new Map(
      listHabits(db).map((h) => [h.id, externalizeArt(db, h, base)]),
    ),
    tasks: new Map(
      listTasks(db, {}, now).map((t) => [
        t.id,
        externalizePicture(db, externalizeArt(db, withWindows(t, lead), base), base),
      ]),
    ),
    goals: new Map(
      listGoals(db).map((g) => {
        /*
         * A goal carries its ladder four times: the `tiers` array, and the
         * three derived pointers at whichever rung is current, next and owed a
         * celebration. Externalising only the array left a tier's full 57 KB
         * background sitting in `currentTier` — so each rung is externalised
         * once, into a map, and every pointer is remapped through it. A goal
         * with no ladder is unaffected, which is most of them.
         */
        const tiers = g.tiers.map((t) => externalizeArt(db, t, base));
        const byId = new Map(tiers.map((t) => [t.id, t]));
        const same = <P extends { id: string } | null>(tier: P): P =>
          tier ? ((byId.get(tier.id) ?? tier) as P) : tier;
        return [
          g.id,
          {
            ...externalizeArt(db, g, base),
            tiers,
            currentTier: same(g.currentTier),
            nextTier: same(g.nextTier),
            pendingTier: same(g.pendingTier),
          },
        ];
      }),
    ),
    properties: new Map(listProperties(db).map((p) => [p.uid, p])),
    quests: new Map(listQuests(db).map((q) => [q.id, q])),
    achievements: new Map(listAchievements(db).map((a) => [a.id, a])),
  };
}

type Projected = ReturnType<typeof projectAll>;

/* -------------------------------------------------------------- documents */

/**
 * The planned ribbon, uncut.
 *
 * Lifted out of the old dashboard, minus the one thing it used to do at the
 * end: slice itself at the current hour. That slice is why the whole day had to
 * be re-sent to move a marker a few pixels. The client cuts it now, against its
 * own clock, which also means the marker advances smoothly between polls
 * instead of jumping on each one.
 */
function buildRibbon(items: AgendaItem[]): RibbonSegment[] {
  const segs = items
    .filter((item) => item.startHour !== null && item.endHour !== null)
    .map((item) => {
      const category =
        item.activityTag ?? (item.kind === "study" ? "Study" : "Deep Work");
      let start = item.startHour!;
      let end = item.endHour!;
      if (end <= start) end += 24;
      start = Math.max(0, Math.min(24, start));
      end = Math.max(start, Math.min(24, end > 24 ? 24 : end));
      return {
        id: item.id,
        category,
        label: item.title,
        start,
        end,
        color: activityColor(category),
        status: item.done ? "done" : "planned",
      };
    })
    .filter((s) => s.end > s.start + 1e-6)
    .sort((a, b) => a.start - b.start || a.end - b.end);

  // Overlaps resolve forward: a later block starts where the earlier one ends.
  for (let i = 1; i < segs.length; i++) {
    if (segs[i]!.start < segs[i - 1]!.end) segs[i]!.start = segs[i - 1]!.end;
  }
  const cleaned = segs.filter((s) => s.end > s.start + 1e-6);

  // A solid ribbon: neighbours share a boundary, and the ends are pinned.
  if (cleaned.length > 0) {
    cleaned[0]!.start = 0;
    for (let i = 0; i < cleaned.length - 1; i++) {
      cleaned[i]!.end = cleaned[i + 1]!.start;
    }
    cleaned[cleaned.length - 1]!.end = 24;
  }

  if (cleaned.length === 0) {
    return [
      {
        id: "empty-day",
        category: "Life",
        label: "Unscheduled",
        startHour: 0,
        endHour: 24,
        color: activityColor("Life"),
        status: "planned",
      },
    ];
  }

  return cleaned.map((s) => ({
    id: s.id,
    category: s.category,
    label: s.label,
    startHour: s.start,
    endHour: s.end,
    color: s.color,
    status: s.status,
  }));
}

/**
 * Every derived document, computed fresh.
 *
 * All of them, every time the counter has moved, because the only way to know
 * whether a computed document changed is to compute it — there is no row to
 * watch. What saves the bytes is the hash comparison afterwards: completing one
 * habit moves `agenda`, `progress` and `insights` and leaves the other six
 * exactly as they were, so only three are sent.
 */
function computeDocs(db: LifeOsDb, base: string, now: Date): Required<SyncDocs> {
  const agenda = getAgenda(db, now);
  const items = agenda.items.map((item) => ({
    ...item,
    iconImage: externalizeOne(db, item.iconImage, base),
  }));
  const anytime = items.filter((i) => i.at === null);

  const config = loadGamificationConfig(db);
  const progressRow = getProgressRow(db);
  const dailyXp = getTodayXp(db);
  const pulse = getPulse(db);
  const { dateStr } = getLocalDayBounds(db, now);
  const vsYesterday = getVsYesterday(db);

  return {
    agenda: { items, anytime },
    ribbon: buildRibbon(items),
    lived: listActivityLog(db, dateStr) as LoggedInterval[],
    progress: {
      totalXp: progressRow.totalXp,
      dailyXp,
      dailyXpTarget: config.dailyXpTarget,
      efficiencyPct: efficiencyPct(dailyXp, config.dailyXpTarget),
      yesterdayEfficiencyPct: vsYesterday.efficiency.yesterday,
      lastImprovementPulse: pulse.pulse,
      growthStyle: config.growthStyle,
      nurtureStyle: config.growthStyle,
    },
    insights: {
      vsYesterday,
      pulse: pulse.pulse,
      pulseExplanation: pulse.explanation,
      consistency7: getConsistencySeries(db, 7),
      xpSeries7: getXpSeries(db, 7),
    },
    studySessions: listStudySessions(db, 20),
    settings: getSettings(db),
    gamification: getGamificationConfig(db),
    activeSession: getActiveSession(db),
  };
}

function hashOf(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 32);
}

/**
 * Which documents actually changed, and at which version.
 *
 * A document whose recomputed bytes match what was last recorded keeps its old
 * version, so a client already past that version is not sent it again. A
 * document that moved is stamped with the current version. Nothing here writes
 * to a table a trigger watches, so recording a hash cannot itself make the next
 * poll non-empty — that loop is the one bug that would make the whole protocol
 * pointless, and it is worth saying out loud.
 */
function stampDocs(
  db: LifeOsDb,
  docs: Required<SyncDocs>,
  version: number,
): Map<SyncDocName, number> {
  const recorded = new Map<string, { hash: string; version: number }>();
  for (const row of db.select().from(schema.syncDocs).all()) {
    recorded.set(row.name, { hash: row.hash, version: row.version });
  }

  const out = new Map<SyncDocName, number>();
  for (const [name, value] of Object.entries(docs) as [
    SyncDocName,
    unknown,
  ][]) {
    const hash = hashOf(value);
    const prior = recorded.get(name);
    if (prior && prior.hash === hash) {
      out.set(name, prior.version);
      continue;
    }
    db.insert(schema.syncDocs)
      .values({ name, hash, version })
      .onConflictDoUpdate({
        target: schema.syncDocs.name,
        set: { hash, version },
      })
      .run();
    out.set(name, version);
  }
  return out;
}

/* ----------------------------------------------------------------- delta */

export interface DeltaOptions {
  /** The client's cursor, or null/absent for a cold sync. */
  since?: string | null;
  /** Absolute base URL for asset links — where this request arrived. */
  base: string;
  now?: Date;
}

export interface DeltaResult {
  envelope: SyncEnvelope;
  /** For the route's `ETag`. Changes exactly when the answer would change. */
  etag: string;
}

export function buildDelta(db: LifeOsDb, opts: DeltaOptions): DeltaResult {
  const now = opts.now ?? new Date();
  advanceDay(db, now);

  const state = readState(db);
  const cursor = cursorOf(state.epoch, state.version);
  const parsed = parseCursor(opts.since);
  const lifeDay = agendaLifeDay(db, now);

  /*
   * Three ways a cursor is unusable, and all three mean the same thing to the
   * client: it is holding state the server cannot reconcile, so it must throw
   * it away. A cursor from another epoch (restored backup, different instance),
   * one older than the pruned tombstones, or none at all.
   */
  const reset =
    parsed === null ||
    parsed.epoch !== state.epoch ||
    parsed.version < state.tombstoneFloor ||
    parsed.version > state.version;

  const sinceVersion = reset ? 0 : parsed!.version;

  if (!reset && sinceVersion === state.version) {
    /*
     * The cheap path, and the whole point of the exercise: no content is read,
     * no aggregate is computed, no document is hashed. Two hundred-odd bytes
     * saying "you are current, and here is which day it is".
     */
    return {
      etag: etagFor(cursor, lifeDay.lifeDay),
      envelope: {
        protocol: PROTOCOL_VERSION,
        cursor,
        reset: false,
        lifeDay,
        serverTime: now.toISOString(),
        changed: {},
        deleted: {},
        docs: {},
        upToDate: true,
      },
    };
  }

  const rows = db
    .select({
      collection: schema.changeLog.collection,
      entityId: schema.changeLog.entityId,
      op: schema.changeLog.op,
    })
    .from(schema.changeLog)
    .where(
      and(
        gt(schema.changeLog.version, sinceVersion),
        ne(schema.changeLog.collection, "@docs"),
      ),
    )
    .all();

  const projected = projectAll(db, opts.base, now);
  const changed: SyncChanged = {};
  const deleted: SyncDeleted = {};

  const wanted: { collection: string; entityId: string; op: string }[] = reset
    ? SYNC_COLLECTIONS.flatMap((collection) =>
        [...projected[collection].keys()].map((entityId) => ({
          collection: collection as string,
          entityId,
          op: "put",
        })),
      )
    : rows;

  for (const row of wanted) {
    const collection = row.collection as SyncCollection;
    if (!SYNC_COLLECTIONS.includes(collection)) continue;
    const entity = projected[collection].get(row.entityId);
    /*
     * The row decides nothing on its own. An entity the projection no longer
     * returns is a tombstone whatever the log says `op` was — a habit marked
     * inactive or soft-deleted is physically still there, and a client that
     * kept it would show a habit the user retired. Google Drive words its
     * `removed` flag as "removed from this list of changes... by deletion or
     * loss of access" for the same reason.
     */
    if (row.op === "del" || entity === undefined) {
      if (reset) continue;
      (deleted[collection] ??= []).push(row.entityId);
      continue;
    }
    ((changed[collection] ??= []) as unknown[]).push(entity);
  }

  const computed = computeDocs(db, opts.base, now);
  const docVersions = stampDocs(db, computed, state.version);
  const docs: SyncDocs = {};
  for (const [name, version] of docVersions) {
    if (reset || version > sinceVersion) {
      (docs as Record<string, unknown>)[name] = computed[name];
    }
  }

  const upToDate =
    !reset &&
    Object.keys(changed).length === 0 &&
    Object.keys(deleted).length === 0 &&
    Object.keys(docs).length === 0;

  return {
    etag: etagFor(cursor, lifeDay.lifeDay, sinceVersion),
    envelope: {
      protocol: PROTOCOL_VERSION,
      cursor,
      reset,
      lifeDay,
      serverTime: now.toISOString(),
      changed,
      deleted,
      docs,
      upToDate,
    },
  };
}

/**
 * The validator for a conditional poll.
 *
 * Strong, and a function of exactly what decides the body: the cursor the
 * server would hand back, which day it is, and where the client is starting
 * from. `since` is in there because two clients at different cursors get
 * different bodies from the same URL, and an entity tag that ignored that would
 * let a cache hand one client the other's delta.
 *
 * `serverTime` is in the body and not in the tag on purpose. It moves on every
 * request, so including it would mean no two requests ever matched and `304`
 * would be dead code; a client that needs the exact server clock after a `304`
 * has one on its own wrist, correct to within the few seconds that matter here.
 */
function etagFor(cursor: string, lifeDay: string, since?: number): string {
  const seed = since === undefined ? `${cursor}|${lifeDay}` : `${cursor}|${lifeDay}|${since}`;
  return `"${createHash("sha256").update(seed).digest("hex").slice(0, 24)}"`;
}

/** The cursor as it stands, without computing anything. */
export function currentCursor(db: LifeOsDb): string {
  const state = readState(db);
  return cursorOf(state.epoch, state.version);
}
