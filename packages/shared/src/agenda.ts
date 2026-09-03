/**
 * One list for the day, whatever the underlying row is.
 *
 * A habit and a scheduled task were two different shapes that meant the same
 * thing to the person looking at the screen: *something to do, maybe at a
 * time, tick it when it is done.* Keeping them apart forced every surface to
 * render two lists and forced agents to create two rows for one act — a habit
 * for the streak, and a task to carry the time. The user then had two things to
 * tick, and ticking both paid out twice.
 *
 * So the read side speaks in agenda items. A habit with a time and a task with
 * a time are the same item here, distinguished only by `source`, which is what
 * the client needs to know to complete the right thing.
 */
import type { TaskKind } from "./tasks.js";

export type AgendaSource = "habit" | "task";

export type AgendaState =
  /** Has a time, still ahead of now. */
  | "upcoming"
  /** Inside the notification lead window, or already running. */
  | "now"
  /** Done for this life-day. */
  | "done"
  /** Had a time today, and it went past without being done. */
  | "overdue"
  /** No time on it — do it whenever. */
  | "anytime";

export interface AgendaItem {
  /** Stable across a day: `habit:<id>` or `task:<id>`. */
  id: string;
  source: AgendaSource;
  /** The habit or task id, which is what you complete. */
  refId: string;

  title: string;
  subtitle: string | null;
  emoji: string | null;
  /** Which bucket of the day this belongs to. Colour and grouping only. */
  activityTag: string | null;
  /** Tasks only — presentation, never behaviour. */
  kind: TaskKind | null;

  /** When it happens today, as an instant. Null means no particular time. */
  at: string | null;
  durationMinutes: number | null;
  /** Wall-clock hours from the life-day's start, for drawing a ribbon. */
  startHour: number | null;
  endHour: number | null;

  state: AgendaState;
  done: boolean;
  xp: number;
  /** Habits only. */
  streak: number | null;
  /**
   * The habit this row concerns — itself for a habit row, the linked habit for
   * a task that names one. Lets a client mark everything about the same habit
   * without caring which table the row came from.
   */
  habitId: string | null;
  themeColor: string | null;
  /**
   * The row's icon picture, already resolved, or null for the usual emoji.
   *
   * One field rather than the four an icon is stored in: a list row wants the
   * picture or it wants the emoji, and making every client re-derive that from
   * `iconImageData ?? iconImageUrl` is how two clients end up disagreeing.
   * A background never appears here — a row is not a card, and a photograph
   * behind 40pt of text is unreadable at any scrim.
   */
  iconImage: string | null;
}

/** Sort: timed things in time order, then untimed, then done last. */
export function compareAgenda(a: AgendaItem, b: AgendaItem): number {
  if (a.done !== b.done) return a.done ? 1 : -1;
  if (a.at && b.at) return a.at.localeCompare(b.at);
  if (a.at) return -1;
  if (b.at) return 1;
  return a.title.localeCompare(b.title);
}
