import { strict as assert } from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import { CELEBRATION_THEMES, MAX_GOAL_TIERS } from "./art.js";
import { WEBHOOK_EVENTS, WEBHOOK_PRESETS } from "./webhooks.js";
import { CARD_LAYOUTS } from "./card-style.js";
import { GROWTH_STYLES } from "./constants.js";

/**
 * The docs an agent reads are part of the product.
 *
 * A capability nobody wrote down does not exist. Life OS is driven almost
 * entirely by an agent that learns what it can do from three files — and those
 * files went stale twice while the code moved underneath them, silently, with
 * every test passing. The agent then reported, correctly, that something was
 * impossible; it was not, it was just undocumented.
 *
 * So the vocabulary is checked against the prose. This cannot tell whether the
 * writing is any good, and it is not trying to: it fails when a name that
 * exists in the code — a webhook event, a celebration theme, a card layout — is
 * not mentioned anywhere an agent would look. Adding one is then a two-file
 * change by construction rather than by memory.
 *
 * The three files, and why each is on the list:
 *
 * - `SKILL.md` — the reference an agent loads to work the app day to day.
 * - `AGENT_SETUP.md` — what a *new* agent fetches to install and set it up.
 *   This is the one that went stale, because it is the one you never reopen.
 * - `API.md` — the REST surface, for anything not going through MCP.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../../..");

const DOCS = {
  skill: "docs/skills/life-os/SKILL.md",
  setup: "docs/AGENT_SETUP.md",
  api: "docs/API.md",
} as const;

function read(which: keyof typeof DOCS): string {
  const full = path.join(root, DOCS[which]);
  assert.ok(fs.existsSync(full), `missing doc: ${DOCS[which]}`);
  return fs.readFileSync(full, "utf8");
}

/** Where each vocabulary has to appear. Prose is free; the names are not. */
function assertDocumented(
  vocabulary: readonly string[],
  where: (keyof typeof DOCS)[],
  what: string,
) {
  for (const doc of where) {
    const source = read(doc);
    const missing = vocabulary.filter((term) => !source.includes(term));
    assert.deepEqual(
      missing,
      [],
      `${DOCS[doc]} does not mention ${what}: ${missing.join(", ")}\n` +
        `An agent reading that file cannot use what it has not been told about.`,
    );
  }
}

describe("what an agent can be told", () => {
  it("documents every webhook event", () => {
    // Adding an event and not writing it down means nobody ever subscribes.
    assertDocumented(WEBHOOK_EVENTS, ["api"], "these webhook events");
  });

  it("documents every webhook preset", () => {
    assertDocumented(WEBHOOK_PRESETS, ["api"], "these webhook presets");
  });

  it("documents every celebration theme", () => {
    /*
     * A theme is a closed set the agent picks from. One that exists in the code
     * and not in the skill is unreachable — the agent has no way to guess it,
     * and an unknown theme is rejected rather than defaulted.
     */
    assertDocumented(CELEBRATION_THEMES, ["skill", "api"], "these celebration themes");
  });

  it("documents every card layout", () => {
    assertDocumented(CARD_LAYOUTS, ["skill"], "these card layouts");
  });

  it("documents every growth style", () => {
    assertDocumented(GROWTH_STYLES, ["skill"], "these growth styles");
  });

  it("documents both picture slots wherever art is offered", () => {
    /*
     * The field names, not the idea. "Habits can have pictures" is not enough
     * to write a request with.
     */
    assertDocumented(
      [
        "iconImageUrl",
        "iconImageData",
        "backgroundImageUrl",
        "backgroundImageData",
        "artOverlay",
      ],
      ["skill", "api"],
      "the art fields",
    );
  });

  it("states the picture dimensions where an agent will look for them", () => {
    // The whole point of a documented size is that it is a number, not "small".
    for (const doc of ["skill", "api"] as const) {
      const source = read(doc);
      assert.ok(
        /1200\s*[×x]\s*800/.test(source),
        `${DOCS[doc]} does not give the background size (1200×800)`,
      );
      assert.ok(
        /256\s*[×x]\s*256/.test(source),
        `${DOCS[doc]} does not give the icon size (256×256)`,
      );
    }
  });

  it("tells a setting-up agent about tiers and art at all", () => {
    /*
     * A softer check than the rest, deliberately: the setup file is a narrative,
     * not a field reference, and pinning its exact wording would make it a chore
     * to improve. But an agent that reads only this file must at least learn
     * that both things exist.
     */
    const setup = read("setup");
    assert.ok(/\btiers\b/.test(setup), "AGENT_SETUP.md never mentions goal tiers");
    assert.ok(
      /icon|background/i.test(setup),
      "AGENT_SETUP.md never mentions that things can carry pictures",
    );
  });

  it("keeps the tier limit consistent between the code and the skill", () => {
    /*
     * Prose is allowed to spell the number out — it is written for a reader —
     * but the limit has to appear somewhere, and raising `MAX_GOAL_TIERS`
     * without touching the doc has to fail rather than quietly disagree.
     */
    const WORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven"];
    const skill = read("skill");
    const forms = [String(MAX_GOAL_TIERS), WORDS[MAX_GOAL_TIERS] ?? "\u0000"];
    assert.ok(
      forms.some(
        (n) =>
          skill.includes(`${n} rungs`) ||
          skill.includes(`up to ${n}`) ||
          skill.includes(`at most ${n}`) ||
          skill.includes(`${n} heights`) ||
          skill.includes(`${n} is the limit`),
      ),
      `the skill does not state the ${MAX_GOAL_TIERS}-tier limit`,
    );
  });
});
