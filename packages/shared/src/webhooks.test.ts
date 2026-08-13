import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import {
  clampToStep,
  isWebhookEvent,
  isWebhookPreset,
  validateCardControl,
} from "./webhooks.js";

describe("validateCardControl", () => {
  it("accepts a slider and snaps its value onto the step grid", () => {
    const out = validateCardControl({
      kind: "slider",
      label: "How did that feel?",
      min: 1,
      max: 10,
      step: 1,
      value: 7.4,
    });
    assert.equal(out.ok, true);
    assert.equal(out.ok && out.control.kind, "slider");
    assert.equal(out.ok && (out.control as { value: number }).value, 7);
  });

  it("pulls an out-of-range value back inside the range", () => {
    // An agent sending value: 99 for a 1–10 slider would otherwise render a
    // thumb somewhere off the end of the track.
    const out = validateCardControl({
      kind: "slider",
      label: "Energy",
      min: 1,
      max: 10,
      value: 99,
    });
    assert.equal(out.ok && (out.control as { value: number }).value, 10);
  });

  it("rejects an inverted range", () => {
    const out = validateCardControl({ kind: "slider", label: "x", min: 10, max: 1 });
    assert.equal(out.ok, false);
    assert.ok(!out.ok && out.error.includes("greater than min"));
  });

  it("rejects a zero or negative step", () => {
    const out = validateCardControl({
      kind: "slider",
      label: "x",
      min: 0,
      max: 10,
      step: 0,
    });
    assert.equal(out.ok, false);
  });

  it("defaults a slider with no value to its minimum", () => {
    const out = validateCardControl({ kind: "slider", label: "x", min: 3, max: 9 });
    assert.equal(out.ok && (out.control as { value: number }).value, 3);
  });

  it("accepts a button", () => {
    const out = validateCardControl({ kind: "button", label: "I did it" });
    assert.equal(out.ok, true);
    assert.equal(out.ok && out.control.kind, "button");
  });

  it("rejects a control with no label — an unlabelled widget is a mystery", () => {
    assert.equal(validateCardControl({ kind: "button" }).ok, false);
    assert.equal(validateCardControl({ kind: "slider", min: 0, max: 5 }).ok, false);
  });

  it("rejects an unknown kind", () => {
    assert.equal(validateCardControl({ kind: "dial", label: "x" }).ok, false);
    assert.equal(validateCardControl(null).ok, false);
    assert.equal(validateCardControl("slider").ok, false);
  });
});

describe("clampToStep", () => {
  it("keeps fractional steps clean instead of 0.30000000000000004", () => {
    assert.equal(clampToStep(0.3001, 0, 1, 0.1), 0.3);
  });

  it("never returns a value outside the range", () => {
    assert.equal(clampToStep(-5, 0, 10, 3), 0);
    // 9, not 10: with step 3 from 0 the valid stops are 0/3/6/9 and the max is
    // simply not one of them. This matches <input type="range">, which cannot
    // reach an off-grid max either — snapping past it would report a value the
    // slider can never actually be dragged to.
    assert.equal(clampToStep(500, 0, 10, 3), 9);
  });
});

describe("event and preset guards", () => {
  it("recognises the real ones", () => {
    assert.equal(isWebhookEvent("card.complete"), true);
    assert.equal(isWebhookPreset("hermes"), true);
    assert.equal(isWebhookPreset("openclaw"), true);
  });

  it("rejects anything else", () => {
    assert.equal(isWebhookEvent("card.started"), false);
    assert.equal(isWebhookPreset("slack"), false);
    assert.equal(isWebhookPreset(undefined), false);
  });
});
