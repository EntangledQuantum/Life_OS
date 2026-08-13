import { strict as assert } from "node:assert";
import { beforeEach, describe, it } from "node:test";
import {
  claimPairingCode,
  mintPairingCode,
  outstandingCount,
  revokeAllPairingCodes,
} from "../src/services/pairing.js";

/**
 * Pairing.
 *
 * The claim endpoint is unauthenticated by necessity — a phone that already had
 * the token would not need to pair — so everything that makes it safe lives in
 * these properties: the code expires, it burns on first use, and it is never
 * the token itself.
 */

const TOKEN = "lifeos_the_real_token_value";

beforeEach(() => revokeAllPairingCodes());

describe("minting", () => {
  it("puts the code in the fragment, never the query string", () => {
    /*
     * A fragment is never sent to a server. That keeps the one thing that can
     * be traded for a credential out of access logs, out of Referer headers,
     * and out of every proxy in between.
     */
    const minted = mintPairingCode("https://box.tail1234.ts.net");
    assert.ok(minted.url.includes(`#c=${minted.code}`));
    assert.ok(!minted.url.includes("?"), "no query string");
  });

  it("never puts the token in the URL", () => {
    const minted = mintPairingCode("https://box.example");
    assert.ok(!minted.url.includes(TOKEN));
    assert.ok(!JSON.stringify(minted).includes(TOKEN));
  });

  it("strips a trailing slash so the URL is not doubled", () => {
    const minted = mintPairingCode("https://box.example/");
    assert.equal(minted.baseUrl, "https://box.example");
    assert.ok(minted.url.startsWith("https://box.example/pair#"));
  });

  it("uses an alphabet without the characters people misread", () => {
    // No O/0, no I/l/1 — the QR is the happy path, but someone will type it.
    for (let i = 0; i < 40; i++) {
      const { code } = mintPairingCode("https://box.example");
      assert.ok(!/[O0Il1]/.test(code), `ambiguous character in ${code}`);
    }
  });

  it("bounds how many codes can be outstanding", () => {
    for (let i = 0; i < 60; i++) mintPairingCode("https://box.example");
    assert.ok(outstandingCount() <= 20);
  });
});

describe("claiming", () => {
  it("trades a code for the real token", () => {
    const minted = mintPairingCode("https://box.example");
    const result = claimPairingCode(minted.code, TOKEN);
    assert.ok(result.ok);
    assert.equal(result.token, TOKEN);
    assert.equal(result.baseUrl, "https://box.example");
  });

  it("burns the code — a second attempt gets nothing", () => {
    const minted = mintPairingCode("https://box.example");
    assert.ok(claimPairingCode(minted.code, TOKEN).ok);

    const replay = claimPairingCode(minted.code, TOKEN);
    assert.ok(!replay.ok, "a replayed claim must fail");
  });

  it("expires after five minutes", () => {
    const now = Date.now();
    const minted = mintPairingCode("https://box.example", now);

    const justBefore = claimPairingCode(minted.code, TOKEN, now + 4 * 60_000);
    assert.ok(justBefore.ok, "still good at four minutes");

    const again = mintPairingCode("https://box.example", now);
    const after = claimPairingCode(again.code, TOKEN, now + 6 * 60_000);
    assert.ok(!after.ok, "gone at six minutes");
  });

  it("accepts a lowercase code, since someone will type it that way", () => {
    const minted = mintPairingCode("https://box.example");
    const result = claimPairingCode(minted.code.toLowerCase(), TOKEN);
    assert.ok(result.ok);
  });

  it("says the same thing for a wrong code as an expired one", () => {
    /*
     * Distinguishing them would confirm that a guessed code once existed, which
     * is a free hint for anything walking the space.
     */
    const expired = mintPairingCode("https://box.example", Date.now() - 10 * 60_000);
    const a = claimPairingCode(expired.code, TOKEN);
    const b = claimPairingCode("ZZZZZZZZZZZZ", TOKEN);
    assert.ok(!a.ok && !b.ok);
    assert.equal(a.error, b.error);
  });

  it("refuses an empty code rather than matching anything", () => {
    mintPairingCode("https://box.example");
    const result = claimPairingCode("   ", TOKEN);
    assert.ok(!result.ok);
  });
});

describe("revoking", () => {
  it("drops every outstanding code", () => {
    const minted = mintPairingCode("https://box.example");
    revokeAllPairingCodes();
    assert.equal(outstandingCount(), 0);
    assert.ok(!claimPairingCode(minted.code, TOKEN).ok);
  });
});
