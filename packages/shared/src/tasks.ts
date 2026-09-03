/**
 * There are two nouns in Life OS: **habits** and **tasks**. Nothing else.
 *
 * Before this, the same idea was spread across four tables that behaved almost
 * but not quite alike — `dashboard_cards` (scheduled events and reminders),
 * `agent_events` (queued agent work), `light_reviews` (prompts), and
 * `schedule_blocks` (study). An agent had to pick one, and picking wrong meant
 * the thing showed up in the wrong place, counted toward nothing, and could not
 * be repeated. Users saw the seams: "a card to complete, but also a session?"
 *
 * A task is one thing with optional parts:
 *
 * - **When** — `eventAt` plus `durationMinutes`. Optional; a task with no time
 *   is just a thing to do.
 * - **Repeat** — daily, weekly, or a spaced ladder. This is what lets Life OS
 *   schedule its own recurring work instead of an agent re-creating it nightly.
 * - **Tag** — which bucket of the day it belongs to, for colour and grouping.
 * - **Reward** — XP on completion.
 * - **Presentation** — a task can be *shown as a card*: emoji, body, image,
 *   SVG, an interactive control. A card is a way of drawing a task, never a
 *   separate kind of object.
 * - **Resources** — links and references, which is all a "study block" ever was.
 *
 * It never starts. It has a target time and a completion, and completing it
 * does not change what activity the user is in.
 */
import type { CardStyle } from "./card-style.js";
import type { Activity, RepeatRule } from "./constants.js";
import type { CardControl } from "./webhooks.js";

/**
 * What flavour of work this is. Presentation and grouping only — every kind
 * behaves identically, which is the entire point of collapsing them.
 */
export const TASK_KINDS = ["task", "study", "review", "reminder"] as const;
export type TaskKind = (typeof TASK_KINDS)[number];

/**
 * `missed` is what a scheduled thing becomes when its life-day ends without it.
 *
 * It used to stay `active` forever, so yesterday's leftovers sat on today's
 * list and completing one paid out today's XP for something that happened —
 * or did not happen — yesterday. A day that is over is over; the row stays as
 * a record of what was planned and not done, which is information, not a
 * chore carried forward.
 */
export const TASK_STATUSES = ["active", "done", "dismissed", "missed"] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export function isTaskKind(value: unknown): value is TaskKind {
  return typeof value === "string" && (TASK_KINDS as readonly string[]).includes(value);
}

/** A link the agent attached — a chapter, a paper, a video. */
export interface TaskResource {
  label: string;
  url: string;
  /** Free-form hint for the icon: "book", "video", "paper", "link". */
  kind?: string;
}

export interface Task {
  id: string;
  kind: TaskKind;
  title: string;
  /** One line under the title. */
  subtitle: string | null;
  /** Long form — instructions, a chapter list, what to actually do. */
  body: string | null;
  /** What this is *for*, in the agent's words. Not shown as prominently. */
  purpose: string | null;

  status: TaskStatus;
  /** Which bucket of the day this belongs to. Colour and grouping, not control. */
  activityTag: Activity | null;

  /** Hidden until this instant. Null = visible now. */
  showAt: string | null;
  /** When it should happen. Null = no particular time. */
  eventAt: string | null;
  /** How long it is meant to take. Drives when it leaves the front page. */
  durationMinutes: number | null;
  /** Explicit override; normally derived from eventAt minus the user's lead. */
  remindAt: string | null;
  /** Set once a client has actually raised the notification. */
  notifiedAt: string | null;

  repeatRule: RepeatRule;
  /** Position on a spaced ladder. */
  repeatIndex: number;
  /** Custom spaced ladder in days; null uses the default. */
  repeatOffsetsDays: number[] | null;

  xpOnComplete: number;
  webhookOnComplete: boolean;
  webhookOnInteract: boolean;

  /** Links and references. What a "study block" always was underneath. */
  resources: TaskResource[];

  /**
   * Layout and paint for a pinned card. Null renders exactly as cards always
   * have — the arrangement used to be fixed and this is what unfixed it.
   */
  cardStyle: CardStyle | null;

  /**
   * The habit this task is *about*, if any.
   *
   * A pointer, not a coupling: completing the card does not complete the habit
   * and the habit does not complete the card. An agent card explaining where
   * the reading habit stands is not the reading habit. The link exists so a
   * client can show the relationship instead of leaving the user to infer it
   * from two similar titles sitting next to each other.
   */
  habitId: string | null;
  /**
   * The scheduled task this card is *about*, if any.
   *
   * Same rule as `habitId`: a pointer, not a coupling. It lets a card explain a
   * block on the timeline — "here is what tonight's study session is for" —
   * without becoming a second copy of that block, which is the duplication this
   * whole model exists to avoid.
   */
  linkedTaskId: string | null;

  /** Pinned to a front-page card slot (0 or 1). Null = not pinned. */
  slot: 0 | 1 | null;
  emoji: string | null;
  themeColor: string | null;
  /**
   * The card's picture: what it is *about*. Where it goes is
   * `cardStyle.layout` — a banner, a wash behind the text, or the tile.
   */
  imageUrl: string | null;
  imageData: string | null;
  /**
   * The card's icon: what marks it in a list of cards. Drawn in the small tile
   * beside the title, in place of the emoji, whatever the layout is.
   *
   * A separate slot on purpose. With one image field, `layout` had to decide
   * whether that picture was the atmosphere or the icon, so an agent could
   * never have both — a photograph behind the text *and* a cover beside the
   * title. Data URI or URL, same as the picture.
   */
  iconImageUrl: string | null;
  iconImageData: string | null;
  svg: string | null;
  ctaLabel: string | null;
  ctaLink: string | null;
  control: CardControl | null;

  /** Progress 0–100, for tasks that have a meaningful middle. */
  progress: number;
  /** Play a sound when its notification fires. */
  sound: boolean;
  /** Keep it visibly urgent until dealt with. */
  flash: boolean;

  source: "agent" | "user";
  /** Freeform agent state — book slug, chapter number, anything. */
  meta: Record<string, unknown> | null;

  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * Where a task came from, when it was carried over from one of the four old
 * tables. Kept so the import can run twice without duplicating anything, and so
 * a row can still be traced back if something looks wrong.
 */
export interface TaskOrigin {
  sourceTable: string | null;
  sourceId: string | null;
}

/** Is this task shown as a card on the front page? */
export function isPinned(task: Pick<Task, "slot">): boolean {
  return task.slot === 0 || task.slot === 1;
}

/**
 * The agent status strip — "Hermes connected", with whatever the agent wrote
 * about itself. It is a task only because everything is; it has no completion,
 * no slot, and renders as one ambient line rather than a card.
 */
export function isAgentStatus(task: Pick<Task, "meta">): boolean {
  return Boolean(task.meta && "connected" in task.meta);
}

/**
 * Does this task carry enough presentation to be worth drawing as a card
 * rather than a list row? A title alone is a row; a body, an image or a
 * control is a card.
 */
export function hasCardPresentation(
  task: Pick<
    Task,
    | "body"
    | "imageUrl"
    | "imageData"
    | "iconImageUrl"
    | "iconImageData"
    | "svg"
    | "control"
  >,
): boolean {
  return Boolean(
    task.body ||
      task.imageUrl ||
      task.imageData ||
      task.iconImageUrl ||
      task.iconImageData ||
      task.svg ||
      task.control,
  );
}

/**
 * The two pictures a card can carry, resolved to what a renderer should draw.
 *
 * Both clients call this rather than reading four fields and picking, so the
 * phone and the dashboard cannot end up disagreeing about which image is the
 * icon — which is exactly how the single-slot version drifted.
 */
export function cardImages(
  task: Pick<Task, "imageUrl" | "imageData" | "iconImageUrl" | "iconImageData">,
): { media: string | null; icon: string | null } {
  return {
    // Inline data wins: it is already on the device and cannot fail to load.
    media: task.imageData || task.imageUrl || null,
    icon: task.iconImageData || task.iconImageUrl || null,
  };
}
