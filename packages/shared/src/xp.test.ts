import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { improvementPct, paceAdjustedImprovementPct } from "./xp.js";

/**
 * Comparing today with yesterday, without lying about it in either direction.
 */

describe("the raw delta", () => {
  it("is the difference in efficiency, in points", () => {
    assert.equal(improvementPct(80, 100), -20);
    assert.equal(improvementPct(120, 100), 20);
  });
});

describe("pace-adjusted improvement", () => {
  /*
   * The raw delta compares a day in progress with a day that finished, so at
   * breakfast it reported roughly -100% every morning. That is an artefact of
   * the clock dressed up as a verdict, and it broke the rule the whole app is
   * built on: never tell someone they are failing at something they have not
   * had the chance to do yet.
   */
  it("does not call a fresh morning a collapse", () => {
    // 8% of the way through the day, nothing done, yesterday finished at 160%.
    assert.equal(improvementPct(0, 160), -160, "the behaviour being fixed");
    assert.equal(
      paceAdjustedImprovementPct(0, 160, 0.08),
      0,
      "the first slice of the day reports flat",
    );
  });

  it("compares against where yesterday had got to by now", () => {
    // Half way through: today at 60%, yesterday finished at 100%, so yesterday
    // was around 50% by this point and today is a little ahead.
    assert.equal(paceAdjustedImprovementPct(60, 100, 0.5), 10);
  });

  it("still says so when today really is behind", () => {
    // Not a rule against bad news — a rule against inventing it.
    assert.equal(paceAdjustedImprovementPct(20, 100, 0.5), -30);
  });

  it("converges on the honest total at the end of the day", () => {
    assert.equal(
      paceAdjustedImprovementPct(80, 100, 1),
      improvementPct(80, 100),
    );
  });

  it("clamps a fraction outside 0–1 rather than extrapolating", () => {
    assert.equal(paceAdjustedImprovementPct(80, 100, 5), -20);
    assert.equal(paceAdjustedImprovementPct(80, 100, -3), 0);
  });

  it("has nothing to compare against on a first day, and says nothing", () => {
    // No yesterday means no baseline. Zero is the honest answer, not a triumph.
    assert.equal(paceAdjustedImprovementPct(40, 0, 0.5), 40);
    assert.equal(paceAdjustedImprovementPct(0, 0, 0.5), 0);
  });
});
