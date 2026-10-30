/**
 * Artwork, addressed by the hash of its own bytes.
 *
 * This is the single biggest thing wrong with the old payload. 2.26 MB went
 * down the wire every eight seconds and 2.21 MB of it was base64 pictures the
 * client already had, decoded, cached by hash, and discarded as a duplicate on
 * arrival. It also crashed the Android app outright: a 2.26 MB row does not fit
 * through Android's 2 MB CursorWindow, so the app died permanently after its
 * first successful fetch.
 *
 * The fix is the oldest trick on the web. Hash the bytes, put the hash in the
 * URL, and serve it with a year of `immutable` — RFC 8246 names versioned URLs
 * as exactly what that directive is for. The hash cannot describe different
 * bytes, so there is nothing to revalidate and no `304` round trip either: a
 * client that has ever seen a picture never asks for it again.
 *
 * **Nothing is moved and nothing is rewritten.** The art stays in the
 * `*_image_data` columns where an agent put it — this is a cache beside the
 * data, built on demand, and the database could be rolled back to the previous
 * release with no loss. Extraction happens lazily, when an entity is about to
 * be sent, so every write path gets it for free: the REST routes, the MCP
 * tools, the seed script, an agent writing SQL directly.
 */
import { createHash } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import type { LifeOsDb } from "@life-os/db";
import * as schema from "@life-os/db";

/** Where an asset lives, relative to the API root. */
export const ASSET_PATH = "/api/v1/assets";

export interface ParsedDataUri {
  mime: string;
  bytes: Buffer;
}

/**
 * Pull the bytes out of a `data:` URI.
 *
 * Both encodings, because agents send both: base64 for a photograph, percent-
 * encoded text for an SVG. Anything that is not a data URI — an ordinary
 * `https://` link to somebody else's image — comes back null and is left
 * completely alone, including on the wire.
 */
export function parseDataUri(value: string | null | undefined): ParsedDataUri | null {
  if (typeof value !== "string") return null;
  if (!value.startsWith("data:")) return null;
  const comma = value.indexOf(",");
  if (comma < 0) return null;
  const header = value.slice(5, comma);
  const body = value.slice(comma + 1);
  const base64 = /;base64$/i.test(header);
  const mime = (base64 ? header.replace(/;base64$/i, "") : header).split(";")[0];
  if (!mime) return null;
  try {
    const bytes = base64
      ? Buffer.from(body, "base64")
      : Buffer.from(decodeURIComponent(body), "utf8");
    if (bytes.length === 0) return null;
    return { mime, bytes };
  } catch {
    return null;
  }
}

export function hashBytes(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/**
 * Store a data URI's bytes and return their hash, or null if it is not one.
 *
 * Content-addressed, so this is idempotent and deduplicating by construction:
 * the same picture on a habit and on the goal it feeds is stored once and
 * fetched once. The `INSERT OR IGNORE` is what makes it safe to call on every
 * sync without checking first.
 */
export function ingestDataUri(
  db: LifeOsDb,
  value: string | null | undefined,
): string | null {
  const parsed = parseDataUri(value);
  if (!parsed) return null;
  const hash = hashBytes(parsed.bytes);
  db.run(
    sql`INSERT OR IGNORE INTO assets (hash, mime, size, bytes, created_at)
        VALUES (${hash}, ${parsed.mime}, ${parsed.bytes.length}, ${parsed.bytes}, ${new Date().toISOString()})`,
  );
  return hash;
}

export interface StoredAsset {
  hash: string;
  mime: string;
  size: number;
  bytes: Buffer;
}

export function getAsset(db: LifeOsDb, hash: string): StoredAsset | null {
  if (!/^[0-9a-f]{64}$/.test(hash)) return null;
  const row = db
    .select()
    .from(schema.assets)
    .where(eq(schema.assets.hash, hash))
    .get();
  if (!row) return null;
  const raw = row.bytes as unknown;
  const bytes = Buffer.isBuffer(raw)
    ? raw
    : Buffer.from(raw as ArrayBufferLike | Uint8Array as Uint8Array);
  return { hash: row.hash, mime: row.mime, size: row.size, bytes };
}

/**
 * The four art fields a habit, goal, tier or card carries, with any inline
 * `data:` replaced by a URL to the asset store.
 *
 * The *shape* does not change, which is the point: `resolveArt()` already
 * prefers `*ImageData` and falls back to `*ImageUrl`, so writing the asset URL
 * into the url slot and nulling the data slot means every existing client
 * renders the same picture through the path it already had. The Android client
 * reads `Art.picture` the same way. This half of the protocol change costs the
 * clients a cache directory and nothing else.
 *
 * An external `*ImageUrl` that was already a real link is untouched. When a row
 * carries both an external link and inline data, the inline data wins — which
 * is what `resolveArt` would have chosen anyway, so the rendered picture is
 * unchanged.
 */
export function externalizeArt<
  T extends {
    iconImageUrl?: string | null;
    iconImageData?: string | null;
    backgroundImageUrl?: string | null;
    backgroundImageData?: string | null;
  },
>(db: LifeOsDb, row: T, base: string): T {
  const out = { ...row };
  const icon = ingestDataUri(db, row.iconImageData);
  if (icon) {
    out.iconImageUrl = assetUrl(base, icon);
    out.iconImageData = null;
  }
  const background = ingestDataUri(db, row.backgroundImageData);
  if (background) {
    out.backgroundImageUrl = assetUrl(base, background);
    out.backgroundImageData = null;
  }
  return out;
}

/** The same, for a card's `image*` pair — what the card is *about*. */
export function externalizePicture<
  T extends { imageUrl?: string | null; imageData?: string | null },
>(db: LifeOsDb, row: T, base: string): T {
  const hash = ingestDataUri(db, row.imageData);
  if (!hash) return row;
  return { ...row, imageUrl: assetUrl(base, hash), imageData: null };
}

/** The data/url field pairs art is stored in, everywhere it is stored. */
const ART_PAIRS: [data: string, url: string][] = [
  ["iconImageData", "iconImageUrl"],
  ["backgroundImageData", "backgroundImageUrl"],
  ["imageData", "imageUrl"],
];

/**
 * Walk anything and externalise every art field in it, however deep.
 *
 * For the shapes this module cannot know in advance — what a service function
 * happens to return from a mutation. `habits.completeHabit` returns the habit it
 * completed, and that came back with 65 KB of base64 in it, which would have put
 * the artwork straight back on the wire through the write path after all the
 * work to take it off the read path. A structural walk is the only honest answer
 * for a value whose shape is "whatever that function returns today".
 *
 * Only used on small values. The sync projections externalise field by field,
 * which is cheaper and typed; this is the net under them.
 */
export function externalizeDeep<T>(db: LifeOsDb, value: T, base: string): T {
  if (Array.isArray(value)) {
    return value.map((item) => externalizeDeep(db, item, base)) as unknown as T;
  }
  if (!value || typeof value !== "object") return value;

  const out: Record<string, unknown> = {};
  for (const [key, inner] of Object.entries(value as Record<string, unknown>)) {
    out[key] = externalizeDeep(db, inner, base);
  }
  for (const [dataKey, urlKey] of ART_PAIRS) {
    if (typeof out[dataKey] !== "string") continue;
    const hash = ingestDataUri(db, out[dataKey] as string);
    if (!hash) continue;
    out[urlKey] = assetUrl(base, hash);
    out[dataKey] = null;
  }
  return out as T;
}

/** One already-resolved picture, as an agenda row carries it. */
export function externalizeOne(
  db: LifeOsDb,
  value: string | null,
  base: string,
): string | null {
  const hash = ingestDataUri(db, value);
  return hash ? assetUrl(base, hash) : value;
}

/**
 * An absolute URL, built from the address the request actually arrived on.
 *
 * Absolute rather than relative because this instance may be published under a
 * path prefix (`…/lifeos`) behind a gateway, and `/api/v1/assets/…` resolved
 * against that base would miss the prefix and 404. A client needs no join logic
 * and no knowledge of how it reached the server.
 */
export function assetUrl(base: string, hash: string): string {
  return `${base.replace(/\/+$/, "")}${ASSET_PATH}/${hash}`;
}

/**
 * Walk every art column once and fill the store.
 *
 * Not required — the sync path ingests what it sends — but it means the first
 * cold sync after an upgrade is not also forty sha-256s of a megabyte each, and
 * it makes the store inspectable immediately. Idempotent; safe to call on boot.
 */
export function backfillAssets(db: LifeOsDb): { stored: number; bytes: number } {
  let stored = 0;
  let bytes = 0;
  const seen = new Set<string>();
  const sources: { rows: Record<string, unknown>[]; columns: string[] }[] = [
    {
      rows: db.select().from(schema.habits).all() as Record<string, unknown>[],
      columns: ["iconImageData", "backgroundImageData"],
    },
    {
      rows: db.select().from(schema.goals).all() as Record<string, unknown>[],
      columns: ["iconImageData", "backgroundImageData"],
    },
    {
      rows: db.select().from(schema.goalTiers).all() as Record<string, unknown>[],
      columns: ["iconImageData", "backgroundImageData"],
    },
    {
      rows: db.select().from(schema.tasks).all() as Record<string, unknown>[],
      columns: ["iconImageData", "imageData"],
    },
  ];

  for (const source of sources) {
    for (const row of source.rows) {
      for (const column of source.columns) {
        const parsed = parseDataUri(row[column] as string | null);
        if (!parsed) continue;
        const hash = hashBytes(parsed.bytes);
        if (seen.has(hash)) continue;
        seen.add(hash);
        ingestDataUri(db, row[column] as string);
        stored += 1;
        bytes += parsed.bytes.length;
      }
    }
  }
  return { stored, bytes };
}
