/**
 * Generate the cross-language fixture that proves the Kotlin sync helpers match
 * the TypeScript ones.
 *
 *     TZ=Asia/Kolkata node scripts/gen-sync-fixture.mjs
 *
 * **The output is committed**, to `app/src/test/resources/sync-fixture.json`. A
 * build must not depend on this having been run — `SyncMathTest` reads the
 * committed file, so a developer with no Node installed still runs the same
 * assertions.
 *
 * ### Why this exists
 *
 * Protocol 4 moved four display values off the server and onto the device:
 * which task is `current`, which reminders are `due`, where the now-marker cuts
 * the timeline, and `improvementPct`. The server sends instants; each client
 * compares them with its own clock. That is the right design — a payload with a
 * clock reading baked into it is stale the moment it is written, which is why
 * the old route had to resend 2.26 MB to move a marker — but it has a cost: the
 * *same* decision is now implemented twice, in TypeScript for the web and in
 * Kotlin here. Two implementations of "is this task urgent" drift, and when they
 * drift the phone and the dashboard disagree about the user's own day.
 *
 * Every other shared constant in this client is a hand copy kept honest by a
 * test that restates the expected values (see `domain/Art.kt` and `ArtTest`).
 * That works for a table of colours. It does not work for sixty lines of
 * windowing arithmetic with NaN edges, because restating the expectations by
 * hand only proves the Kotlin agrees with whatever the person writing the test
 * believed the TypeScript did.
 *
 * So this runs the **real** TypeScript — `packages/shared/src/sync.ts` and
 * `xp.ts`, imported directly, no reimplementation — over a table of cases, and
 * records what it actually returned. The Kotlin test reads the same table and
 * asserts the same answers. If someone changes the TypeScript, this file is
 * re-run and the Kotlin test fails until the port is updated, which is the
 * mechanism that was missing.
 *
 * ### Two things that matter about how it is run
 *
 * **`TZ` is pinned and recorded in the fixture.** `composeTimeline` reads
 * `getHours()`, which is the local wall clock, so the fixture is only meaningful
 * next to the zone it was generated in. The Kotlin test reads `timezone` out of
 * the file and pins itself to it rather than trusting the machine it runs on.
 *
 * **Node runs the `.ts` files directly**, by type stripping (Node 22.6+). Both
 * modules import only types from their neighbours, so there is nothing to
 * resolve at runtime and no build step — which is also why this script can be
 * run from a clean checkout with no `pnpm install`.
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..", "..");
const sharedSrc = join(repoRoot, "packages", "shared", "src");

const { isCurrentAt, isReminderDueAt, dayFractionAt, composeTimeline, activityColor } =
  await import(pathToUrl(join(sharedSrc, "sync.ts")));
const { paceAdjustedImprovementPct, improvementPct } =
  await import(pathToUrl(join(sharedSrc, "xp.ts")));

function pathToUrl(p) {
  return new URL(`file:///${p.replace(/\\/g, "/")}`).href;
}

/**
 * The instant every case is evaluated at.
 *
 * 09:30 UTC, which in Asia/Kolkata — the user's zone — is 15:00 local. Chosen so
 * that the local wall-clock hour is not the same number as the UTC one: a port
 * that read UTC where the TypeScript reads local time would otherwise pass.
 */
const NOW = "2026-10-30T09:30:00.000Z";
const now = new Date(NOW);

const baseTask = {
  id: "t",
  kind: "task",
  title: "t",
  status: "active",
  repeatRule: "none",
  xpOnComplete: 0,
  source: "agent",
  currentFrom: null,
  currentUntil: null,
  dueFrom: null,
  dueUntil: null,
};

const task = (over) => ({ ...baseTask, ...over });

const currentCases = [
  { name: "no window at all", task: { currentFrom: null } },
  { name: "open-ended window already begun", task: { currentFrom: "2026-10-30T08:00:00.000Z", currentUntil: null } },
  { name: "window not yet begun", task: { currentFrom: "2026-10-30T10:00:00.000Z" } },
  { name: "window already closed", task: { currentFrom: "2026-10-30T07:00:00.000Z", currentUntil: "2026-10-30T08:00:00.000Z" } },
  { name: "inside the window", task: { currentFrom: "2026-10-30T09:00:00.000Z", currentUntil: "2026-10-30T10:00:00.000Z" } },
  { name: "exactly at currentFrom", task: { currentFrom: NOW } },
  { name: "exactly at currentUntil", task: { currentFrom: "2026-10-30T09:00:00.000Z", currentUntil: NOW } },
  { name: "not active", task: { status: "done", currentFrom: "2026-10-30T08:00:00.000Z" } },
  { name: "dismissed", task: { status: "dismissed", currentFrom: "2026-10-30T08:00:00.000Z" } },
  { name: "missed is not active either", task: { status: "missed", currentFrom: "2026-10-30T08:00:00.000Z" } },
  { name: "showAt in the future hides it", task: { currentFrom: "2026-10-30T08:00:00.000Z", showAt: "2026-10-30T23:00:00.000Z" } },
  { name: "showAt in the past does not", task: { currentFrom: "2026-10-30T08:00:00.000Z", showAt: "2026-10-30T06:00:00.000Z" } },
  { name: "showAt empty string is absent", task: { currentFrom: "2026-10-30T08:00:00.000Z", showAt: "" } },
  { name: "unparseable currentFrom does not open the window", task: { currentFrom: "not a date" } },
  { name: "unparseable currentUntil does not close it", task: { currentFrom: "2026-10-30T08:00:00.000Z", currentUntil: "rubbish" } },
  { name: "unparseable showAt is ignored", task: { currentFrom: "2026-10-30T08:00:00.000Z", showAt: "rubbish" } },
];

const dueCases = [
  { name: "no due window", task: { dueFrom: null } },
  { name: "due and not notified", task: { dueFrom: "2026-10-30T09:00:00.000Z", dueUntil: "2026-10-30T10:00:00.000Z" } },
  { name: "already notified", task: { dueFrom: "2026-10-30T09:00:00.000Z", notifiedAt: "2026-10-30T09:05:00.000Z" } },
  { name: "notifiedAt empty string is not notified", task: { dueFrom: "2026-10-30T09:00:00.000Z", notifiedAt: "" } },
  { name: "done tasks never chime", task: { status: "done", dueFrom: "2026-10-30T09:00:00.000Z" } },
  { name: "dismissed tasks never chime", task: { status: "dismissed", dueFrom: "2026-10-30T09:00:00.000Z" } },
  { name: "a missed task still chimes", task: { status: "missed", dueFrom: "2026-10-30T09:00:00.000Z" } },
  { name: "not due yet", task: { dueFrom: "2026-10-30T12:00:00.000Z" } },
  { name: "window has passed", task: { dueFrom: "2026-10-30T06:00:00.000Z", dueUntil: "2026-10-30T07:00:00.000Z" } },
  { name: "open-ended due window", task: { dueFrom: "2026-10-30T06:00:00.000Z", dueUntil: null } },
  { name: "exactly at dueFrom", task: { dueFrom: NOW } },
  { name: "exactly at dueUntil", task: { dueFrom: "2026-10-30T09:00:00.000Z", dueUntil: NOW } },
  { name: "showAt is irrelevant to a reminder", task: { dueFrom: "2026-10-30T09:00:00.000Z", showAt: "2026-10-30T23:00:00.000Z" } },
  { name: "unparseable dueFrom does not open it", task: { dueFrom: "rubbish" } },
  { name: "unparseable dueUntil does not close it", task: { dueFrom: "2026-10-30T06:00:00.000Z", dueUntil: "rubbish" } },
];

const dayCases = [
  { name: "mid-day", lifeDayStart: "2026-10-29T22:30:00.000Z", lifeDayEnd: "2026-10-30T22:30:00.000Z" },
  { name: "before the start clamps to 0", lifeDayStart: "2026-10-30T20:00:00.000Z", lifeDayEnd: "2026-10-31T20:00:00.000Z" },
  { name: "after the end clamps to 1", lifeDayStart: "2026-10-28T22:30:00.000Z", lifeDayEnd: "2026-10-29T22:30:00.000Z" },
  { name: "zero-length day", lifeDayStart: NOW, lifeDayEnd: NOW },
  { name: "inverted day", lifeDayStart: "2026-10-31T00:00:00.000Z", lifeDayEnd: "2026-10-30T00:00:00.000Z" },
  { name: "unparseable start", lifeDayStart: "rubbish", lifeDayEnd: "2026-10-30T22:30:00.000Z" },
  { name: "unparseable end", lifeDayStart: "2026-10-29T22:30:00.000Z", lifeDayEnd: "rubbish" },
  { name: "exactly at the start", lifeDayStart: NOW, lifeDayEnd: "2026-10-31T09:30:00.000Z" },
  { name: "exactly at the end", lifeDayStart: "2026-10-29T09:30:00.000Z", lifeDayEnd: NOW },
];

/*
 * The first eight are the cases `packages/shared/src/xp.test.ts` itself
 * asserts, so the Kotlin is held to the TypeScript's own test suite. The rest
 * pin the rounding, which is where a Kotlin port diverges most easily:
 * JavaScript's `Math.round` is `floor(x + 0.5)`, so a half goes toward positive
 * infinity, while `kotlin.math.round` rounds a half *away from zero*.
 */
const paceCases = [
  { today: 0, yesterday: 160, fraction: 0.08 },
  { today: 60, yesterday: 100, fraction: 0.5 },
  { today: 20, yesterday: 100, fraction: 0.5 },
  { today: 80, yesterday: 100, fraction: 1 },
  { today: 80, yesterday: 100, fraction: 5 },
  { today: 80, yesterday: 100, fraction: -3 },
  { today: 40, yesterday: 0, fraction: 0.5 },
  { today: 0, yesterday: 0, fraction: 0.5 },
  { today: 0.05, yesterday: 0, fraction: 1 },
  { today: -0.05, yesterday: 0, fraction: 1 },
  { today: 0.25, yesterday: 0, fraction: 1 },
  { today: -0.25, yesterday: 0, fraction: 1 },
  { today: 1.25, yesterday: 0, fraction: 1 },
  { today: -1.25, yesterday: 0, fraction: 1 },
  { today: 33.333, yesterday: 11.111, fraction: 0.9 },
  { today: 100, yesterday: 99.95, fraction: 1 },
  { today: 0, yesterday: 100, fraction: 0.1 },
  { today: 0, yesterday: 100, fraction: 0.0999 },
  { today: -20, yesterday: -40, fraction: 0.5 },
];

const ribbon = [
  { id: "r1", category: "Sleep", label: "Sleep", startHour: 0, endHour: 6, color: "#6366F1", status: "planned" },
  { id: "r2", category: "Deep Work", label: "Deep Work", startHour: 9, endHour: 12, color: "#A78BFA", status: "planned" },
  { id: "r3", category: "Study", label: "Study", startHour: 14, endHour: 16, color: "#C084FC", status: "planned" },
  { id: "r4", category: "Life", label: "Life", startHour: 20, endHour: 24, color: "#5B8CFF", status: "planned" },
];

const interval = (id, activity, startedAt, endedAt) => ({
  id, activity, startedAt, endedAt, blockId: null,
});

const timelineCases = [
  { name: "nothing lived", ribbon, lived: [] },
  { name: "one closed interval", ribbon, lived: [interval("l1", "Sleep", "2026-10-29T19:00:00.000Z", "2026-10-29T23:30:00.000Z")] },
  { name: "an open interval runs to the marker", ribbon, lived: [interval("l1", "Deep Work", "2026-10-30T08:00:00.000Z", null)] },
  {
    name: "a gap becomes an explicit unlogged segment",
    ribbon,
    lived: [
      interval("l1", "Sleep", "2026-10-30T01:00:00.000Z", "2026-10-30T02:30:00.000Z"),
      interval("l2", "Study", "2026-10-30T06:00:00.000Z", "2026-10-30T07:00:00.000Z"),
    ],
  },
  {
    name: "out-of-order input is sorted",
    ribbon,
    lived: [
      interval("l2", "Study", "2026-10-30T06:00:00.000Z", "2026-10-30T07:00:00.000Z"),
      interval("l1", "Sleep", "2026-10-30T01:00:00.000Z", "2026-10-30T02:30:00.000Z"),
    ],
  },
  { name: "a zero-length interval is dropped", ribbon, lived: [interval("l1", "Break", "2026-10-30T03:00:00.000Z", "2026-10-30T03:00:00.000Z")] },
  { name: "an interval ending after the marker is cut at it", ribbon, lived: [interval("l1", "Deep Work", "2026-10-30T02:00:00.000Z", "2026-10-30T20:00:00.000Z")] },
  { name: "an interval starting after the marker collapses", ribbon, lived: [interval("l1", "Study", "2026-10-30T16:00:00.000Z", "2026-10-30T17:00:00.000Z")] },
  { name: "an unknown activity takes the default colour", ribbon, lived: [interval("l1", "Gardening", "2026-10-30T06:00:00.000Z", "2026-10-30T07:00:00.000Z")] },
  { name: "back-to-back intervals leave no gap", ribbon, lived: [
    interval("l1", "Sleep", "2026-10-30T01:00:00.000Z", "2026-10-30T02:00:00.000Z"),
    interval("l2", "Health", "2026-10-30T02:00:00.000Z", "2026-10-30T03:00:00.000Z"),
  ] },
  { name: "an empty ribbon", ribbon: [], lived: [] },
  {
    name: "a plan segment straddling the marker is trimmed",
    ribbon: [{ id: "r9", category: "Life", label: "Life", startHour: 0, endHour: 24, color: "#5B8CFF", status: "planned" }],
    lived: [],
  },
  {
    name: "a plan segment entirely behind the marker is dropped",
    ribbon: [{ id: "r9", category: "Sleep", label: "Sleep", startHour: 0, endHour: 2, color: "#6366F1", status: "planned" }],
    lived: [],
  },
];

const activityCases = [
  "Sleep", "Life", "Life Admin", "Deep Work", "Study", "Health",
  "Break", "Startup", "Exercise", "Exploration", "Gardening", "", "sleep",
];

const lifeDay = (start, end) => ({
  lifeDay: "2026-10-30",
  lifeDayStart: start,
  lifeDayEnd: end,
  dayResetTime: "04:00",
  timezone: "Asia/Kolkata",
});

const fixture = {
  _generatedBy: "mobile-frontend/native-android/scripts/gen-sync-fixture.mjs",
  _source: "packages/shared/src/sync.ts, packages/shared/src/xp.ts",
  _note:
    "Committed output. Re-run with TZ pinned after changing either TypeScript " +
    "module; SyncMathTest asserts the Kotlin port returns exactly these values.",
  now: NOW,
  /*
   * The zone actually in effect, asked of the runtime rather than read from
   * `TZ`.
   *
   * `TZ` is the usual way to pin this, but it does not survive every shell on
   * every platform — on Windows under Git Bash a `TZ=...` prefix never reaches
   * the process environment at all, so a fixture that recorded `process.env.TZ`
   * would have claimed `null` while the arithmetic was quietly done in
   * whatever zone the machine was in. `resolvedOptions()` reports the zone the
   * dates were really computed in, which is the thing the Kotlin test has to
   * pin itself to.
   */
  timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  utcOffsetMinutesAtNow: -now.getTimezoneOffset(),
  isCurrentAt: currentCases.map((c) => ({
    name: c.name,
    task: c.task,
    expected: isCurrentAt(task(c.task), now),
  })),
  isReminderDueAt: dueCases.map((c) => ({
    name: c.name,
    task: c.task,
    expected: isReminderDueAt(task(c.task), now),
  })),
  dayFractionAt: dayCases.map((c) => ({
    name: c.name,
    lifeDayStart: c.lifeDayStart,
    lifeDayEnd: c.lifeDayEnd,
    expected: dayFractionAt(lifeDay(c.lifeDayStart, c.lifeDayEnd), now),
  })),
  paceAdjustedImprovementPct: paceCases.map((c) => ({
    ...c,
    expected: paceAdjustedImprovementPct(c.today, c.yesterday, c.fraction),
  })),
  improvementPct: [
    { today: 80, yesterday: 100 },
    { today: 120, yesterday: 100 },
  ].map((c) => ({ ...c, expected: improvementPct(c.today, c.yesterday) })),
  activityColor: activityCases.map((a) => ({ activity: a, expected: activityColor(a) })),
  composeTimeline: timelineCases.map((c) => ({
    name: c.name,
    ribbon: c.ribbon,
    lived: c.lived,
    expected: composeTimeline(c.ribbon, c.lived, activityColor, now),
  })),
};

/*
 * A fixed-offset zone would make the timeline cases meaningless.
 *
 * `composeTimeline` reads the local wall clock, so the whole table is only
 * interpretable next to a named zone the Kotlin side can also resolve. A
 * runtime that reports something like "UTC" when the machine is not in UTC, or
 * an offset instead of a zone id, is refused rather than silently baking a
 * wrong expectation into a committed file.
 */
const resolvedZone = fixture.timezone;
if (!resolvedZone || !resolvedZone.includes("/")) {
  console.error(
    `Refusing to generate: resolved time zone ${JSON.stringify(resolvedZone)} ` +
      "is not a named IANA zone, and composeTimeline reads the local wall " +
      "clock. Set a real zone (TZ=Asia/Kolkata, or the machine's own) and " +
      "re-run.",
  );
  process.exit(1);
}

const out = join(here, "..", "app", "src", "test", "resources", "sync-fixture.json");
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, `${JSON.stringify(fixture, null, 2)}\n`);
console.error(`wrote ${out}`);
