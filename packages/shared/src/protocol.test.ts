import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import {
  MIN_PROTOCOL_VERSION,
  PROTOCOL_VERSION,
  isSupportedProtocol,
  protocolMismatch,
  readProtocol,
} from "./protocol.js";

/**
 * The version handshake.
 *
 * This exists instead of a compatibility layer. Some changes genuinely require
 * a new app — collapsing four tables into one is one of them — and the choice
 * is between translating the new model back into four shapes forever, or saying
 * so once and clearly. This says so.
 */

describe("readProtocol", () => {
  it("treats a missing header as protocol 1", () => {
    /*
     * Every build that shipped before the header existed. They are exactly the
     * clients that cannot read v2, so the absence of the header is itself the
     * answer — not something to be lenient about.
     */
    assert.equal(readProtocol(undefined), 1);
    assert.equal(readProtocol(null), 1);
    assert.equal(readProtocol(""), 1);
  });

  it("treats junk as protocol 1 rather than throwing", () => {
    // A garbled header is not a reason to 500 — it is an old or broken client.
    assert.equal(readProtocol("banana"), 1);
    assert.equal(readProtocol("NaN"), 1);
  });

  it("reads a number", () => {
    assert.equal(readProtocol("2"), 2);
    assert.equal(readProtocol(" 3 "), 3);
  });
});

describe("isSupportedProtocol", () => {
  it("accepts the current version", () => {
    assert.ok(isSupportedProtocol(PROTOCOL_VERSION));
  });

  it("rejects anything below the minimum", () => {
    assert.ok(!isSupportedProtocol(MIN_PROTOCOL_VERSION - 1));
    assert.ok(!isSupportedProtocol(1));
  });

  it("accepts a client claiming to be newer than the server", () => {
    /*
     * A newer app talking to an older server is that app's problem to handle —
     * it knows what changed and can degrade. Refusing it here would break the
     * ordinary case of updating the phone before the machine at home.
     */
    assert.ok(isSupportedProtocol(PROTOCOL_VERSION + 1));
  });
});

describe("protocolMismatch", () => {
  it("says what is wrong, and where to get the fix", () => {
    const body = protocolMismatch(1);
    assert.equal(body.clientProtocol, 1);
    assert.equal(body.serverProtocol, PROTOCOL_VERSION);
    assert.equal(body.minProtocol, MIN_PROTOCOL_VERSION);
    assert.ok(body.error.length > 0);
    assert.ok(body.hint.length > 0, "a version number alone helps nobody");
    assert.ok(
      body.downloadUrl.startsWith("https://"),
      "the whole point is that the user can act on it",
    );
  });
});
