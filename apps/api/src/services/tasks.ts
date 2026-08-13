import { and, eq, isNotNull } from "drizzle-orm";
import { nanoid } from "nanoid";
import type { LifeOsDb } from "@life-os/db";
import * as schema from "@life-os/db";
import {
  IMMINENT_WINDOW_MINUTES,
  SPACED_OFFSETS_DAYS,
  isCardImminent,
  isReminderDue,
  isTaskKind,
  nextOccurrence,
  notifyAt,
  sanitizeSvg,
  shiftSchedule,
  validateCardControl,
  validateCardSchedule,
  type Activity,
  type CardControl,
  type RepeatRule,
  type Task,
  type TaskKind,
  type TaskResource,
  type TaskStatus,
} from "@life-os/shared";
import { addXp, getSettingsRow, nowIso } from "./helpers.js";
import { createStudySession } from "./study.js";
import { fireAgentWebhook } from "./webhook.js";

/**
 * Tasks — one of the two nouns in Life OS, the other being habits.
 *
 * This replaces four services that were doing the same job: scheduled cards,
 * agent events, light reviews, and study blocks. They differed in which fields
 * they supported, not in what they meant, so an agent had to pick a table and
 * live with whatever that table happened not to support. Now every optional
 * part — a time, a repeat, XP, links, a card presentation — is a nullable
 * column on one row.
 *
 * A task never starts. It has a target time and a completion, and completing it
 * does not touch what activity the user is in.
 */

const MAX_ACTIVE_TASKS = 500;

function parseJson<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function mapTask(row: typeof schema.tasks.$inferSelect): Task {
  const slot = row.slot === 0 || row.slot === 1 ? row.slot : null;
  return {
    id: row.id,
    kind: (isTaskKind(row.kind) ? row.kind : "task") as TaskKind,
    title: row.title,
    subtitle: row.subtitle ?? null,
    body: row.body ?? null,
    purpose: row.purpose ?? null,
    status: (row.status as TaskStatus) ?? "active",
    activityTag: (row.activityTag as Activity | null) ?? null,
    showAt: row.showAt ?? null,
    eventAt: row.eventAt ?? null,
    durationMinutes: row.durationMinutes ?? null,
    remindAt: row.remindAt ?? null,
    notifiedAt: row.notifiedAt ?? null,
    repeatRule: (row.repeatRule as RepeatRule) ?? "none",
    repeatIndex: row.repeatIndex ?? 0,
    repeatOffsetsDays: parseJson<number[] | null>(row.repeatOffsetsJson, null),
    xpOnComplete: row.xpOnComplete ?? 0,
    webhookOnComplete: Boolean(row.webhookOnComplete),
    webhookOnInteract: Boolean(row.webhookOnInteract),
    resources: parseJson<TaskResource[]>(row.resourcesJson, []),
    slot,
    emoji: row.emoji ?? null,
    themeColor: row.themeColor ?? null,
    imageUrl: row.imageUrl ?? null,
    imageData: row.imageData ?? null,
    svg: row.svg ?? null,
    ctaLabel: row.ctaLabel ?? null,
    ctaLink: row.ctaLink ?? null,
    control: parseJson<CardControl | null>(row.controlJson, null),
    progress: row.progress ?? 0,
    sound: Boolean(row.sound),
    flash: Boolean(row.flash),
    source: (row.source as "agent" | "user") ?? "agent",
    meta: parseJson<Record<string, unknown> | null>(row.metaJson, null),
    completedAt: row.completedAt ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/** How many minutes ahead the user wants to be told. */
function reminderLead(db: LifeOsDb): number {
  const row = getSettingsRow(db) as { reminderLeadMinutes?: number };
  const n = Number(row.reminderLeadMinutes);
  return Number.isFinite(n) && n >= 0 ? n : IMMINENT_WINDOW_MINUTES;
}

/* --------------------------------------------------------------- reads */

export interface ListTasksOptions {
  status?: TaskStatus;
  kind?: TaskKind;
  /** Only tasks whose `showAt` has passed. */
  visibleOnly?: boolean;
}

export function listTasks(
  db: LifeOsDb,
  opts: ListTasksOptions = {},
  now = new Date(),
): Task[] {
  let rows = db.select().from(schema.tasks).all().map(mapTask);
  if (opts.status) rows = rows.filter((t) => t.status === opts.status);
  if (opts.kind) rows = rows.filter((t) => t.kind === opts.kind);
  if (opts.visibleOnly) {
    rows = rows.filter(
      (t) => !t.showAt || new Date(t.showAt).getTime() <= now.getTime(),
    );
  }
  // Soonest first; the undated tail keeps its creation order.
  return rows.sort((a, b) => {
    if (a.eventAt && b.eventAt) return a.eventAt.localeCompare(b.eventAt);
    if (a.eventAt) return -1;
    if (b.eventAt) return 1;
    return a.createdAt.localeCompare(b.createdAt);
  });
}

export function getTask(db: LifeOsDb, id: string): Task | null {
  const row = db.select().from(schema.tasks).where(eq(schema.tasks.id, id)).get();
  return row ? mapTask(row) : null;
}

/** Everything open and visible — what the Timeline tab shows. */
export function listOpenTasks(db: LifeOsDb, now = new Date()): Task[] {
  return listTasks(db, { status: "active", visibleOnly: true }, now);
}

/**
 * What is current: inside the notification lead window and not yet past its
 * own end. This is Quick log, and it deliberately drops things whose window
 * has closed — otherwise every missed item piles up on the front page forever.
 */
export function listCurrentTasks(db: LifeOsDb, now = new Date()): Task[] {
  const lead = reminderLead(db);
  return listOpenTasks(db, now).filter((t) => isCardImminent(t, now, lead));
}

/** Tasks whose notification is due and has not fired. */
export function listDueTasks(db: LifeOsDb, now = new Date()): Task[] {
  const lead = reminderLead(db);
  return listTasks(db, {}, now).filter((t) => isReminderDue(t, now, lead));
}

/** The two pinned front-page tasks, if any. */
export function listPinnedTasks(db: LifeOsDb): Task[] {
  return listTasks(db, { status: "active" })
    .filter((t) => t.slot === 0 || t.slot === 1)
    .sort((a, b) => (a.slot ?? 0) - (b.slot ?? 0));
}

/** When this task will next ping, honouring the user's lead. */
export function taskNotifyAt(db: LifeOsDb, task: Task): string | null {
  return notifyAt(task, reminderLead(db));
}

/* -------------------------------------------------------------- writes */

export interface CreateTaskInput {
  kind?: TaskKind;
  title: string;
  subtitle?: string | null;
  body?: string | null;
  purpose?: string | null;
  activityTag?: Activity | null;
  showAt?: string | null;
  eventAt?: string | null;
  remindAt?: string | null;
  durationMinutes?: number | null;
  repeatRule?: RepeatRule;
  repeatOffsetsDays?: number[] | null;
  xpOnComplete?: number;
  webhookOnComplete?: boolean;
  webhookOnInteract?: boolean;
  resources?: TaskResource[] | null;
  slot?: 0 | 1 | null;
  emoji?: string | null;
  themeColor?: string | null;
  imageUrl?: string | null;
  imageData?: string | null;
  svg?: string | null;
  ctaLabel?: string | null;
  ctaLink?: string | null;
  control?: unknown;
  progress?: number;
  sound?: boolean;
  flash?: boolean;
  source?: "agent" | "user";
  meta?: Record<string, unknown> | null;
}

export function createTask(
  db: LifeOsDb,
  input: CreateTaskInput,
): { task: Task } | { error: string } {
  const open = listTasks(db, { status: "active" }).length;
  if (open >= MAX_ACTIVE_TASKS) {
    return {
      error: `Too many open tasks (${open}). Complete or dismiss some before adding more.`,
    };
  }

  const schedule = validateCardSchedule({
    showAt: input.showAt,
    remindAt: input.remindAt,
    eventAt: input.eventAt,
    durationMinutes: input.durationMinutes,
  });
  if (!schedule.ok) return { error: `Invalid schedule: ${schedule.errors.join("; ")}` };

  if (input.repeatRule && input.repeatRule !== "none" && !input.eventAt) {
    return { error: "A repeating task needs an eventAt to repeat from" };
  }

  const sanitized = sanitizeSvg(input.svg);
  if (input.svg && !sanitized.svg) {
    return { error: `Invalid svg: ${sanitized.notes.join("; ")}` };
  }

  let control: CardControl | null = null;
  if (input.control) {
    const checked = validateCardControl(input.control);
    if (!checked.ok) return { error: `Invalid control: ${checked.error}` };
    control = checked.control;
  }

  /*
   * There are exactly two content slots. The HTTP route's schema already
   * rejects anything else, but MCP and internal callers reach this function
   * directly — and a row written with `slot: 7` would read back as unpinned
   * while the database quietly held a number that means nothing.
   */
  if (input.slot !== undefined && input.slot !== null) {
    if (input.slot !== 0 && input.slot !== 1) {
      return { error: "slot must be 0, 1, or null" as const };
    }
  }

  // A pinned slot holds exactly one task; claiming it evicts the incumbent
  // back to the unpinned pool rather than deleting someone's work.
  if (input.slot === 0 || input.slot === 1) {
    for (const occupant of listPinnedTasks(db).filter((t) => t.slot === input.slot)) {
      db.update(schema.tasks)
        .set({ slot: null, updatedAt: nowIso() })
        .where(eq(schema.tasks.id, occupant.id))
        .run();
    }
  }

  const id = nanoid();
  const now = nowIso();
  db.insert(schema.tasks)
    .values({
      id,
      kind: input.kind ?? "task",
      title: input.title,
      subtitle: input.subtitle ?? null,
      body: input.body ?? null,
      purpose: input.purpose ?? null,
      status: "active",
      activityTag: input.activityTag ?? null,
      showAt: schedule.normalized.showAt,
      eventAt: schedule.normalized.eventAt,
      durationMinutes: input.durationMinutes ?? null,
      remindAt: schedule.normalized.remindAt,
      notifiedAt: null,
      repeatRule: input.repeatRule ?? "none",
      repeatIndex: 0,
      repeatOffsetsJson: input.repeatOffsetsDays
        ? JSON.stringify(input.repeatOffsetsDays)
        : null,
      xpOnComplete: input.xpOnComplete ?? 0,
      webhookOnComplete: input.webhookOnComplete ?? false,
      webhookOnInteract: input.webhookOnInteract ?? false,
      resourcesJson: input.resources?.length ? JSON.stringify(input.resources) : null,
      slot: input.slot ?? null,
      emoji: input.emoji ?? defaultEmoji(input.kind ?? "task"),
      themeColor: input.themeColor ?? null,
      imageUrl: input.imageUrl || null,
      imageData: input.imageData ?? null,
      svg: sanitized.svg,
      ctaLabel: input.ctaLabel ?? null,
      ctaLink: input.ctaLink ?? null,
      controlJson: control ? JSON.stringify(control) : null,
      progress: input.progress ?? 0,
      sound: input.sound ?? true,
      flash: input.flash ?? true,
      source: input.source ?? "agent",
      metaJson: input.meta ? JSON.stringify(input.meta) : null,
      completedAt: null,
      createdAt: now,
      updatedAt: now,
      sourceTable: null,
      sourceId: null,
    })
    .run();

  return { task: getTask(db, id)! };
}

function defaultEmoji(kind: TaskKind): string {
  switch (kind) {
    case "study":
      return "📚";
    case "review":
      return "📝";
    case "reminder":
      return "🔔";
    default:
      return "📌";
  }
}

export function updateTask(
  db: LifeOsDb,
  id: string,
  patch: Partial<CreateTaskInput> & { status?: TaskStatus },
): { task: Task } | { error: string } {
  const existing = getTask(db, id);
  if (!existing) return { error: "Task not found" };

  // Validate the *resulting* schedule, not just the patched fields — moving
  // eventAt earlier can invalidate a remindAt that was already stored.
  const merged = {
    showAt: patch.showAt !== undefined ? patch.showAt : existing.showAt,
    remindAt: patch.remindAt !== undefined ? patch.remindAt : existing.remindAt,
    eventAt: patch.eventAt !== undefined ? patch.eventAt : existing.eventAt,
    durationMinutes:
      patch.durationMinutes !== undefined
        ? patch.durationMinutes
        : existing.durationMinutes,
  };
  const schedule = validateCardSchedule(merged);
  if (!schedule.ok) return { error: `Invalid schedule: ${schedule.errors.join("; ")}` };

  let controlPatch: { controlJson?: string | null } = {};
  if (patch.control !== undefined) {
    if (patch.control === null) {
      controlPatch = { controlJson: null };
    } else {
      const checked = validateCardControl(patch.control);
      if (!checked.ok) return { error: `Invalid control: ${checked.error}` };
      controlPatch = { controlJson: JSON.stringify(checked.control) };
    }
  }

  let svgPatch: { svg?: string | null } = {};
  if (patch.svg !== undefined) {
    const sanitized = sanitizeSvg(patch.svg);
    if (patch.svg && !sanitized.svg) {
      return { error: `Invalid svg: ${sanitized.notes.join("; ")}` };
    }
    svgPatch = { svg: sanitized.svg };
  }

  // Moving the time re-arms the notification; otherwise a rescheduled task
  // would stay silent because it had already pinged at its old time.
  const rescheduled =
    schedule.normalized.eventAt !== existing.eventAt ||
    schedule.normalized.remindAt !== existing.remindAt;

  db.update(schema.tasks)
    .set({
      ...(patch.kind !== undefined ? { kind: patch.kind } : {}),
      ...(patch.title !== undefined ? { title: patch.title } : {}),
      ...(patch.subtitle !== undefined ? { subtitle: patch.subtitle } : {}),
      ...(patch.body !== undefined ? { body: patch.body } : {}),
      ...(patch.purpose !== undefined ? { purpose: patch.purpose } : {}),
      ...(patch.status !== undefined ? { status: patch.status } : {}),
      ...(patch.activityTag !== undefined ? { activityTag: patch.activityTag } : {}),
      showAt: schedule.normalized.showAt,
      eventAt: schedule.normalized.eventAt,
      remindAt: schedule.normalized.remindAt,
      durationMinutes: merged.durationMinutes ?? null,
      ...(rescheduled ? { notifiedAt: null } : {}),
      ...(patch.repeatRule !== undefined ? { repeatRule: patch.repeatRule } : {}),
      ...(patch.repeatOffsetsDays !== undefined
        ? {
            repeatOffsetsJson: patch.repeatOffsetsDays
              ? JSON.stringify(patch.repeatOffsetsDays)
              : null,
          }
        : {}),
      ...(patch.xpOnComplete !== undefined ? { xpOnComplete: patch.xpOnComplete } : {}),
      ...(patch.webhookOnComplete !== undefined
        ? { webhookOnComplete: patch.webhookOnComplete }
        : {}),
      ...(patch.webhookOnInteract !== undefined
        ? { webhookOnInteract: patch.webhookOnInteract }
        : {}),
      ...(patch.resources !== undefined
        ? {
            resourcesJson: patch.resources?.length
              ? JSON.stringify(patch.resources)
              : null,
          }
        : {}),
      ...(patch.slot !== undefined ? { slot: patch.slot } : {}),
      ...(patch.emoji !== undefined ? { emoji: patch.emoji } : {}),
      ...(patch.themeColor !== undefined ? { themeColor: patch.themeColor } : {}),
      ...(patch.imageUrl !== undefined ? { imageUrl: patch.imageUrl } : {}),
      ...(patch.imageData !== undefined ? { imageData: patch.imageData } : {}),
      ...svgPatch,
      ...(patch.ctaLabel !== undefined ? { ctaLabel: patch.ctaLabel } : {}),
      ...(patch.ctaLink !== undefined ? { ctaLink: patch.ctaLink } : {}),
      ...controlPatch,
      ...(patch.progress !== undefined ? { progress: patch.progress } : {}),
      ...(patch.sound !== undefined ? { sound: patch.sound } : {}),
      ...(patch.flash !== undefined ? { flash: patch.flash } : {}),
      ...(patch.meta !== undefined
        ? { metaJson: patch.meta ? JSON.stringify(patch.meta) : null }
        : {}),
      updatedAt: nowIso(),
    })
    .where(eq(schema.tasks.id, id))
    .run();

  return { task: getTask(db, id)! };
}

export function deleteTask(db: LifeOsDb, id: string) {
  db.delete(schema.tasks).where(eq(schema.tasks.id, id)).run();
  return { ok: true as const };
}

/** Record that a client actually raised the notification, so it fires once. */
export function markTaskNotified(db: LifeOsDb, id: string) {
  const task = getTask(db, id);
  if (!task) return { error: "Task not found" as const };
  db.update(schema.tasks)
    .set({ notifiedAt: nowIso(), updatedAt: nowIso() })
    .where(eq(schema.tasks.id, id))
    .run();
  return { task: getTask(db, id)! };
}

/**
 * Complete a task.
 *
 * A repeating task spawns its next occurrence as a **new** row, so the one just
 * finished stays in history and keeps counting. Rewinding it in place would
 * make "how many times did I actually do this" unanswerable.
 */
export async function completeTask(
  db: LifeOsDb,
  id: string,
  opts: { note?: string | null; source?: "user" | "agent"; progress?: number } = {},
) {
  const task = getTask(db, id);
  if (!task) return { error: "Task not found" as const };

  const now = nowIso();
  const xp = task.xpOnComplete > 0 ? task.xpOnComplete : 0;
  if (xp > 0) addXp(db, xp);

  db.update(schema.tasks)
    .set({
      status: "done",
      progress: opts.progress ?? 100,
      completedAt: now,
      updatedAt: now,
    })
    .where(eq(schema.tasks.id, id))
    .run();

  let next: Task | null = null;
  if (task.repeatRule !== "none" && task.eventAt) {
    const at = nextOccurrence(
      task.repeatRule,
      new Date(task.eventAt),
      task.repeatIndex,
      task.repeatOffsetsDays ?? SPACED_OFFSETS_DAYS,
    );
    if (at) {
      // Preserve the lead times the agent chose: "show 2h before, ping 10min
      // before" survives repetition instead of collapsing to the raw instant.
      const shifted = shiftSchedule(
        { showAt: task.showAt, remindAt: task.remindAt, eventAt: task.eventAt },
        at,
      );
      const created = createTask(db, {
        kind: task.kind,
        title: task.title,
        subtitle: task.subtitle,
        body: task.body,
        purpose: task.purpose,
        activityTag: task.activityTag,
        showAt: shifted.showAt,
        remindAt: shifted.remindAt,
        eventAt: shifted.eventAt,
        durationMinutes: task.durationMinutes,
        repeatRule: task.repeatRule,
        repeatOffsetsDays: task.repeatOffsetsDays,
        xpOnComplete: task.xpOnComplete,
        webhookOnComplete: task.webhookOnComplete,
        webhookOnInteract: task.webhookOnInteract,
        resources: task.resources,
        emoji: task.emoji,
        themeColor: task.themeColor,
        ctaLabel: task.ctaLabel,
        ctaLink: task.ctaLink,
        control: task.control,
        sound: task.sound,
        flash: task.flash,
        source: task.source,
        meta: task.meta,
      });
      if ("task" in created) {
        db.update(schema.tasks)
          .set({ repeatIndex: task.repeatIndex + 1 })
          .where(eq(schema.tasks.id, created.task.id))
          .run();
        next = getTask(db, created.task.id);
      }
    }
  }

  /*
   * Completing a study task records a study session, which is what feeds study
   * minutes and the analytics page.
   *
   * The duration is the window the agent planned, not a stopwatch. That is the
   * honest number: timing from whenever you happened to press a button made a
   * block you forgot to start one minute long, and one you forgot to stop ran
   * until you noticed. There is no button now, so there is nothing to forget.
   */
  let study = null;
  if (task.kind === "study") {
    study = createStudySession(db, {
      title: task.title,
      durationMinutes: task.durationMinutes ?? null,
      note: opts.note ?? null,
      source: opts.source ?? "user",
      blockId: task.id,
      linkedBookSlug:
        typeof task.meta?.bookSlug === "string" ? task.meta.bookSlug : null,
      linkedConceptSlug:
        typeof task.meta?.conceptSlug === "string" ? task.meta.conceptSlug : null,
    });
  }

  const completed = getTask(db, id)!;
  let webhook = null;
  if (task.webhookOnComplete) {
    const event =
      task.kind === "study"
        ? "study.complete"
        : task.kind === "review"
          ? "review.complete"
          : "card.complete";
    webhook = await fireAgentWebhook(db, event, {
      task: completed,
      title: completed.title,
      note: opts.note ?? null,
      source: opts.source ?? "user",
      xpAwarded: xp,
      nextOccurrence: next,
    });
  }

  return { task: completed, xpAwarded: xp, nextOccurrence: next, study, webhook };
}

/** Put a task away without doing it. Distinct from done, and it stays in history. */
export function dismissTask(db: LifeOsDb, id: string) {
  const task = getTask(db, id);
  if (!task) return { error: "Task not found" as const };
  db.update(schema.tasks)
    .set({ status: "dismissed", updatedAt: nowIso() })
    .where(eq(schema.tasks.id, id))
    .run();
  return { task: getTask(db, id)! };
}

/**
 * Use a task's control. Not a completion — an agent asking "how did that feel?"
 * wants the answer, not the task gone.
 */
export async function interactWithTask(
  db: LifeOsDb,
  id: string,
  input: { value?: number; pressed?: boolean },
) {
  const task = getTask(db, id);
  if (!task) return { error: "Task not found" as const };
  if (!task.control) return { error: "This task has no control" as const };

  let next: CardControl;
  if (task.control.kind === "slider") {
    if (typeof input.value !== "number" || !Number.isFinite(input.value)) {
      return { error: "A slider interaction needs a numeric `value`" as const };
    }
    const checked = validateCardControl({ ...task.control, value: input.value });
    if (!checked.ok) return { error: checked.error };
    next = checked.control;
  } else {
    next = { ...task.control, pressedAt: nowIso() };
  }

  db.update(schema.tasks)
    .set({ controlJson: JSON.stringify(next), updatedAt: nowIso() })
    .where(eq(schema.tasks.id, id))
    .run();

  const updated = getTask(db, id)!;
  let webhook = null;
  if (task.webhookOnInteract) {
    webhook = await fireAgentWebhook(db, "card.interaction", {
      task: updated,
      title: updated.title,
      control: next,
      value: next.kind === "slider" ? next.value : true,
    });
  }

  return { task: updated, control: next, webhook };
}

/**
 * Tasks completed on a given local day. Used by analytics and by the
 * "done today" list.
 */
export function listCompletedTasks(db: LifeOsDb, dateStr: string): Task[] {
  return db
    .select()
    .from(schema.tasks)
    .where(and(eq(schema.tasks.status, "done"), isNotNull(schema.tasks.completedAt)))
    .all()
    .map(mapTask)
    .filter((t) => (t.completedAt ?? "").slice(0, 10) === dateStr);
}
