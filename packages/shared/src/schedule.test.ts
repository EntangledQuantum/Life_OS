import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import {
  expiresAt,
  isCardImminent,
  isReminderDue,
  notifyAt,
  validateCardSchedule,
} from "./schedule.js";

const AT = (minutesFromNow: number, now = Date.now()) =>
  new Date(now + minutesFromNow * 60_000).toISOString();

describe("notifyAt", () => {
  it("derives the ping from eventAt when the agent set no remindAt", () => {
    // The bug this fixes: nothing computed remindAt, so a card with only an
    // eventAt was never scheduled on the phone and never became due.
    const eventAt = "2026-08-14T19:00:00.000Z";
    assert.equal(notifyAt({ eventAt }, 15), "2026-08-14T18:45:00.000Z");
  });

  it("honours an explicit remindAt over the derived one", () => {
    const out = notifyAt(
      { eventAt: "2026-08-14T19:00:00.000Z", remindAt: "2026-08-14T17:00:00.000Z" },
      15,
    );
    assert.equal(out, "2026-08-14T17:00:00.000Z");
  });

  it("with a zero lead, pings at the moment itself", () => {
    const eventAt = "2026-08-14T19:00:00.000Z";
    assert.equal(notifyAt({ eventAt }, 0), eventAt);
  });

  it("is null when there is nothing to be early for", () => {
    assert.equal(notifyAt({}, 15), null);
    assert.equal(notifyAt({ eventAt: "not a date" }, 15), null);
  });

  it("treats a negative lead as zero rather than notifying after the fact", () => {
    const eventAt = "2026-08-14T19:00:00.000Z";
    assert.equal(notifyAt({ eventAt }, -30), eventAt);
  });
});

describe("expiresAt", () => {
  it("ends at eventAt + duration", () => {
    const at = expiresAt({
      eventAt: "2026-08-14T19:00:00.000Z",
      durationMinutes: 30,
    });
    assert.equal(new Date(at!).toISOString(), "2026-08-14T19:30:00.000Z");
  });

  it("with no duration, expires at the event itself", () => {
    const at = expiresAt({ eventAt: "2026-08-14T19:00:00.000Z" });
    assert.equal(new Date(at!).toISOString(), "2026-08-14T19:00:00.000Z");
  });

  it("is null for something with no time on it", () => {
    assert.equal(expiresAt({}), null);
  });
});

describe("isCardImminent", () => {
  const active = { status: "active" as const };

  it("pulls in a thing inside the lead window", () => {
    assert.equal(isCardImminent({ ...active, eventAt: AT(10) }, new Date(), 15), true);
  });

  it("leaves out a thing beyond the lead window", () => {
    assert.equal(isCardImminent({ ...active, eventAt: AT(40) }, new Date(), 15), false);
  });

  it("keeps a thing that is running late but still inside its own window", () => {
    // Started 10 minutes ago, meant to take 30 — still now.
    const card = { ...active, eventAt: AT(-10), durationMinutes: 30 };
    assert.equal(isCardImminent(card, new Date(), 15), true);
  });

  it("drops a thing once its own window has closed", () => {
    // This is what stops missed items piling up on the front page forever.
    const card = { ...active, eventAt: AT(-90), durationMinutes: 30 };
    assert.equal(isCardImminent(card, new Date(), 15), false);
  });

  it("ignores anything not active", () => {
    assert.equal(
      isCardImminent({ status: "done", eventAt: AT(5) }, new Date(), 15),
      false,
    );
  });

  it("ignores a card that is still hidden", () => {
    const card = { ...active, eventAt: AT(5), showAt: AT(60) };
    assert.equal(isCardImminent(card, new Date(), 15), false);
  });
});

describe("isReminderDue", () => {
  it("is due once the derived instant has passed", () => {
    // 5 minutes out with a 15-minute lead: the ping was due 10 minutes ago.
    assert.equal(
      isReminderDue({ status: "active", eventAt: AT(5) }, new Date(), 15),
      true,
    );
  });

  it("is not due before the lead window opens", () => {
    assert.equal(
      isReminderDue({ status: "active", eventAt: AT(60) }, new Date(), 15),
      false,
    );
  });

  it("fires exactly once", () => {
    const card = { status: "active", eventAt: AT(5), notifiedAt: AT(-1) };
    assert.equal(isReminderDue(card, new Date(), 15), false);
  });

  it("does not chase a finished card", () => {
    assert.equal(
      isReminderDue({ status: "done", eventAt: AT(5) }, new Date(), 15),
      false,
    );
  });
});

describe("validateCardSchedule", () => {
  it("rejects a reminder that fires at or after its own event", () => {
    const out = validateCardSchedule({
      remindAt: "2026-08-14T19:00:00.000Z",
      eventAt: "2026-08-14T19:00:00.000Z",
    });
    assert.equal(out.ok, false);
    assert.ok(out.errors.some((e) => e.includes("strictly before")));
  });

  it("reports every problem at once, so a fix is one round-trip", () => {
    const out = validateCardSchedule({
      showAt: "2026-08-14T20:00:00.000Z",
      remindAt: "2026-08-14T19:30:00.000Z",
      eventAt: "2026-08-14T19:00:00.000Z",
    });
    assert.equal(out.ok, false);
    assert.ok(out.errors.length >= 2, `expected several errors, got ${out.errors.length}`);
  });

  it("accepts a well-ordered schedule and normalizes it to ISO", () => {
    const out = validateCardSchedule({
      showAt: "2026-08-14T17:00:00Z",
      remindAt: "2026-08-14T18:50:00Z",
      eventAt: "2026-08-14T19:00:00Z",
    });
    assert.equal(out.ok, true);
    assert.equal(out.normalized.eventAt, "2026-08-14T19:00:00.000Z");
  });
});
