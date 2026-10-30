/**
 * Client/server protocol version.
 *
 * A single integer, bumped whenever the payload shape changes in a way an older
 * client cannot survive. It is deliberately not semver: there is exactly one
 * question — can this client read what this server sends — and a number answers
 * it without anyone parsing a range.
 *
 * The alternative was a compatibility layer translating the new model back into
 * the old shapes forever. That means two models to keep in sync, and the bugs
 * live in the seam between them. A client that is too old should be *told*, not
 * quietly served a lie.
 *
 * | version | change |
 * |---------|--------|
 * | 1 | cards, agent events, light reviews and schedule blocks as separate things |
 * | 2 | one task system: `tasks` replaces all four |
 * | 3 | one agenda: habits carry their own time, and `missed` is a task status |
 * | 4 | incremental sync: `GET /sync` replaces `GET /dashboard/today`, art is a URL |
 */
export const PROTOCOL_VERSION = 4;

/**
 * The oldest client this server will talk to.
 *
 * Equal to `PROTOCOL_VERSION`, and for the same reason each time: the payload
 * that came before is gone rather than deprecated. A v2 client would read the
 * agenda as an empty day and show a task whose status it has no name for, which
 * is worse than being told to update.
 *
 * v4 is the sharpest break so far: `GET /dashboard/today` no longer exists, and
 * a v3 client has no other way to read. Keeping the route for one version was
 * considered and makes no sense — a v3 client is refused at this gate before it
 * ever reaches a route, so the only caller a kept route could have is a v4
 * client, and a v4 client has `GET /sync`, which is strictly better.
 */
export const MIN_PROTOCOL_VERSION = 4;

/** Header a client sends to say what it can read. */
export const PROTOCOL_HEADER = "x-lifeos-protocol";

/** What a client gets back when it is too old. */
export interface ProtocolMismatch {
  error: string;
  hint: string;
  clientProtocol: number;
  serverProtocol: number;
  minProtocol: number;
  /** Where to get a build that works. */
  downloadUrl: string;
}

export function protocolMismatch(clientProtocol: number): ProtocolMismatch {
  return {
    error: "This app is too old for this Life OS server",
    hint:
      "Life OS syncs incrementally now: GET /api/v1/sync returns what changed " +
      "since your cursor, and artwork is a URL rather than base64 in the " +
      "payload. GET /api/v1/dashboard/today is gone. Update the app — the web " +
      "dashboard updates itself, the Android app needs the latest APK.",
    clientProtocol,
    serverProtocol: PROTOCOL_VERSION,
    minProtocol: MIN_PROTOCOL_VERSION,
    downloadUrl:
      "https://github.com/EntangledQuantum/Life_OS/releases/latest/download/life-os.apk",
  };
}

/**
 * Read the protocol a request claims. A missing header means a client written
 * before versioning existed, which by definition is version 1.
 */
export function readProtocol(header: string | null | undefined): number {
  if (!header) return 1;
  const n = Number(header);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 1;
}

export function isSupportedProtocol(version: number): boolean {
  return version >= MIN_PROTOCOL_VERSION;
}
