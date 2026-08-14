import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import {
  addDays,
  isTimezone,
  lifeDayBounds,
  lifeDayOf,
  resolveTimezone,
} from "./time.js";

/**
 * The life-day, and which clock it is on.
 *
 * Both of these are invisible until the reader is somewhere else. A dashboard
 * on the same machine as the server never notices that the zone was implied; an
 * agent in a UTC container notices immediately, by scheduling into the wrong
 * day and disagreeing about which day a completion landed in.
 */

const KOLKATA = "Asia/Kolkata"; // +05:30, no DST — the offset with a half hour.
const NY = "America/New_York"; // DST, so the boundary moves.

describe("the life-day boundary", () => {
  it("puts 01:00 in the day before, because the user is still awake", () => {
    // The whole point of dayResetTime: finishing at 01:00 belongs to the day you
    // have been up through, not the one that started an hour ago.
    const lateNight = new Date("2026-08-15T01:30:00+05:30");
    const day = lifeDayOf(lateNight, "04:00", KOLKATA);
    assert.equal(day.lifeDay, "2026-08-14");
  });

  it("puts 04:00 exactly in the new day", () => {
    const onTheDot = new Date("2026-08-15T04:00:00+05:30");
    assert.equal(lifeDayOf(onTheDot, "04:00", KOLKATA).lifeDay, "2026-08-15");
  });

  it("puts 03:59 in the old one", () => {
    const justBefore = new Date("2026-08-15T03:59:00+05:30");
    assert.equal(lifeDayOf(justBefore, "04:00", KOLKATA).lifeDay, "2026-08-14");
  });

  it("reads the instant in the configured zone, not the machine's", () => {
    /*
     * 00:30 UTC on the 15th is 06:00 in Kolkata — past the reset, so the 15th.
     * Read in UTC the same instant is 00:30, which is *before* the reset, so
     * the 14th. This is the disagreement an agent in a container has with the
     * app it is reporting on, and it is a whole day wide.
     */
    const instant = new Date("2026-08-15T00:30:00Z");
    assert.equal(lifeDayOf(instant, "04:00", KOLKATA).lifeDay, "2026-08-15");
    assert.equal(lifeDayOf(instant, "04:00", "UTC").lifeDay, "2026-08-14");
  });

  it("reports bounds that actually contain the instant", () => {
    const at = new Date("2026-08-15T01:30:00+05:30");
    const day = lifeDayOf(at, "04:00", KOLKATA);
    assert.ok(day.lifeDayStart <= at.toISOString(), "starts before");
    assert.ok(day.lifeDayEnd > at.toISOString(), "ends after");
  });

  it("makes one day's end the next day's start, with no gap", () => {
    const first = lifeDayBounds("2026-08-14", "04:00", KOLKATA);
    const second = lifeDayBounds("2026-08-15", "04:00", KOLKATA);
    assert.equal(first.lifeDayEnd, second.lifeDayStart);
  });

  it("survives a DST spring-forward without losing or duplicating a day", () => {
    // 2026-03-08 is when US clocks jump 02:00 → 03:00.
    const before = lifeDayBounds("2026-03-07", "04:00", NY);
    const across = lifeDayBounds("2026-03-08", "04:00", NY);
    const after = lifeDayBounds("2026-03-09", "04:00", NY);
    assert.equal(before.lifeDayEnd, across.lifeDayStart);
    assert.equal(across.lifeDayEnd, after.lifeDayStart);

    /*
     * One life-day is an hour shorter, and it is the 7th — it runs from 04:00
     * EST to 04:00 EDT, and the jump happens at 02:00 on the 8th, inside it.
     * That is correct: a 23-hour day, not a lost one.
     */
    const span = (d: { lifeDayStart: string; lifeDayEnd: string }) =>
      (Date.parse(d.lifeDayEnd) - Date.parse(d.lifeDayStart)) / 3600_000;
    assert.equal(span(before), 23);
    assert.equal(span(across), 24);
  });

  it("handles a half-hour offset zone", () => {
    const day = lifeDayBounds("2026-08-14", "04:00", KOLKATA);
    // 04:00 IST is 22:30 UTC the previous day.
    assert.equal(day.lifeDayStart, "2026-08-13T22:30:00.000Z");
  });
});

describe("timezone resolution", () => {
  it("accepts a real IANA name", () => {
    assert.ok(isTimezone(KOLKATA));
    assert.ok(isTimezone("UTC"));
  });

  it("rejects a typo rather than storing it to fail later", () => {
    // Stored unchecked, this throws on every date it is used for, a long way
    // from the call that set it.
    assert.ok(!isTimezone("Asia/Kolkatta"));
    assert.ok(!isTimezone("GMT+5:30"));
    assert.ok(!isTimezone(""));
    assert.ok(!isTimezone(null));
  });

  it("falls back to the machine rather than throwing on a bad stored value", () => {
    const resolved = resolveTimezone("Not/AZone");
    assert.ok(isTimezone(resolved), `fell back to ${resolved}`);
  });

  it("treats null as the machine's zone", () => {
    assert.ok(isTimezone(resolveTimezone(null)));
  });
});

describe("addDays", () => {
  it("crosses a month end", () => {
    assert.equal(addDays("2026-08-31", 1), "2026-09-01");
  });
  it("goes backwards", () => {
    assert.equal(addDays("2026-01-01", -1), "2025-12-31");
  });
  it("knows February in a leap year", () => {
    assert.equal(addDays("2028-02-28", 1), "2028-02-29");
  });
});
