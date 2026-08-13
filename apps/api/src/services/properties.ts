/**
 * Agent-defined internal properties.
 *
 * These are the extension point of the whole agentic pipeline: an agent can
 * invent a value the app has never heard of ("books_read", "kata_streak"),
 * push to it whenever something happens on its side, and then write a goal
 * condition against it. Nothing in the app needs to be taught what a book is.
 *
 * Each property carries a stable `uid` so an agent can key its own records to
 * it and survive a later relabel of the human-readable `key`.
 */
import { nanoid } from "nanoid";
import { eq } from "drizzle-orm";
import type { LifeOsDb } from "@life-os/db";
import * as schema from "@life-os/db";
import type { AgentProperty } from "@life-os/shared";
import { nowIso } from "./helpers.js";
import { recordPropertyValue } from "./history.js";

type Row = typeof schema.agentProperties.$inferSelect;

function mapProperty(row: Row): AgentProperty {
  return {
    uid: row.id,
    key: row.key,
    label: row.label,
    kind: row.kind as AgentProperty["kind"],
    value: row.value ?? null,
    textValue: row.textValue ?? null,
    unit: row.unit ?? null,
    description: row.description ?? null,
    createdBy: row.createdBy ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function listProperties(db: LifeOsDb): AgentProperty[] {
  return db
    .select()
    .from(schema.agentProperties)
    .all()
    .sort((a, b) => a.key.localeCompare(b.key))
    .map(mapProperty);
}

export function getProperty(db: LifeOsDb, key: string): AgentProperty | null {
  const row = db
    .select()
    .from(schema.agentProperties)
    .where(eq(schema.agentProperties.key, key))
    .get();
  return row ? mapProperty(row) : null;
}

/** Numeric view used by goal conditions. Null when the property is undefined. */
export function propertyNumber(db: LifeOsDb, key: string): number | null {
  const prop = getProperty(db, key);
  if (!prop) return null;
  if (prop.value !== null) return prop.value;
  // A text property still answers numerically if it happens to hold a number.
  const parsed = Number(prop.textValue);
  return Number.isFinite(parsed) ? parsed : null;
}

export function createProperty(
  db: LifeOsDb,
  input: {
    key: string;
    label: string;
    kind?: AgentProperty["kind"];
    value?: number | null;
    textValue?: string | null;
    unit?: string | null;
    description?: string | null;
    createdBy?: string | null;
  },
): { property: AgentProperty } | { error: string } {
  const existing = getProperty(db, input.key);
  if (existing) {
    return {
      error: `Property "${input.key}" already exists (uid ${existing.uid}) — PATCH it instead of redefining`,
    };
  }

  const kind = input.kind ?? "counter";
  const now = nowIso();
  const id = nanoid();
  db.insert(schema.agentProperties)
    .values({
      id,
      key: input.key,
      label: input.label,
      kind,
      // A counter that starts as null would make the first increment ambiguous.
      value: input.value ?? (kind === "counter" || kind === "number" ? 0 : null),
      textValue: input.textValue ?? null,
      unit: input.unit ?? null,
      description: input.description ?? null,
      createdBy: input.createdBy ?? null,
      createdAt: now,
      updatedAt: now,
    })
    .run();

  const created = getProperty(db, input.key)!;
  recordPropertyValue(db, created.uid, created.key, created.value);
  return { property: created };
}

export function updateProperty(
  db: LifeOsDb,
  key: string,
  input: Partial<{
    label: string;
    kind: AgentProperty["kind"];
    value: number | null;
    textValue: string | null;
    unit: string | null;
    description: string | null;
    createdBy: string | null;
  }>,
): AgentProperty | null {
  if (!getProperty(db, key)) return null;
  db.update(schema.agentProperties)
    .set({ ...input, updatedAt: nowIso() })
    .where(eq(schema.agentProperties.key, key))
    .run();
  const next = getProperty(db, key);
  if (next) recordPropertyValue(db, next.uid, next.key, next.value);
  return next;
}

/**
 * Add to a counter. Auto-defines the property on first use so an agent can push
 * data without a separate setup call — the alternative is a lost increment the
 * first time it forgets, which is exactly the kind of silent data loss that
 * makes a goal quietly never fire.
 */
export function incrementProperty(
  db: LifeOsDb,
  key: string,
  by = 1,
  createdBy?: string | null,
): { property: AgentProperty; created: boolean } | { error: string } {
  let created = false;
  let prop = getProperty(db, key);

  if (!prop) {
    if (!/^[a-z][a-z0-9_]*$/.test(key)) {
      return {
        error: `Unknown property "${key}" and the key is not a valid slug — use lower_snake_case, e.g. books_read`,
      };
    }
    const result = createProperty(db, {
      key,
      label: key.replace(/_/g, " "),
      kind: "counter",
      value: 0,
      createdBy: createdBy ?? null,
      description: "Auto-created on first increment",
    });
    if ("error" in result) return result;
    prop = result.property;
    created = true;
  }

  if (prop.kind === "text" || prop.kind === "json") {
    return {
      error: `Property "${key}" is a ${prop.kind} property — set its value with PATCH instead of incrementing`,
    };
  }

  const next = (prop.value ?? 0) + by;
  db.update(schema.agentProperties)
    .set({ value: next, updatedAt: nowIso() })
    .where(eq(schema.agentProperties.key, key))
    .run();

  const updated = getProperty(db, key)!;
  recordPropertyValue(db, updated.uid, updated.key, updated.value);
  return { property: updated, created };
}

export function deleteProperty(db: LifeOsDb, key: string) {
  db.delete(schema.agentProperties)
    .where(eq(schema.agentProperties.key, key))
    .run();
  return { ok: true };
}
