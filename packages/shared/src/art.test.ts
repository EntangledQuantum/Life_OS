import { strict as assert } from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import {
  ART_SPEC,
  CELEBRATION_THEMES,
  DEFAULT_ART_OVERLAY,
  MAX_GOAL_TIERS,
  MIN_ART_OVERLAY,
  THEME_PALETTES,
  resolveArt,
  themePalette,
} from "./art.js";

/**
 * Art on habits, goals and tiers.
 *
 * Two things are being defended here. One is that a picture is never required:
 * every path through `resolveArt` has to produce something a renderer can draw,
 * and "nothing" is a first-class answer rather than a failure. The other is
 * that the two clients cannot drift — the phone keeps its own copy of this file
 * because it must not import from the workspace, and a copy is only safe while
 * something checks it is still a copy.
 */

describe("resolving art", () => {
  const blank = {
    iconImageUrl: null,
    iconImageData: null,
    backgroundImageUrl: null,
    backgroundImageData: null,
  };

  it("says there is nothing to draw when nothing was set", () => {
    const art = resolveArt(blank);
    assert.equal(art.icon, null);
    assert.equal(art.background, null);
    assert.equal(art.hasArt, false, "no art is the normal case, not a failure");
  });

  it("survives null and undefined, because most rows have neither field", () => {
    assert.equal(resolveArt(null).hasArt, false);
    assert.equal(resolveArt(undefined).hasArt, false);
  });

  it("prefers inline data over a URL, per slot independently", () => {
    const art = resolveArt({
      iconImageUrl: "https://x/icon.png",
      iconImageData: "data:image/png;base64,ICON",
      backgroundImageUrl: "https://x/bg.jpg",
      backgroundImageData: "data:image/png;base64,BG",
    });
    // Inline data is already on the device and cannot fail to load.
    assert.equal(art.icon, "data:image/png;base64,ICON");
    assert.equal(art.background, "data:image/png;base64,BG");
  });

  it("keeps the icon and the background apart", () => {
    const iconOnly = resolveArt({ ...blank, iconImageUrl: "https://x/i.png" });
    assert.equal(iconOnly.background, null, "an icon must not become the wash");
    assert.equal(iconOnly.hasArt, true);

    const bgOnly = resolveArt({ ...blank, backgroundImageUrl: "https://x/b.png" });
    assert.equal(bgOnly.icon, null);
    assert.equal(bgOnly.hasArt, true);
  });
});

describe("the scrim", () => {
  it("defaults to something readable when nobody chose", () => {
    assert.equal(resolveArt({}).overlay, DEFAULT_ART_OVERLAY);
    assert.ok(DEFAULT_ART_OVERLAY >= MIN_ART_OVERLAY);
  });

  it("cannot be turned off", () => {
    /*
     * The floor is the point. A habit whose name cannot be read over its own
     * photograph is a broken row, not a style choice, and an agent asking for
     * one has made a mistake it cannot see from where it sits.
     */
    assert.equal(resolveArt({ artOverlay: 0 }).overlay, MIN_ART_OVERLAY);
    assert.equal(resolveArt({ artOverlay: -5 }).overlay, MIN_ART_OVERLAY);
  });

  it("cannot be turned up to opaque either", () => {
    // A scrim at 1 is not a photograph, it is a black rectangle.
    assert.equal(resolveArt({ artOverlay: 1 }).overlay, 0.92);
  });

  it("ignores a value that is not a number", () => {
    assert.equal(
      resolveArt({ artOverlay: Number.NaN }).overlay,
      DEFAULT_ART_OVERLAY,
    );
  });
});

describe("rarity themes", () => {
  it("has a palette for every theme in the closed set", () => {
    for (const theme of CELEBRATION_THEMES) {
      const palette = THEME_PALETTES[theme];
      assert.ok(palette, `${theme} has no palette`);
      assert.ok(palette.particles.length > 0, `${theme} has no particles`);
      assert.ok(
        palette.intensity > 0 && palette.intensity <= 1,
        `${theme} intensity out of range`,
      );
    }
  });

  it("falls back rather than throwing on a theme it does not know", () => {
    // Rows written by an older or newer build must still render.
    assert.deepEqual(themePalette("nonsense"), THEME_PALETTES.spark);
    assert.deepEqual(themePalette(null), THEME_PALETTES.spark);
  });

  it("keeps five as the ladder limit", () => {
    // Five is a set of rarities; fifteen is a progress bar with extra steps.
    assert.equal(MAX_GOAL_TIERS, 5);
  });

  it("documents a landscape background and a square icon", () => {
    assert.equal(ART_SPEC.icon.aspect, 1);
    assert.ok(ART_SPEC.background.aspect > 1, "the background box is landscape");
    assert.equal(
      ART_SPEC.background.recommended.width / ART_SPEC.background.recommended.height,
      ART_SPEC.background.aspect,
      "the recommended size must actually be the documented ratio",
    );
  });
});

describe("the phone's copy", () => {
  /**
   * `mobile-frontend/app/lib/art.ts` is a hand-copied duplicate of this module,
   * because that app deliberately cannot import from the workspace. A copy that
   * silently drifts is worse than no copy: the two surfaces would disagree
   * about which picture is the icon, or draw the same rarity in different
   * colours, and nothing would fail — it would just look wrong on one device.
   *
   * This does not compare the files (they differ by design — one has the long
   * commentary, the other a pointer to it). It checks the parts that must be
   * identical because a user can see both.
   */
  const here = path.dirname(fileURLToPath(import.meta.url));
  const phone = path.resolve(
    here,
    "../../../mobile-frontend/app/lib/art.ts",
  );

  it("exists where the note says it does", () => {
    assert.ok(fs.existsSync(phone), `expected a copy at ${phone}`);
  });

  it("carries the same themes, in the same order", () => {
    const source = fs.readFileSync(phone, "utf8");
    for (const theme of CELEBRATION_THEMES) {
      assert.ok(
        source.includes(`  ${theme}: {`),
        `the phone is missing the "${theme}" theme`,
      );
    }
  });

  it("carries the same palette colours", () => {
    const source = fs.readFileSync(phone, "utf8");
    for (const [theme, palette] of Object.entries(THEME_PALETTES)) {
      assert.ok(
        source.includes(palette.primary),
        `${theme}'s primary ${palette.primary} is not in the phone's copy`,
      );
      for (const particle of palette.particles) {
        assert.ok(
          source.includes(particle),
          `${theme}'s particle ${particle} is not in the phone's copy`,
        );
      }
    }
  });

  it("carries the same limits", () => {
    const source = fs.readFileSync(phone, "utf8");
    assert.ok(source.includes(`MAX_GOAL_TIERS = ${MAX_GOAL_TIERS}`));
    assert.ok(source.includes(`MIN_ART_OVERLAY = ${MIN_ART_OVERLAY}`));
    assert.ok(source.includes(`DEFAULT_ART_OVERLAY = ${DEFAULT_ART_OVERLAY}`));
  });
});
