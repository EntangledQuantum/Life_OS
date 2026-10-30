/**
 * Incremental sync: the write side.
 *
 * A client used to write and then re-read the world to find out what its own
 * write had done — 2.26 MB to learn that a habit it had just ticked was ticked.
 * One call does both now: the mutations go up, the authoritative results and
 * the delta come back, and the client is already current the moment the
 * response lands.
 *
 * Three properties, in the order they matter:
 *
 * **Idempotent.** Each mutation carries a number that only goes up, per client.
 * A number at or below what has already been applied is recognised and skipped,
 * so an offline queue drained twice — the phone retried, a relay ate the
 * response — does not complete a habit twice and pay for it twice. Replicache
 * states these rules normatively and one of them is easy to get wrong in a way
 * that bites much later: **a mutation that can never succeed must still advance
 * the counter**, or the whole queue wedges behind it forever.
 *
 * **Day-safe.** A day-bound mutation is stamped with the life-day it was made
 * on and refused if the day has turned. The Android client already checks this
 * before sending; checking again here is not redundant, because the client
 * cannot catch a write that was in flight when the clock passed 04:00. A habit
 * completion replayed onto the wrong day silently corrupts a streak, which is
 * strictly worse than losing the write — so it is lost, visibly, and the user
 * is told.
 *
 * **Ordered and atomic per mutation.** They are applied in the order given and
 * each one's effect and its number land together, so a client can always resume
 * from `lastMutationId` and know exactly what did and did not happen.
 */
import { eq } from "drizzle-orm";
import type { LifeOsDb } from "@life-os/db";
import * as schema from "@life-os/db";
import {
  PROTOCOL_VERSION,
  activeSessionSchema,
  cardInteractSchema,
  completeCardSchema,
  completeHabitSchema,
  createStudySessionSchema,
  isLifeDayBound,
  SYNC_MUTATIONS,
  updateSettingsSchema,
  type SyncMutation,
  type SyncMutationResult,
  type SyncPushRequest,
  type SyncPushResponse,
} from "@life-os/shared";
import { agendaLifeDay } from "./agenda.js";
import { externalizeDeep } from "./assets.js";
import { buildDelta } from "./sync.js";
import * as habits from "./habits.js";
import * as tasks from "./tasks.js";
import * as goals from "./goals.js";
import * as sessions from "./sessions.js";
import * as study from "./study.js";
import * as settings from "./settings.js";

function readClient(db: LifeOsDb, clientId: string): number {
  const row = db
    .select()
    .from(schema.syncClients)
    .where(eq(schema.syncClients.clientId, clientId))
    .get();
  return row?.lastMutationId ?? 0;
}

function writeClient(db: LifeOsDb, clientId: string, lastMutationId: number) {
  db.insert(schema.syncClients)
    .values({ clientId, lastMutationId, lastSeenAt: new Date().toISOString() })
    .onConflictDoUpdate({
      target: schema.syncClients.clientId,
      set: { lastMutationId, lastSeenAt: new Date().toISOString() },
    })
    .run();
}

function str(args: Record<string, unknown>, key: string): string | null {
  const value = args[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

/**
 * Apply one mutation, by name.
 *
 * Every arm delegates to the same service function the REST route calls, so
 * there is exactly one implementation of completing a habit and no chance of
 * the two surfaces disagreeing about XP, streaks or webhooks. The zod schemas
 * are the same ones too — a malformed mutation is rejected here with the same
 * message the route would have produced.
 */
async function apply(
  db: LifeOsDb,
  mutation: SyncMutation,
): Promise<{ ok: true; result?: unknown } | { ok: false; error: string }> {
  const args = (mutation.args ?? {}) as Record<string, unknown>;

  switch (mutation.name) {
    case "habit.complete": {
      const id = str(args, "habitId") ?? str(args, "id");
      if (!id) return { ok: false, error: "habit.complete needs habitId" };
      const body = completeHabitSchema.parse({
        source: args.source ?? "user",
        note: args.note ?? null,
      });
      const result = habits.completeHabit(db, id, body);
      if ("error" in result) return { ok: false, error: result.error ?? "Mutation failed" };
      return { ok: true, result };
    }

    case "habit.undo": {
      const id = str(args, "habitId") ?? str(args, "id");
      if (!id) return { ok: false, error: "habit.undo needs habitId" };
      const result = habits.undoHabitCompletion(db, id);
      if ("error" in result) return { ok: false, error: result.error ?? "Mutation failed" };
      return { ok: true, result };
    }

    case "task.complete": {
      const id = str(args, "taskId") ?? str(args, "id");
      if (!id) return { ok: false, error: "task.complete needs taskId" };
      const body = completeCardSchema.parse({
        source: args.source ?? "user",
        ...(args.note === undefined ? {} : { note: args.note }),
        ...(args.progress === undefined ? {} : { progress: args.progress }),
      });
      const result = await tasks.completeTask(db, id, body);
      if ("error" in result) return { ok: false, error: result.error ?? "Mutation failed" };
      return { ok: true, result };
    }

    case "task.dismiss": {
      const id = str(args, "taskId") ?? str(args, "id");
      if (!id) return { ok: false, error: "task.dismiss needs taskId" };
      const result = tasks.dismissTask(db, id);
      if ("error" in result) return { ok: false, error: result.error ?? "Mutation failed" };
      return { ok: true, result };
    }

    case "task.notified": {
      const id = str(args, "taskId") ?? str(args, "id");
      if (!id) return { ok: false, error: "task.notified needs taskId" };
      const result = tasks.markTaskNotified(db, id);
      if ("error" in result) return { ok: false, error: result.error ?? "Mutation failed" };
      return { ok: true, result };
    }

    case "task.interact": {
      const id = str(args, "taskId") ?? str(args, "id");
      if (!id) return { ok: false, error: "task.interact needs taskId" };
      const body = cardInteractSchema.parse({
        ...(args.value === undefined ? {} : { value: args.value }),
        ...(args.pressed === undefined ? {} : { pressed: args.pressed }),
      });
      const result = await tasks.interactWithTask(db, id, body);
      if ("error" in result) return { ok: false, error: result.error ?? "Mutation failed" };
      return { ok: true, result };
    }

    case "goal.celebrationSeen": {
      const id = str(args, "goalId") ?? str(args, "id");
      if (!id) return { ok: false, error: "goal.celebrationSeen needs goalId" };
      const result = goals.markCelebrationSeen(
        db,
        id,
        str(args, "tier") ?? undefined,
      );
      if (!result) return { ok: false, error: "Goal not found" };
      if ("error" in result) return { ok: false, error: result.error ?? "Mutation failed" };
      return { ok: true, result: result.goal };
    }

    case "session.set": {
      const body = activeSessionSchema.parse({
        activity: args.activity,
        ...(args.startedAt === undefined ? {} : { startedAt: args.startedAt }),
        ...(args.blockId === undefined ? {} : { blockId: args.blockId }),
      });
      return {
        ok: true,
        result: sessions.setActiveSession(
          db,
          body.activity,
          body.startedAt,
          body.blockId,
        ),
      };
    }

    case "session.clear":
      return { ok: true, result: sessions.clearActiveSession(db) };

    case "study.create": {
      const body = createStudySessionSchema.parse(args);
      return { ok: true, result: study.createStudySession(db, body) };
    }

    case "settings.patch": {
      const body = updateSettingsSchema.parse(args);
      return { ok: true, result: settings.updateSettings(db, body) };
    }

    default:
      return { ok: false, error: `Unknown mutation "${mutation.name}"` };
  }
}

export interface PushOptions {
  /** Absolute base URL for asset links — where this request arrived. */
  base: string;
  now?: Date;
}

export type PushOutcome =
  | { ok: true; response: SyncPushResponse }
  /**
   * The client's numbering does not line up with the server's: it skipped
   * ahead, which means a mutation was lost rather than merely unacknowledged.
   * Applying what arrived would leave a hole nobody could ever fill, so the
   * whole batch is refused and the client is told where to resume from.
   */
  | { ok: false; status: 409; error: string; lastMutationId: number };

export async function push(
  db: LifeOsDb,
  request: SyncPushRequest,
  opts: PushOptions,
): Promise<PushOutcome> {
  const now = opts.now ?? new Date();
  const clientId = String(request.clientId ?? "").trim();
  if (!clientId) {
    return {
      ok: false,
      status: 409,
      error: "A push needs a stable clientId",
      lastMutationId: 0,
    };
  }

  const mutations = Array.isArray(request.mutations) ? request.mutations : [];
  let lastMutationId = readClient(db, clientId);

  /*
   * Check the whole batch's numbering before applying any of it. A gap means a
   * mutation never arrived; half-applying the rest would record a
   * `lastMutationId` past the hole and make the loss permanent and invisible.
   */
  for (const mutation of mutations) {
    if (!Number.isInteger(mutation?.id) || mutation.id <= 0) {
      return {
        ok: false,
        status: 409,
        error: "Every mutation needs a positive integer id",
        lastMutationId,
      };
    }
  }
  const ordered = [...mutations].sort((a, b) => a.id - b.id);
  let expected = lastMutationId;
  for (const mutation of ordered) {
    if (mutation.id <= lastMutationId) continue;
    expected += 1;
    if (mutation.id !== expected) {
      return {
        ok: false,
        status: 409,
        error:
          `Mutation ${mutation.id} arrived with ${expected} missing. Resend from ` +
          `${lastMutationId + 1}.`,
        lastMutationId,
      };
    }
  }

  const results: SyncMutationResult[] = [];
  const today = agendaLifeDay(db, now).lifeDay;

  for (const mutation of ordered) {
    if (mutation.id <= lastMutationId) {
      results.push({ id: mutation.id, status: "duplicate" });
      continue;
    }

    if (!(SYNC_MUTATIONS as readonly string[]).includes(mutation.name)) {
      lastMutationId = mutation.id;
      results.push({
        id: mutation.id,
        status: "rejected",
        error: `Unknown mutation "${mutation.name}"`,
      });
      continue;
    }

    if (isLifeDayBound(mutation.name)) {
      const stamp = mutation.lifeDayDate ?? null;
      if (!stamp) {
        lastMutationId = mutation.id;
        results.push({
          id: mutation.id,
          status: "rejected",
          error: `${mutation.name} must carry the lifeDayDate it was made on`,
        });
        continue;
      }
      if (stamp !== today) {
        /*
         * Advance past it anyway. The write is gone — deliberately — but the
         * queue behind it must not be: a stranded mutation that also blocks
         * every later one turns one lost tick into a dead client.
         */
        lastMutationId = mutation.id;
        results.push({
          id: mutation.id,
          status: "staleLifeDay",
          error:
            `This was done on ${stamp} and the life-day is now ${today}. ` +
            `Saving it would put it on the wrong day.`,
        });
        continue;
      }
    }

    let outcome: Awaited<ReturnType<typeof apply>>;
    try {
      outcome = await apply(db, mutation);
    } catch (error) {
      outcome = {
        ok: false,
        error: error instanceof Error ? error.message : "Mutation failed",
      };
    }

    lastMutationId = mutation.id;
    if (outcome.ok) {
      /*
       * Scrub the art out of whatever the service handed back. `completeHabit`
       * returns the habit it completed, and that arrived with 65 KB of base64
       * in it — which would have put the artwork back on the wire through the
       * write path after all the work to take it off the read path.
       */
      results.push({
        id: mutation.id,
        status: "applied",
        result: externalizeDeep(db, outcome.result, opts.base),
      });
    } else {
      /*
       * "Already completed today" is the one error a client treats as success,
       * and it is the common one: the optimistic tick is already on screen and
       * re-ticking is a no-op. Reported as a duplicate rather than a rejection
       * so the client resolves the write instead of showing the user a failure
       * for something that did in fact happen.
       */
      const duplicate = /already/i.test(outcome.error);
      results.push({
        id: mutation.id,
        status: duplicate ? "duplicate" : "rejected",
        error: outcome.error,
      });
    }
  }

  writeClient(db, clientId, lastMutationId);

  /*
   * Re-check the goals *before* building the delta, not after. The route-level
   * hook that normally does this runs once the response is already built, so a
   * habit completion that finishes a goal would have had its celebration
   * arrive a poll late — visible as a trophy that appears several seconds after
   * the tick that earned it.
   */
  if (results.some((r) => r.status === "applied")) {
    try {
      goals.evaluateGoals(db);
    } catch (error) {
      console.warn("[sync] goal evaluation after push failed:", error);
    }
  }

  const { envelope } = buildDelta(db, {
    since: request.since ?? null,
    base: opts.base,
    now,
  });

  return {
    ok: true,
    response: {
      protocol: PROTOCOL_VERSION,
      lastMutationId,
      results,
      sync: envelope,
    },
  };
}
