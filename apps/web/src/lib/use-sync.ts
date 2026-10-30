/**
 * The React side of sync: one subscription, and a clock.
 *
 * The pages used to each run their own `useQuery(["dashboard"])` — four of
 * them, on four intervals, every one of them pulling the same 2.26 MB. They
 * call `useDashboard()` now and are otherwise unchanged, which was the point:
 * this was a transport and state-management rewrite, not a redesign.
 *
 * The clock is a hook rather than a value because of SYNC.md §2 rule 1. The
 * server no longer sends anything that depends on what time it is, so "what
 * time is it" became a render input — and a render input needs to be able to
 * change without a network round trip.
 */
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import {
  isReminderDueAt,
  type AppSettings,
  type DashboardToday,
  type Task,
} from "@life-os/shared";
import {
  getSnapshot,
  getStateSnapshot,
  subscribe,
  type SyncSnapshot,
} from "./sync";
import {
  nowOn,
  selectDashboard,
  selectGamification,
  selectSettings,
  selectTasksByStatus,
  type SyncState,
} from "./sync-state";

/**
 * The entities and documents we hold.
 *
 * Subscribed to the state alone, not to the whole snapshot: an unchanged poll
 * leaves this reference exactly as it was, so React bails out and nothing
 * re-renders. That is the difference between a cheap protocol and a cheap
 * protocol that still burns the main thread every eight seconds.
 */
export function useSyncState(): SyncState {
  return useSyncExternalStore(subscribe, getStateSnapshot, getStateSnapshot);
}

/** Connection state and the last error. For the few places that must say so. */
export function useSyncStatus(): SyncSnapshot {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/**
 * A ticking clock, at whatever resolution the caller actually needs.
 *
 * Deliberately a parameter and not a constant. The ribbon and the day arc were
 * redrawn every 30 seconds before this change and are redrawn every 30 seconds
 * after it, because moving them to a one-second tick would be a visible change
 * to something nobody asked to be different. The reminder check is the one
 * caller that wants to be prompt, and it renders nothing at all.
 */
export function useNow(intervalMs = 30_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}

/**
 * The day, in the shape the pages already render.
 *
 * `null` while the first sync is still in flight, which is the same `isLoading`
 * the queries used to report. After that it is never null again: a failed poll
 * leaves the cached day on screen rather than blanking it, because a machine
 * that is asleep is normal rather than an error.
 *
 * Recomputed when the state changes or the clock ticks, and not otherwise — the
 * four clock-dependent values are the only reason the second dependency is
 * there.
 */
export function useDashboard(tickMs = 30_000): DashboardToday | null {
  const state = useSyncState();
  const now = useNow(tickMs);
  return useMemo(
    () => selectDashboard(state, nowOn(state, now)),
    [state, now],
  );
}

/**
 * `AppSettings`, from the sync state rather than from its own request.
 *
 * It is one of the nine derived documents, so it arrives with the day and is
 * re-sent only when it actually changes. The separate `GET /settings` poll this
 * replaces was asking for 1.5 KB on every screen that cared.
 */
export function useSettings(): AppSettings | null {
  return selectSettings(useSyncState());
}

export function useGamification() {
  return selectGamification(useSyncState());
}

/**
 * The reminders that should chime right now, checked every second.
 *
 * Its own hook, and its own tick, because it is the one thing in the app that
 * wants to be prompt and the only one that costs nothing to re-run: the
 * component that calls it renders `null`. Giving the whole front page a
 * one-second clock would redraw the ribbon, the day arc and every card sixty
 * times a minute to make a chime punctual.
 *
 * A reminder used to arrive with the poll that happened to notice it, up to
 * eight seconds after it was due. This is the "fires when it is due" that
 * SYNC.md §8 means.
 */
export function useDueReminders(): Task[] {
  const state = useSyncState();
  const now = useNow(1_000);
  return useMemo(() => {
    const at = nowOn(state, now);
    return Object.values(state.tasks).filter((t) => isReminderDueAt(t, at));
  }, [state, now]);
}

/**
 * Tasks by status, in the order the old list endpoint returned them.
 *
 * `GET /tasks?status=…` applied `visibleOnly`, so a task whose `showAt` has not
 * passed was absent — a clock comparison, which is why it is done here. The
 * sort is the server's own comparator, reproduced in `sync-state.ts`, so the
 * rows come out in the order the page has always drawn them.
 */
export function useTasksByStatus(status: Task["status"], tickMs = 30_000): Task[] {
  const state = useSyncState();
  const now = useNow(tickMs);
  return useMemo(
    () => selectTasksByStatus(state, status, nowOn(state, now)),
    [state, now, status],
  );
}
