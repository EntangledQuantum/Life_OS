import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import {
  MIN_CARD_OVERLAY,
  normalizeCardStyle,
  resolveCardStyle,
} from "./card-style.js";

/**
 * Card styling, which is decoration written by an agent.
 *
 * Two rules shape all of this. A bad *style* field is dropped rather than
 * rejected, because the style is not the point of the card and a typo in a
 * gradient should not cost the user the content. And a scrim over a background
 * photograph has a floor, because a card whose body cannot be read is not a
 * style choice — it is a broken card, and an agent asking for one has made a
 * mistake it cannot see.
 */

describe("normalizing what an agent sent", () => {
  it("keeps the fields it understands", () => {
    const style = normalizeCardStyle({
      layout: "background",
      overlay: 0.7,
      gradient: { from: "#111", to: "#222" },
      border: "hairline",
      align: "center",
    });
    assert.deepEqual(style, {
      layout: "background",
      overlay: 0.7,
      gradient: { from: "#111", to: "#222" },
      border: "hairline",
      align: "center",
    });
  });

  it("drops a bad field instead of rejecting the whole card", () => {
    const style = normalizeCardStyle({ layout: "diagonal", border: "hairline" });
    assert.equal(style?.layout, undefined);
    assert.equal(style?.border, "hairline");
  });

  it("floors the scrim so text over a photograph stays readable", () => {
    assert.equal(normalizeCardStyle({ overlay: 0 })?.overlay, MIN_CARD_OVERLAY);
    assert.equal(normalizeCardStyle({ overlay: -5 })?.overlay, MIN_CARD_OVERLAY);
  });

  it("caps it too, so a card is never a solid black rectangle", () => {
    assert.ok((normalizeCardStyle({ overlay: 3 })?.overlay ?? 1) < 1);
  });

  it("ignores a half-written gradient rather than drawing half of one", () => {
    assert.equal(normalizeCardStyle({ gradient: { from: "#111" } })?.gradient, undefined);
  });

  it("returns null for nothing usable, so the column stays null", () => {
    assert.equal(normalizeCardStyle({}), null);
    assert.equal(normalizeCardStyle({ layout: "nope" }), null);
    assert.equal(normalizeCardStyle(null), null);
    assert.equal(normalizeCardStyle("banner"), null);
  });
});

describe("resolving what to draw", () => {
  it("gives the same answer for no style and for the defaults", () => {
    /*
     * Both clients call this rather than reading the raw object, so an unstyled
     * card and an explicitly-default one are the same picture on both surfaces
     * instead of two slightly different ones.
     */
    const implicit = resolveCardStyle(null, true);
    const explicit = resolveCardStyle(
      { layout: "banner", overlay: 0.62, border: "accent", align: "left" },
      true,
    );
    assert.deepEqual(implicit, explicit);
  });

  it("falls back to plain when a layout asks for media there is none of", () => {
    // A background layout with no image is a card with an invisible scrim over
    // nothing, which reads as a bug rather than as a style.
    assert.equal(resolveCardStyle({ layout: "background" }, false).layout, "plain");
    assert.equal(resolveCardStyle({ layout: "side" }, false).layout, "plain");
  });

  it("keeps the layout when there is something to show", () => {
    assert.equal(resolveCardStyle({ layout: "background" }, true).layout, "background");
  });
});
