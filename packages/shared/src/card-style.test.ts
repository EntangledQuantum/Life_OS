import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import {
  MIN_CARD_OVERLAY,
  normalizeCardStyle,
  resolveCardStyle,
} from "./card-style.js";
import { cardImages } from "./tasks.js";

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

/**
 * Two picture slots, and which one is the icon.
 *
 * The card had one image field, and `layout` decided what it was for: `side`
 * made it the icon, `background` made it the wash. So "a photograph behind the
 * text *and* a cover beside the title" was unaskable — not refused, just
 * impossible, with nothing in the API to point at. `iconImage*` is the second
 * slot, and the rule is that it wins the tile whatever the layout says.
 */
describe("a card's two pictures", () => {
  const blank = {
    imageUrl: null,
    imageData: null,
    iconImageUrl: null,
    iconImageData: null,
  };

  it("prefers inline data over a URL, for each slot independently", () => {
    const both = cardImages({
      imageUrl: "https://example.com/scene.jpg",
      imageData: "data:image/png;base64,SCENE",
      iconImageUrl: "https://example.com/icon.jpg",
      iconImageData: "data:image/png;base64,ICON",
    });
    // Inline data is already on the device and cannot fail to load.
    assert.equal(both.media, "data:image/png;base64,SCENE");
    assert.equal(both.icon, "data:image/png;base64,ICON");
  });

  it("keeps the two apart — an icon is not a picture", () => {
    const iconOnly = cardImages({ ...blank, iconImageUrl: "https://x/i.png" });
    assert.equal(iconOnly.media, null, "an icon must not become the card's picture");
    assert.equal(iconOnly.icon, "https://x/i.png");

    const mediaOnly = cardImages({ ...blank, imageUrl: "https://x/m.png" });
    assert.equal(mediaOnly.icon, null);
    assert.equal(mediaOnly.media, "https://x/m.png");
  });

  it("leaves a card with no pictures with nothing to draw", () => {
    assert.deepEqual(cardImages(blank), { media: null, icon: null });
  });

  it("still resolves a background layout when only the icon is set", () => {
    /*
     * `resolveCardStyle` asks about the *picture*, not the icon: a background
     * layout with only an icon has no wash to draw, so it is a plain card with
     * a custom tile — which is a perfectly reasonable thing to ask for.
     */
    const { media, icon } = cardImages({ ...blank, iconImageData: "data:,ICON" });
    assert.equal(resolveCardStyle({ layout: "background" }, Boolean(media)).layout, "plain");
    assert.ok(icon, "and the tile still has its picture");
  });
});
