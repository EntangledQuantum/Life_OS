import { nanoid } from "nanoid";
import { desc, eq } from "drizzle-orm";
import type { LifeOsDb } from "@life-os/db";
import * as schema from "@life-os/db";
import { awardXpForStudy, type QualityFlag } from "@life-os/shared";
import {
  addXp,
  loadGamificationConfig,
  nowIso,
} from "./helpers.js";
import { maybeUnlockAchievements } from "./achievements.js";
import { refreshTodaySnapshot } from "./snapshots.js";

export function listStudySessions(db: LifeOsDb, limit = 50) {
  return db
    .select()
    .from(schema.studySessions)
    .orderBy(desc(schema.studySessions.createdAt))
    .limit(limit)
    .all()
    .map(mapSession);
}

function mapSession(s: typeof schema.studySessions.$inferSelect) {
  return {
    id: s.id,
    title: s.title,
    linkedBookSlug: s.linkedBookSlug,
    linkedConceptSlug: s.linkedConceptSlug,
    durationMinutes: s.durationMinutes,
    pages: s.pages,
    qualityFlag: s.qualityFlag as QualityFlag,
    note: s.note,
    generatedSummary: s.generatedSummary,
    source: s.source as "user" | "agent",
    createdAt: s.createdAt,
  };
}

export function createStudySession(
  db: LifeOsDb,
  input: {
    title: string;
    linkedBookSlug?: string | null;
    linkedConceptSlug?: string | null;
    durationMinutes?: number | null;
    pages?: number | null;
    qualityFlag?: QualityFlag;
    note?: string | null;
    generatedSummary?: string | null;
    source?: "user" | "agent";
    blockId?: string | null;
  },
) {
  const config = loadGamificationConfig(db);
  const quality = input.qualityFlag ?? "normal";
  const base = 25 + Math.min(60, input.durationMinutes ?? 0);
  const xp = awardXpForStudy(base, quality, config);
  const id = nanoid();
  const createdAt = nowIso();

  db.insert(schema.studySessions)
    .values({
      id,
      title: input.title,
      linkedBookSlug: input.linkedBookSlug ?? null,
      linkedConceptSlug: input.linkedConceptSlug ?? null,
      durationMinutes: input.durationMinutes ?? null,
      pages: input.pages ?? null,
      qualityFlag: quality,
      note: input.note ?? null,
      generatedSummary: input.generatedSummary ?? null,
      source: input.source ?? "user",
      xpAwarded: xp,
      createdAt,
    })
    .run();

  const xpResult = addXp(db, xp);

  const hour = new Date(createdAt).getHours();
  const unlocked = maybeUnlockAchievements(db, {
    studyInspired: quality === "inspired" || quality === "feynman",
    studyAfter23: hour >= 23 || hour < 4,
  });

  if (
    quality === "inspired" ||
    quality === "feynman" ||
    (input.note && /insight|breakthrough|changed me/i.test(input.note))
  ) {
    db.insert(schema.specialEventCandidates)
      .values({
        id: nanoid(),
        kind: "study",
        refId: id,
        summary: `${quality}: ${input.title}`,
        createdAt,
        reviewedAt: null,
      })
      .run();
  }

  refreshTodaySnapshot(db);

  return {
    session: {
      ...mapSession(
        db.select().from(schema.studySessions).where(eq(schema.studySessions.id, id)).get()!,
      ),
      blockId: input.blockId ?? null,
    },
    xpAwarded: xp,
    totalXp: xpResult.totalXp,
    unlockedAchievements: unlocked,
  };
}
