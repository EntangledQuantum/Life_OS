/**
 * The client's half of the sync protocol, with no network and no React in it.
 *
 * Two things live here and nothing else: how a delta is applied to local state,
 * and how the screen's shape is derived from that state *at a given instant*.
 * Both are pure functions over plain data, which is the only reason the
 * protocol's awkward cases — a reset arriving mid-session, a tombstone for a
 * row we never had, a task that becomes current while nothing is downloading —
 * are testable at all. `sync.ts` adds the fetching and the persistence on top.
 *
 * The contract is `docs/SYNC.md`. The two rules it rests on decide the shape of
 * this file:
 *
 * 1. **Nothing the server sends depends on what time it is**, so everything
 *    clock-dependent is computed here, in `selectDashboard`, against a `now`
 *    passed in by the caller. That is what makes an unchanged poll empty.
 * 2. **Entities are rows keyed by id**, not one blob. A delta patches the rows
 *    it names and leaves the rest alone, and a tombstone removes one.
 *
 * The helpers that do the actual clock comparisons are imported from
 * `@life-os/shared` rather than written again here. That is deliberate and it
 * is the whole point of the server exporting them: the phone and the dashboard
 * must not drift apart about which task is urgent, and a near-miss
 * reimplementation of `isCardImminent` is exactly how they would.
 */
import {
  activityColor,
  composeTimeline,
  dayFractionAt,
  isCurrentAt,
  isReminderDueAt,
  paceAdjustedImprovementPct,
  SYNC_COLLECTIONS,
  type AgentProperty,
  type Achievement,
  type AppSettings,
  type DashboardToday,
  type GamificationConfig,
  type Goal,
  type HabitWithToday,
  type Quest,
  type SyncCollection,
  type SyncDocs,
  type SyncEnvelope,
  type SyncedTask,
  type Task,
} from "@life-os/shared";

/**
 * Everything the client holds, in the shape the protocol hands it over in.
 *
 * Entities are records keyed by id rather than arrays, because that is what
 * makes applying a delta an assignment instead of a merge. Arrays would mean
 * finding the row first, and "find it, or append it if it is new, and remember
 * the order" is the merge bug SYNC.md §6 refuses to buy.
 *
 * `docs` holds the nine computed documents exactly as they arrived. They are
 * replaced wholesale and never patched, so there is nothing clever to do here.
 */
export interface SyncState {
  /** Opaque. Stored, sent back as `since`, never parsed or compared. */
  cursor: string | null;
  /** The `ETag` of the last body we applied, for the next `If-None-Match`. */
  etag: string | null;
  habits: Record<string, HabitWithToday>;
  tasks: Record<string, SyncedTask>;
  goals: Record<string, Goal>;
  properties: Record<string, AgentProperty>;
  quests: Record<string, Quest>;
  achievements: Record<string, Achievement>;
  docs: SyncDocs;
  /** Which life-day the server is on. Always present once anything has synced. */
  lifeDay: SyncEnvelope["lifeDay"] | null;
  /**
   * `serverTime` minus our clock when the last response landed.
   *
   * A browser whose clock is minutes out would get the now-marker and the due
   * reminders wrong, and it is the one error the server cannot correct for us.
   * Applied in `nowOn`; see the note there about why it is clamped.
   */
  clockOffsetMs: number;
  /** True once a cold sync has landed, so the UI can tell empty from unloaded. */
  loaded: boolean;
}

/** Which field carries the id, per collection. Only `properties` differs. */
const ID_FIELD: Record<SyncCollection, string> = {
  habits: "id",
  tasks: "id",
  goals: "id",
  properties: "uid",
  quests: "id",
  achievements: "id",
};

export function emptyState(): SyncState {
  return {
    cursor: null,
    etag: null,
    habits: {},
    tasks: {},
    goals: {},
    properties: {},
    quests: {},
    achievements: {},
    docs: {},
    lifeDay: null,
    clockOffsetMs: 0,
    loaded: false,
  };
}

/**
 * Apply one envelope and return the new state.
 *
 * The order is the one SYNC.md §5 specifies and it matters: reset first, then
 * the changed rows, then the tombstones, then the documents, and the cursor
 * last. The cursor going last is the part that is easy to get wrong and
 * invisible when you do — a cursor stored before the rows it describes have
 * been applied means a crash in between loses those rows permanently, because
 * the next poll starts from after them. Storing it last costs at most one
 * redundant delta, and a redundant delta is idempotent.
 *
 * Returns a new object rather than mutating, so a React subscriber can tell
 * "something changed" from reference equality alone — which is how a `304`
 * costs no re-render.
 */
export function applyEnvelope(prev: SyncState, env: SyncEnvelope): SyncState {
  /*
   * A reset is the server saying it cannot prove what we are missing: our first
   * run, a restored backup, a cursor older than the pruned tombstones. There is
   * no error code for it by design — we need this path for the first run
   * anyway, so it is the only path.
   */
  const base = env.reset ? emptyState() : prev;

  const next: SyncState = {
    ...base,
    habits: { ...base.habits },
    tasks: { ...base.tasks },
    goals: { ...base.goals },
    properties: { ...base.properties },
    quests: { ...base.quests },
    achievements: { ...base.achievements },
    docs: { ...base.docs },
  };

  for (const collection of SYNC_COLLECTIONS) {
    const rows = env.changed[collection];
    if (!rows) continue;
    const bucket = next[collection] as Record<string, unknown>;
    for (const row of rows) {
      const id = (row as unknown as Record<string, unknown>)[ID_FIELD[collection]];
      if (typeof id !== "string") continue;
      bucket[id] = row;
    }
  }

  for (const collection of SYNC_COLLECTIONS) {
    const ids = env.deleted[collection];
    if (!ids) continue;
    const bucket = next[collection] as Record<string, unknown>;
    for (const id of ids) delete bucket[id];
  }

  /*
   * A document is absent when it has not changed, so only the keys present are
   * touched. `activeSession` is the exception worth naming: present-but-null is
   * a real value meaning the session was cleared, and `in` is what tells that
   * apart from absent. `??=` or a truthiness check here would silently make
   * clearing a session impossible.
   */
  for (const name of Object.keys(env.docs) as (keyof SyncDocs)[]) {
    if (!(name in env.docs)) continue;
    (next.docs as Record<string, unknown>)[name] = env.docs[name];
  }

  next.lifeDay = env.lifeDay;
  next.clockOffsetMs = offsetFrom(env.serverTime);
  next.loaded = true;
  next.cursor = env.cursor;
  return next;
}

/**
 * How far our clock is from the server's, in milliseconds.
 *
 * Clamped to a minute. Beyond that the difference is far more likely to be a
 * slow response or a sleeping laptop than a genuinely wrong clock, and applying
 * a bogus correction would move the now-marker somewhere visibly wrong — worse
 * than the small error it was trying to fix.
 */
function offsetFrom(serverTime: string): number {
  const server = Date.parse(serverTime);
  if (!Number.isFinite(server)) return 0;
  const delta = server - Date.now();
  return Math.abs(delta) > 60_000 ? 0 : delta;
}

/** Our clock, corrected toward the server's. The clock every comparison uses. */
export function nowOn(state: SyncState, now: number = Date.now()): Date {
  return new Date(now + state.clockOffsetMs);
}

/* ------------------------------------------------------------- derivation */

/**
 * The order the old payload listed tasks in: soonest first, then the undated
 * tail in creation order.
 *
 * Reproduced rather than inferred, because the list is rendered in this order
 * and a different one is a visible change for no reason. It is the comparator
 * from `listTasks` in `apps/api/src/services/tasks.ts`.
 */
export function compareTasks(a: Task, b: Task): number {
  if (a.eventAt && b.eventAt) return a.eventAt.localeCompare(b.eventAt);
  if (a.eventAt) return -1;
  if (b.eventAt) return 1;
  return a.createdAt.localeCompare(b.createdAt);
}

/**
 * Tasks of one status that are visible now.
 *
 * `GET /tasks?status=…` passed `visibleOnly`, so a task whose `showAt` is still
 * in the future was absent from the list. That is a clock comparison, which is
 * why it is here and not on the server any more; everything else about the
 * list — which rows, in which order — is unchanged.
 */
export function selectTasksByStatus(
  state: SyncState,
  status: Task["status"],
  now: Date,
): SyncedTask[] {
  const at = now.getTime();
  return Object.values(state.tasks)
    .filter(
      (t) => t.status === status && (!t.showAt || Date.parse(t.showAt) <= at),
    )
    .sort(compareTasks);
}

/**
 * The four clock-dependent values, and nothing else.
 *
 * Separated out from `selectDashboard` because these are the ones SYNC.md §8
 * moved to the client, and keeping them in one named place is what stops one of
 * them creeping back into a server response later. Every one is a comparison
 * against `now` using a helper exported from `@life-os/shared`.
 */
export function clockDependent(state: SyncState, now: Date) {
  const tasks = Object.values(state.tasks);

  /*
   * `visibleOnly` in the old server query read the clock too, and `isCurrentAt`
   * already folds that `showAt` check in — so an open task whose `showAt` has
   * not passed is correctly absent from both lists.
   */
  const open = selectTasksByStatus(state, "active", now);

  const current = open.filter((t) => isCurrentAt(t, now));
  const dueReminders = tasks
    .filter((t) => isReminderDueAt(t, now))
    .sort(compareTasks);

  const timeline = composeTimeline(
    state.docs.ribbon ?? [],
    state.docs.lived ?? [],
    activityColor,
    now,
  );

  /*
   * Against where yesterday had got to *by this hour*, not against its total.
   * The raw delta compares a day in progress with a day that finished, which
   * greeted the user with roughly -100% every morning.
   */
  const progress = state.docs.progress;
  const improvementPct =
    progress && state.lifeDay
      ? paceAdjustedImprovementPct(
          progress.efficiencyPct,
          progress.yesterdayEfficiencyPct,
          dayFractionAt(state.lifeDay, now),
        )
      : 0;

  return { open, current, dueReminders, timeline, improvementPct };
}

/**
 * The state, in the shape the pages already render.
 *
 * This is a deliberate adapter rather than a rewrite of the pages. The old
 * `GET /dashboard/today` body and this object are the same shape, so moving the
 * transport did not become a redesign of five screens at the same time — which
 * is the version of this change that would have broken something nobody was
 * looking at. The pages ask for `useDashboard()` instead of a query and are
 * otherwise untouched.
 *
 * Everything in here is either a row we hold, a document we were sent, or one
 * of the four values above. Nothing is fetched.
 */
export function selectDashboard(
  state: SyncState,
  now: Date,
): DashboardToday | null {
  if (!state.loaded || !state.lifeDay) return null;

  const { open, current, dueReminders, timeline, improvementPct } =
    clockDependent(state, now);
  const docs = state.docs;
  const goals = Object.values(state.goals);

  return {
    date: state.lifeDay.lifeDay,
    dayResetTime: state.lifeDay.dayResetTime,
    lifeDay: state.lifeDay,
    agenda: docs.agenda?.items ?? [],
    anytime: docs.agenda?.anytime ?? [],
    tasks: open,
    current,
    dueReminders,
    /*
     * A goal whose condition is true but whose celebration nobody watched is
     * met, not finished. The flag is on the row, so this needs no clock and no
     * server round trip — it was in the payload only because everything was.
     */
    pendingCelebrations: goals.filter((g) => g.celebrationPending),
    properties: Object.values(state.properties),
    habits: Object.values(state.habits),
    progress: {
      totalXp: docs.progress?.totalXp ?? 0,
      dailyXp: docs.progress?.dailyXp ?? 0,
      dailyXpTarget: docs.progress?.dailyXpTarget ?? 0,
      efficiencyPct: docs.progress?.efficiencyPct ?? 0,
      improvementPct,
      yesterdayEfficiencyPct: docs.progress?.yesterdayEfficiencyPct ?? 0,
      lastImprovementPulse: docs.progress?.lastImprovementPulse ?? "Stable",
      growthStyle: docs.progress?.growthStyle ?? "orb",
      nurtureStyle: docs.progress?.nurtureStyle ?? docs.progress?.growthStyle ?? "orb",
    },
    vsYesterday: docs.insights?.vsYesterday as DashboardToday["vsYesterday"],
    pulse: docs.insights?.pulse ?? "Stable",
    pulseExplanation: docs.insights?.pulseExplanation ?? "",
    studySessions: docs.studySessions ?? [],
    goals,
    quests: Object.values(state.quests),
    achievements: Object.values(state.achievements),
    consistency7: docs.insights?.consistency7 ?? [],
    xpSeries7: docs.insights?.xpSeries7 ?? [],
    activeSession: docs.activeSession ?? null,
    timeline,
  };
}

/** The settings document, which several screens read and one of them writes. */
export function selectSettings(state: SyncState): AppSettings | null {
  return state.docs.settings ?? null;
}

export function selectGamification(
  state: SyncState,
): GamificationConfig | null {
  return state.docs.gamification ?? null;
}

/** Every art URL the day references, for warming the cache. */
export function artSources(state: SyncState): (string | null | undefined)[] {
  const out: (string | null | undefined)[] = [];
  for (const h of Object.values(state.habits)) {
    out.push(h.iconImageUrl, h.backgroundImageUrl);
  }
  for (const g of Object.values(state.goals)) {
    out.push(g.iconImageUrl, g.backgroundImageUrl);
    for (const t of g.tiers ?? []) {
      out.push(t.iconImageUrl, t.backgroundImageUrl);
    }
  }
  for (const t of Object.values(state.tasks)) {
    out.push(t.imageUrl, t.iconImageUrl);
  }
  for (const item of state.docs.agenda?.items ?? []) {
    out.push(item.iconImage);
  }
  return out;
}
