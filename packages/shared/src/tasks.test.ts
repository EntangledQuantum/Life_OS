import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { isTimelineTask } from "./tasks.js";

/**
 * The one rule behind both the Timeline page and its nav badge.
 *
 * The badge used to count every active task while the page excluded pinned
 * cards and the agent status strip, so a day whose only open work was two
 * pinned cards showed a badge of "2" over a page saying "Nothing scheduled".
 * These assertions are that disagreement, written down.
 */

type Row = Parameters<typeof isTimelineTask>[0];

const row = (over: Partial<Row> = {}): Row => ({
  status: "active",
  slot: null,
  meta: null,
  ...over,
});

describe("isTimelineTask", () => {
  it("counts ordinary open work", () => {
    // `slot` is 0, 1 or nothing — an unpinned task has no slot at all.
    assert.equal(isTimelineTask(row()), true);
  });

  it("skips the pinned cards, which the front page already draws", () => {
    assert.equal(isTimelineTask(row({ slot: 0 })), false);
    assert.equal(isTimelineTask(row({ slot: 1 })), false);
  });

  it("skips the agent status strip", () => {
    assert.equal(isTimelineTask(row({ meta: { connected: true } })), false);
    // Other agent metadata is not the status strip.
    assert.equal(isTimelineTask(row({ meta: { book: "dune" } })), true);
  });

  it("only counts what is still open", () => {
    assert.equal(isTimelineTask(row({ status: "done" })), false);
    assert.equal(isTimelineTask(row({ status: "dismissed" })), false);
  });
});
