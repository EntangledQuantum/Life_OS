/**
 * The sync engine: one poll, one write path, one copy of the state.
 *
 * `GET /api/v1/dashboard/today` returned the whole day — 2.26 MB on the user's
 * real data, 97% of it base64 artwork — and four separate queries in this app
 * asked for it on four different intervals. This module replaces all of them
 * with a single conditional poll that is 314 bytes when nothing has changed, or
 * nothing at all when the `ETag` still matches.
 *
 * Everything about *what* the protocol means is in `sync-state.ts`, which is
 * pure and tested. What is here is the part that needs a browser: the fetch
 * loop, the cursor and mutation counter in `localStorage`, and a subscription
 * shaped for `useSyncExternalStore`.
 *
 * Three properties worth stating, because each one is a bug if it is absent:
 *
 * - **A `304` costs nothing.** The snapshot object is not replaced, so every
 *   subscriber's reference equality holds and React re-renders nobody. An
 *   engine that rebuilt its state on every poll would be cheap on the wire and
 *   exactly as expensive as before on the main thread.
 * - **The cursor is stored after the delta is applied**, never before. A crash
 *   in between then costs one redundant delta instead of losing rows forever.
 * - **A write takes its new state from its own reply.** Nothing in this app
 *   refetches after writing.
 *
 * Nothing is reported anywhere. There is no telemetry, no analytics and no
 * crash reporting in this file or anywhere near it; the only host it ever talks
 * to is the user's own server.
 */
import {
  isLifeDayBound,
  type SyncEnvelope,
  type SyncMutation,
  type SyncMutationName,
  type SyncMutationResult,
} from "@life-os/shared";
import { SyncError, syncPush, syncRead } from "./api";
import {
  applyEnvelope,
  emptyState,
  type SyncState,
} from "./sync-state";

/** How often to ask. The same eight seconds the old dashboard query used. */
export const POLL_INTERVAL_MS = 8_000;

/*
 * Bumped when the persisted shape changes, which throws away the cached state
 * rather than feeding an older layout to newer code. The cursor goes with it,
 * so the next poll is a cold sync — correct, and the only safe reading of "we
 * do not know what this is".
 */
const STORE_KEY = "lifeos.sync.v4";
const CLIENT_KEY = "lifeos.sync.clientId";
const COUNTER_KEY = "lifeos.sync.mutationId";

/* ------------------------------------------------------------- persistence */

/**
 * Read the cached state back.
 *
 * Every failure path returns a cold state rather than throwing: storage is
 * unavailable in some privacy modes, quota-limited in all of them, and a half
 * written entry is indistinguishable from a corrupt one. A cold start is slow
 * once and correct always.
 */
function load(): SyncState {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return emptyState();
    const parsed = JSON.parse(raw) as Partial<SyncState>;
    if (!parsed || typeof parsed !== "object" || !parsed.cursor) {
      return emptyState();
    }
    return {
      ...emptyState(),
      ...parsed,
      /*
       * The offset is deliberately not restored. It was measured against a
       * clock reading from whenever this tab last ran, which may be days ago,
       * and a stale correction is worse than none — the next response supplies
       * a fresh one a few hundred milliseconds from now.
       */
      clockOffsetMs: 0,
    } as SyncState;
  } catch {
    return emptyState();
  }
}

function save(state: SyncState): void {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(state));
  } catch {
    /*
     * Over quota, or storage denied. The session keeps working entirely from
     * memory; all that is lost is resuming from a cursor after a reload, which
     * costs one cold sync.
     */
  }
}

/** Stable per installation. A cleared browser is a new client, which is correct. */
function clientId(): string {
  try {
    const existing = localStorage.getItem(CLIENT_KEY);
    if (existing) return existing;
    const minted = `web-${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
    localStorage.setItem(CLIENT_KEY, minted);
    return minted;
  } catch {
    return "web-ephemeral";
  }
}

/**
 * The mutation counter, persisted.
 *
 * It must come from a counter that survives a reload and increments by exactly
 * one, because that is what lets the server recognise a retry and refuse to
 * complete a habit twice. A random id or a timestamp would make every resend a
 * fresh write.
 */
function readCounter(): number {
  try {
    const n = Number(localStorage.getItem(COUNTER_KEY));
    return Number.isInteger(n) && n >= 0 ? n : 0;
  } catch {
    return 0;
  }
}

function writeCounter(n: number): void {
  try {
    localStorage.setItem(COUNTER_KEY, String(n));
  } catch {
    /* in-memory for this session; the server's duplicate check still holds */
  }
}

/* ------------------------------------------------------------------ store */

export type SyncStatus = "idle" | "syncing" | "offline" | "unauthorized" | "outdated";

export interface SyncSnapshot {
  state: SyncState;
  status: SyncStatus;
  /** The last error worth showing, or null. Never contains the token. */
  error: string | null;
}

let snapshot: SyncSnapshot = {
  state: typeof localStorage === "undefined" ? emptyState() : load(),
  status: "idle",
  error: null,
};

const listeners = new Set<() => void>();

/**
 * Publish a snapshot, but only when it is genuinely different.
 *
 * This guard is the whole of "a `304` costs no re-render". The obvious version
 * of this module emits a `syncing` snapshot when a poll starts and an `idle`
 * one when it ends, plus the bytes and the timing — and then every subscriber
 * re-renders twice every eight seconds for ever, no matter how empty the
 * response was. The wire would be cheap and the main thread would be exactly as
 * busy as before, which is the failure mode this rewrite exists to remove.
 *
 * `state` is compared by reference on purpose: `applyEnvelope` returns a new
 * object when and only when something was applied.
 */
function emit(next: SyncSnapshot): void {
  if (
    next.state === snapshot.state &&
    next.status === snapshot.status &&
    next.error === snapshot.error
  ) {
    return;
  }
  snapshot = next;
  for (const listener of listeners) listener();
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

export function getSnapshot(): SyncSnapshot {
  return snapshot;
}

/**
 * The entities and documents alone.
 *
 * What every screen subscribes to. Separate from the snapshot because a
 * transient connection error should not re-render the day, and the day should
 * not re-render to announce that it is unchanged.
 */
export function getStateSnapshot(): SyncState {
  return snapshot.state;
}

/** Bytes and milliseconds of the last poll. Not part of any snapshot: see `emit`. */
let lastPoll: { bytes: number; ms: number; status: number } | null = null;

export function getLastPoll() {
  return lastPoll;
}

/** The server's view of our mutation numbering, for the queue's own bookkeeping. */
let counter = typeof localStorage === "undefined" ? 0 : readCounter();

/* ------------------------------------------------------------------- read */

let inFlight: Promise<void> | null = null;

/**
 * One poll.
 *
 * Collapses onto the in-flight request if there already is one. The old payload
 * took 14.6 s a poll over the relay on an 8 s interval, so polls overlapped
 * permanently and the app never reached a steady state; an unchanged poll is
 * milliseconds now, but a slow link is still a slow link and two of these
 * racing would apply two deltas built from different cursors.
 */
export function pull(): Promise<void> {
  if (inFlight) return inFlight;
  inFlight = run().finally(() => {
    inFlight = null;
  });
  return inFlight;
}

async function run(): Promise<void> {
  const begun = performance.now();
  const { state } = snapshot;

  try {
    const read = await syncRead(state.cursor, state.etag);
    const ms = Math.round(performance.now() - begun);
    lastPoll = { bytes: read.bytes, ms, status: read.status };

    /*
     * The success case, and the common one. Nothing is applied, nothing is
     * stored, and — the part that matters — `state` keeps its identity, so no
     * subscriber re-renders. Our cursor is still correct by definition: the
     * validator only matches when the answer would have been the same.
     */
    if (read.status === 304) {
      emit({ ...snapshot, status: "idle", error: null });
      return;
    }

    if (!read.envelope) return;
    emit({
      ...snapshot,
      state: applyAndStore(read.envelope, read.etag),
      status: "idle",
      error: null,
    });
  } catch (error) {
    emit({ ...snapshot, ...describe(error) });
  }
}

/**
 * Apply a delta, persist it, and hand the new state back.
 *
 * Shared by the poll and by a write's reply, because they carry the same
 * envelope — which is the reason a write needs no refetch.
 *
 * It deliberately does **not** publish, and must not: `emit` decides whether
 * anything changed by comparing against the snapshot it currently holds, so a
 * function that quietly moved the snapshot first would make every change look
 * like no change and no subscriber would ever be told. That bug is invisible in
 * a test that reads the state back directly, and on screen it is a dashboard
 * that cold-syncs successfully and then says "Loading…" for ever.
 */
function applyAndStore(envelope: SyncEnvelope, etag: string | null): SyncState {
  const applied = applyEnvelope(snapshot.state, envelope);
  /*
   * The validator belongs to the body we just applied. Keeping an older one
   * would mean the next conditional poll could match a response describing a
   * cursor we have already moved past.
   */
  applied.etag = etag;
  save(applied);
  return applied;
}

/**
 * Turn a failure into something the UI can say.
 *
 * `401` and `426` are terminal and must not be retried in a loop: the first
 * means the token is wrong or was rotated, the second means this build cannot
 * read what the server sends. Everything else is a sleeping machine or a
 * flaky tunnel, which is normal rather than a crash — the cached day stays on
 * screen, marked stale.
 */
function describe(error: unknown): Pick<SyncSnapshot, "status" | "error"> {
  if (error instanceof SyncError) {
    if (error.status === 401) {
      return { status: "unauthorized", error: error.message };
    }
    if (error.status === 426) return { status: "outdated", error: error.message };
    return { status: "offline", error: error.message };
  }
  return {
    status: "offline",
    error: error instanceof Error ? error.message : "Could not reach Life OS",
  };
}

/* ------------------------------------------------------------------ write */

export interface PushOutcome {
  results: SyncMutationResult[];
  /** The first result, which is what a single-mutation caller actually wants. */
  result: SyncMutationResult | null;
}

/**
 * Send one mutation and apply the delta it caused.
 *
 * The mutation's number comes from the persisted counter and goes up by exactly
 * one. A day-bound mutation is stamped with the life-day it was made on, so a
 * write that was in flight when the clock passed 04:00 is refused rather than
 * landing on the wrong day and corrupting a streak silently.
 *
 * Throws only on a genuine failure to reach the server. A mutation the server
 * refuses comes back as a `result` with a status on it, which the caller shows.
 */
export async function pushMutation(
  name: SyncMutationName,
  args: Record<string, unknown> = {},
): Promise<PushOutcome> {
  const lifeDayDate = snapshot.state.lifeDay?.lifeDay ?? null;
  if (isLifeDayBound(name) && !lifeDayDate) {
    /*
     * Nothing has synced yet, so we do not know which day it is — and a
     * day-bound mutation with no stamp is rejected by the server anyway.
     * Refusing here says so honestly instead of burning a counter value.
     */
    throw new Error("Not synced yet — try again in a moment");
  }

  const mutation: SyncMutation = {
    id: counter + 1,
    name,
    args,
    ...(isLifeDayBound(name) ? { lifeDayDate } : {}),
  };

  let outcome = await send([mutation]);

  /*
   * A hole in the numbering: a mutation we believe we sent never arrived, or
   * this browser's counter is behind the server's — the usual cause being
   * cleared storage. The server tells us where it is; renumber from there and
   * send once more. Not a loop: if it happens twice the second failure is real.
   */
  if (outcome.status === 409 && outcome.lastMutationId !== null) {
    counter = outcome.lastMutationId;
    writeCounter(counter);
    outcome = await send([{ ...mutation, id: counter + 1 }]);
  }

  if (!outcome.response) {
    throw new Error(outcome.error ?? "The write was refused");
  }

  counter = outcome.response.lastMutationId;
  writeCounter(counter);

  /*
   * The reply carries the delta from the cursor we sent to now, so applying it
   * is the whole of "find out what my write did". This is the refetch that no
   * longer happens.
   */
  emit({
    ...snapshot,
    state: applyAndStore(outcome.response.sync, null),
    status: "idle",
    error: null,
  });

  const results = outcome.response.results;
  return { results, result: results[0] ?? null };
}

function send(mutations: SyncMutation[]) {
  return syncPush({
    clientId: clientId(),
    since: snapshot.state.cursor,
    mutations,
  });
}

/**
 * A mutation's result as a plain outcome a caller can branch on.
 *
 * `duplicate` is a success. It covers "already completed today", which is the
 * common case when a tap is retried: the tick is on screen and the thing did
 * happen, so showing the user a failure for it would be a lie.
 */
export function wasApplied(result: SyncMutationResult | null): boolean {
  return result?.status === "applied" || result?.status === "duplicate";
}

/* ------------------------------------------------------------------ loop */

let timer: ReturnType<typeof setInterval> | null = null;
let started = false;

/**
 * Start polling. Idempotent, so mounting the shell twice is harmless.
 *
 * Polls on an interval, and again whenever the tab becomes visible — a laptop
 * that was closed for an hour should not show a stale day for up to eight
 * seconds after it is opened. A hidden tab keeps polling, because an unchanged
 * poll is free and a reminder is supposed to fire whether or not you are
 * looking at the tab.
 */
export function start(): void {
  if (started) return;
  started = true;

  void pull();
  timer = setInterval(() => {
    if (snapshot.status === "unauthorized" || snapshot.status === "outdated") {
      return;
    }
    void pull();
  }, POLL_INTERVAL_MS);

  document.addEventListener("visibilitychange", onVisible);
}

function onVisible(): void {
  if (document.visibilityState !== "visible") return;
  if (snapshot.status === "unauthorized" || snapshot.status === "outdated") return;
  void pull();
}

export function stop(): void {
  if (timer) clearInterval(timer);
  timer = null;
  started = false;
  document.removeEventListener("visibilitychange", onVisible);
}

/**
 * Throw the cached state away.
 *
 * For signing out, or for a token that was rotated: the next poll then cold
 * syncs. Not called on a `reset` from the server — that is handled inside
 * `applyEnvelope`, where the new state arrives in the same response.
 */
export function forget(): void {
  try {
    localStorage.removeItem(STORE_KEY);
    localStorage.removeItem(COUNTER_KEY);
  } catch {
    /* nothing to remove */
  }
  /*
   * The mutation counter goes too. A different instance has never seen this
   * client and starts it at zero, and the same instance answers a number it has
   * already applied with a `409` carrying the right one — which `pushMutation`
   * recovers from in a single resend. Keeping a counter from a database we are
   * no longer talking to is the version of this that cannot self-correct.
   */
  counter = 0;
  lastPoll = null;
  emit({ state: emptyState(), status: "idle", error: null });
}
