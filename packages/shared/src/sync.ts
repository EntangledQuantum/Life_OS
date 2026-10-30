/**
 * The incremental sync contract.
 *
 * `GET /api/v1/dashboard/today` returned the whole world — 2.26 MB on real
 * data, 97% of it base64 artwork — and clients asked for it every eight
 * seconds. Over a relay that is 14.6 s a poll, so polls overlapped permanently
 * and the app never reached a steady state. The same bytes took 0.31 s on
 * loopback: the server was never the problem, the protocol was.
 *
 * What replaces it is the shape every local-first product converges on. The
 * client holds state. The server holds a monotonic counter. The client says
 * "I am at 4821", and the server either says "so am I" in a couple of hundred
 * bytes, or sends only the things that moved and the new number. Prior art, and
 * what each contributed, is in `docs/SYNC.md`.
 *
 * Two rules decide what may appear in a payload, and everything else follows
 * from them:
 *
 * 1. **Nothing in a sync response may depend on what time it is.** Not the
 *    now-marker, not which reminders are due, not which task is "current". A
 *    payload that bakes in a clock reading is stale the instant it is written,
 *    which is what forced a poll to re-send the day just to move a marker four
 *    pixels. The server sends instants; the client compares them with its own
 *    clock, which is the only clock that matters because it is the one next to
 *    the screen.
 * 2. **No bytes a client already has.** Artwork is content-addressed and
 *    referenced by URL. The hash *is* the cache key, so the same picture is
 *    never sent twice to the same device, or indeed a second time to a device
 *    that has ever seen it.
 */
import type { AgendaItem } from "./agenda.js";
import type { Task } from "./tasks.js";
import type { LifeDay } from "./time.js";
import type { ImprovementPulse } from "./constants.js";
import type {
  Achievement,
  AgentProperty,
  AppSettings,
  ActiveSession,
  GamificationConfig,
  Goal,
  HabitWithToday,
  Quest,
  StudySession,
  UserProgress,
  VsYesterday,
} from "./types.js";

/**
 * A cursor is an opaque string. Clients store it and send it back; they must
 * never parse it, compare it, or try to order two of them.
 *
 * It is opaque because it is not only a counter: it carries the epoch of the
 * database that issued it, so a cursor from a restored backup — where the
 * counter has legitimately gone backwards — is refused instead of being
 * silently believed. CouchDB learned the same lesson and documents its
 * sequences as arbitrary JSON for the same reason.
 */
export type SyncCursor = string;

/** The collections a client keeps as rows, each keyed by its own id. */
export const SYNC_COLLECTIONS = [
  "habits",
  "tasks",
  "goals",
  "properties",
  "quests",
  "achievements",
] as const;
export type SyncCollection = (typeof SYNC_COLLECTIONS)[number];

/**
 * A task, plus the four instants that let a client decide for itself what is
 * current and what should chime.
 *
 * These are pure functions of the row and the user's reminder lead — no clock
 * is read to produce them — so they are stable between polls and may be cached
 * forever alongside the row. The policy stays on the server, where it has
 * always been; what moves to the client is two comparisons against its own
 * clock, which is the part the server cannot do correctly from a distance.
 *
 * Without these a client would have to reimplement `isCardImminent` and
 * `isReminderDue` — about sixty lines of edge cases about shelf lives and
 * default windows — and the phone and the dashboard would drift apart on which
 * tasks are urgent. See `isCurrentAt` and `isReminderDueAt` below.
 */
export interface SyncedTask extends Task {
  /** First instant this task is "current" and belongs on the front page. */
  currentFrom: string | null;
  /** Last instant it is current; null means it has no window of its own. */
  currentUntil: string | null;
  /** First instant its notification should fire. Null means it never does. */
  dueFrom: string | null;
  /** Last instant firing it is still a nudge rather than an accusation. */
  dueUntil: string | null;
}

/**
 * Rows that changed since the client's cursor.
 *
 * A collection is absent when nothing in it moved — absent and empty mean the
 * same thing, and absent is smaller. A present entity is the whole current row,
 * never a field-level patch: a partial row saves a few hundred bytes and buys a
 * merge bug in every client, and `tasks` is the one collection where that
 * trade-off was even arguable.
 */
export interface SyncChanged {
  habits?: HabitWithToday[];
  tasks?: SyncedTask[];
  goals?: Goal[];
  properties?: AgentProperty[];
  quests?: Quest[];
  achievements?: Achievement[];
}

/**
 * Ids to drop, per collection.
 *
 * A tombstone means "this is no longer yours to show" rather than strictly "a
 * row was deleted" — a habit with `deletedAt` set is still physically present
 * and arrives here, because a client that kept it would show a habit the user
 * retired. Google Drive's change feed words its `removed` flag the same way,
 * and for the same reason.
 */
export type SyncDeleted = Partial<Record<SyncCollection, string[]>>;

/**
 * The lived part of the day, as instants rather than as a drawn ribbon.
 *
 * The old payload sent the timeline already cut at the now-marker, which is why
 * it had to be re-sent to move it. An interval still running has
 * `endedAt: null`, and the client draws it up to its own clock — so the marker
 * advances smoothly between polls instead of jumping on each one.
 */
export interface LoggedInterval {
  id: string;
  activity: string;
  startedAt: string;
  endedAt: string | null;
  blockId: string | null;
}

/** A segment of the planned ribbon. Hours from the life-day's start. */
export interface RibbonSegment {
  id: string;
  category: string;
  label: string;
  startHour: number;
  endHour: number;
  color: string;
  status: string;
}

/**
 * The derived documents: computed, whole, and replaced rather than patched.
 *
 * Each is recomputed when the counter moves, hashed, and sent only if the bytes
 * actually changed — so completing a habit sends `agenda` and `progress` and
 * not the six documents it did not touch. A document is absent when unchanged;
 * a client keeps the copy it has.
 *
 * None of them depend on the clock. `agenda` is the day's shape, `ribbon` is
 * the plan, `lived` is what happened; where any of those would have needed to
 * know the time, it carries an instant instead.
 */
export interface SyncDocs {
  agenda?: { items: AgendaItem[]; anytime: AgendaItem[] };
  /** The planned ribbon, uncut. The client splits it at its own now. */
  ribbon?: RibbonSegment[];
  /** What was actually done today, open interval included. */
  lived?: LoggedInterval[];
  /**
   * Today's numbers, minus the one that needs a clock. `improvementPct` is not
   * here: it is a comparison against where yesterday had got to *by this hour*,
   * so the client computes it with `paceAdjustedImprovementPct` from the two
   * efficiencies and how far through `lifeDay` it is. A server-computed value
   * would be wrong by however long ago the last write happened.
   */
  progress?: Omit<UserProgress, "improvementPct">;
  insights?: {
    vsYesterday: VsYesterday;
    pulse: ImprovementPulse;
    pulseExplanation: string;
    consistency7: { date: string; pct: number }[];
    xpSeries7: { date: string; current: number; target: number }[];
  };
  studySessions?: StudySession[];
  settings?: AppSettings;
  gamification?: GamificationConfig;
  /** Present-but-null is a real value here: the session was cleared. */
  activeSession?: ActiveSession | null;
}

/** The names of the derived documents, for the server's hash bookkeeping. */
export const SYNC_DOC_NAMES = [
  "agenda",
  "ribbon",
  "lived",
  "progress",
  "insights",
  "studySessions",
  "settings",
  "gamification",
  "activeSession",
] as const;
export type SyncDocName = (typeof SYNC_DOC_NAMES)[number];

export interface SyncEnvelope {
  protocol: number;
  /** Store this and send it as `since` next time. Opaque. */
  cursor: SyncCursor;
  /**
   * **Discard everything you hold before applying this.**
   *
   * True on a first sync, and whenever the server cannot prove it knows what
   * the client is missing — a cursor older than the pruned tombstones, or one
   * from a different epoch. There is no error code for a stale cursor and
   * deliberately so: a client that must handle a reset anyway needs no second
   * code path, and Replicache's `clear` patch op makes the same argument.
   */
  reset: boolean;
  /**
   * Which life-day it is on the server, and where its edges are.
   *
   * Always present, even in an empty delta, and it is 180 bytes well spent: it
   * is what a queued write is stamped against, and what tells a client the day
   * rolled over while the phone was in a pocket.
   */
  lifeDay: LifeDay;
  /**
   * The server's clock when it answered.
   *
   * Clients compare instants against their own clock, so a phone whose time is
   * minutes out would get the now-marker and the due reminders wrong. This is
   * the offset to correct by — not an invitation to use server time for
   * display.
   */
  serverTime: string;
  changed: SyncChanged;
  deleted: SyncDeleted;
  docs: SyncDocs;
  /** True when `changed`, `deleted` and `docs` are all empty. */
  upToDate: boolean;
}

/* ------------------------------------------------------------------ writes */

/**
 * The closed set of things a client may do.
 *
 * Deliberately not "any REST call, batched". A client's writes are the handful
 * of things a person can press, and naming them makes each one's life-day
 * sensitivity and its idempotency explicit. Everything else — creating habits,
 * writing goals, scheduling tasks — belongs to the agent and stays on the REST
 * surface, which is unchanged.
 */
export const SYNC_MUTATIONS = [
  "habit.complete",
  "habit.undo",
  "task.complete",
  "task.dismiss",
  "task.notified",
  "task.interact",
  "goal.celebrationSeen",
  "session.set",
  "session.clear",
  "study.create",
  "settings.patch",
] as const;
export type SyncMutationName = (typeof SYNC_MUTATIONS)[number];

/**
 * The mutations that land on a particular day, and so must not be replayed
 * across a life-day boundary.
 *
 * A habit completion replayed after 04:00 lands on the wrong day and corrupts a
 * streak silently, which is strictly worse than losing the write — so the guard
 * the Android client already applies before sending is enforced here as well.
 * Two checks rather than one, because the client's own check cannot cover a
 * write that was in flight when the day turned.
 *
 * The exemptions are the writes that are statements about a thing rather than
 * about a day: a reminder was shown, a card was swept away, a celebration was
 * watched, a setting was changed.
 */
export const LIFE_DAY_BOUND_MUTATIONS: readonly SyncMutationName[] = [
  "habit.complete",
  "habit.undo",
  "task.complete",
  "task.interact",
  "session.set",
  "session.clear",
  "study.create",
];

export function isLifeDayBound(name: string): boolean {
  return (LIFE_DAY_BOUND_MUTATIONS as readonly string[]).includes(name);
}

export interface SyncMutation {
  /**
   * Strictly one greater than the last mutation this client sent. The server
   * uses it to recognise a retry, so it must come from a counter the client
   * persists — not from a random id and not from a timestamp.
   */
  id: number;
  name: SyncMutationName;
  args: Record<string, unknown>;
  /**
   * The life-day that was current when the user pressed the thing. Required on
   * a day-bound mutation and ignored on the rest.
   */
  lifeDayDate?: string | null;
}

export interface SyncPushRequest {
  /** Stable per installation. A reinstall is a new client; that is correct. */
  clientId: string;
  /** The cursor held now, so the response can carry the delta and skip a poll. */
  since?: SyncCursor | null;
  mutations: SyncMutation[];
}

export type SyncMutationStatus =
  /** Applied. The delta in the same response contains its effects. */
  | "applied"
  /**
   * Already applied — its number is at or below `lastMutationId`. The client
   * should drop it from the queue and treat it as a success, which is also how
   * a duplicate habit completion resolves.
   */
  | "duplicate"
  /**
   * Refused because the life-day moved on. Not retryable, ever: the client
   * strands it and tells the user, rather than re-dating someone's history.
   */
  | "staleLifeDay"
  /**
   * Permanently wrong — unknown id, malformed args. `lastMutationId` still
   * advances past it, because a mutation nobody can apply must not wedge the
   * queue behind it. Replicache states this as a normative rule and it is the
   * one most easily got wrong.
   */
  | "rejected";

export interface SyncMutationResult {
  id: number;
  status: SyncMutationStatus;
  /** Written to be shown to the user when the status is not `applied`. */
  error?: string;
  /** Whatever the underlying write returned — XP awarded, the new row. */
  result?: unknown;
}

export interface SyncPushResponse {
  protocol: number;
  /** The highest mutation id now applied for this client. */
  lastMutationId: number;
  results: SyncMutationResult[];
  /**
   * The delta from the `since` in the request to now, so a client that just
   * wrote does not then have to poll for what it already caused. This is the
   * whole point of returning it: a write used to be followed by a 2.26 MB
   * refetch of a day the client had just changed one row of.
   */
  sync: SyncEnvelope;
}

/* ----------------------------------------------- what the client works out */

/**
 * Is this task current — on the front page — at `now`?
 *
 * The server's half of this decision is already in `currentFrom` /
 * `currentUntil`; this is the clock comparison, and it is the whole of what the
 * old `current` array was. Call it on every tick if you like: it reads no
 * network and allocates nothing.
 */
export function isCurrentAt(task: SyncedTask, now = new Date()): boolean {
  if (task.status !== "active") return false;
  if (task.currentFrom === null) return false;
  const ms = now.getTime();
  if (Date.parse(task.currentFrom) > ms) return false;
  if (task.currentUntil !== null && Date.parse(task.currentUntil) < ms) {
    return false;
  }
  if (task.showAt && Date.parse(task.showAt) > ms) return false;
  return true;
}

/**
 * Should this task's notification fire at `now`, and has it not already?
 *
 * `notifiedAt` is still the server's record that it fired — the client posts
 * `task.notified` and the flag comes back in the next delta — so a reminder
 * still fires exactly once across every device.
 */
export function isReminderDueAt(task: SyncedTask, now = new Date()): boolean {
  if (task.notifiedAt) return false;
  if (task.status === "done" || task.status === "dismissed") return false;
  if (task.dueFrom === null) return false;
  const ms = now.getTime();
  if (Date.parse(task.dueFrom) > ms) return false;
  if (task.dueUntil !== null && Date.parse(task.dueUntil) < ms) return false;
  return true;
}

/** Where `now` falls in the life-day, 0–1. The pace the day is being judged at. */
export function dayFractionAt(day: LifeDay, now = new Date()): number {
  const start = Date.parse(day.lifeDayStart);
  const end = Date.parse(day.lifeDayEnd);
  if (!(end > start)) return 1;
  return Math.max(0, Math.min(1, (now.getTime() - start) / (end - start)));
}

/**
 * The colour of each day bucket on the ribbon.
 *
 * Part of the contract rather than a client's own palette, because the planned
 * ribbon arrives coloured by the server and the lived part is coloured by the
 * client from the activity name — two tables would make the same hour change
 * colour as it crossed the now-marker.
 */
export const ACTIVITY_COLORS: Record<string, string> = {
  Sleep: "#6366F1",
  Life: "#5B8CFF",
  "Life Admin": "#5B8CFF",
  "Deep Work": "#A78BFA",
  Study: "#C084FC",
  Health: "#34D399",
  Break: "#94A3B8",
  Startup: "#FBBF24",
  Exercise: "#34D399",
  Exploration: "#F472B6",
};

export function activityColor(activity: string): string {
  return ACTIVITY_COLORS[activity] ?? "#5B8CFF";
}

/** Clock hour 0–24, which is the axis the ribbon is drawn against. */
function clockHour(d: Date): number {
  return d.getHours() + d.getMinutes() / 60;
}

export interface TimelineSegment extends RibbonSegment {
  /** True behind the now-marker: what happened. False ahead: what is planned. */
  actual: boolean;
}

/**
 * The ribbon, cut at `now`: what was lived behind the marker, the plan ahead of
 * it.
 *
 * This used to be computed on the server and shipped pre-cut, which is why a
 * poll had to re-send the day to move a marker. It is forty lines and it needs
 * one thing the server does not have, so it lives here and both clients call
 * it. An hour with no record stays an explicit `unlogged` segment rather than
 * being papered over with the plan — an hour you did not log is information,
 * not a Deep Work block you can take credit for.
 */
export function composeTimeline(
  ribbon: RibbonSegment[],
  lived: LoggedInterval[],
  colorOf: (activity: string) => string,
  now = new Date(),
): TimelineSegment[] {
  const nowHour = clockHour(now);
  const out: TimelineSegment[] = [];
  let cursor = 0;

  const unlogged = (from: number, to: number): TimelineSegment => ({
    id: `unlogged-${from.toFixed(3)}`,
    category: "Unlogged",
    label: "Not recorded",
    startHour: from,
    endHour: to,
    color: "rgba(255,255,255,0.05)",
    status: "unlogged",
    actual: true,
  });

  const ordered = [...lived].sort((a, b) => a.startedAt.localeCompare(b.startedAt));
  for (const entry of ordered) {
    const from = Math.max(0, Math.min(24, clockHour(new Date(entry.startedAt))));
    const to = Math.max(
      from,
      Math.min(
        nowHour,
        entry.endedAt ? clockHour(new Date(entry.endedAt)) : nowHour,
      ),
    );
    if (to <= from + 1e-6) continue;
    if (from > cursor + 1e-6) out.push(unlogged(cursor, from));
    out.push({
      id: `did-${entry.id}`,
      category: entry.activity,
      label: entry.activity,
      startHour: from,
      endHour: to,
      color: colorOf(entry.activity),
      status: "done",
      actual: true,
    });
    cursor = to;
  }
  if (nowHour > cursor + 1e-6) out.push(unlogged(cursor, nowHour));

  for (const seg of ribbon) {
    const startHour = Math.max(seg.startHour, nowHour);
    if (seg.endHour <= startHour + 1e-6) continue;
    out.push({ ...seg, startHour, actual: false });
  }

  return out;
}
