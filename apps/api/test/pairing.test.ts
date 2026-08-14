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
  it("makes the QR a deep link, so a scan opens the app", () => {
    /*
     * The QR used to be a web page URL. That could never work: it opened a
     * browser instead of the app, and Android App Links / iOS Universal Links
     * — the only way an http(s) link opens an app — require a **verified web
     * domain**. This instance answers on an IP address, which can never be
     * verified. A custom scheme has no such requirement.
     */
    const minted = mintPairingCode("http://192.168.1.20:8787");
    assert.ok(
      minted.deepLink.startsWith("lifeos://pair?"),
      `the QR must carry the app scheme, got ${minted.deepLink}`,
    );
    assert.ok(!minted.deepLink.startsWith("http"), "not an http URL");
  });

  it("carries both the code and where the phone should connect", () => {
    // The address the dashboard is open on and the one a phone can reach are
    // not always the same, so the link says which to use rather than assuming.
    const minted = mintPairingCode("http://192.168.1.20:8787");
    const params = new URLSearchParams(minted.deepLink.split("?")[1]);
    assert.equal(params.get("code"), minted.code);
    assert.equal(params.get("url"), "http://192.168.1.20:8787");
  });

  it("never puts the token in anything it hands out", () => {
    const minted = mintPairingCode("https://box.example");
    assert.ok(!JSON.stringify(minted).includes(TOKEN));
  });

  it("keeps the code in the fragment on the web fallback", () => {
    // A fragment is never sent to a server, so the code stays out of access
    // logs and Referer headers on the one path that involves a browser.
    const minted = mintPairingCode("https://box.example");
    assert.ok(minted.webUrl.includes(`#c=${minted.code}`));
    assert.ok(!minted.webUrl.includes("?"), "no query string");
  });

  it("strips a trailing slash so the URL is not doubled", () => {
    const minted = mintPairingCode("https://box.example/");
    assert.equal(minted.baseUrl, "https://box.example");
    assert.ok(minted.webUrl.startsWith("https://box.example/pair#"));
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
