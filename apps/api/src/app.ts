import { Hono, type Context } from "hono";
import { cors } from "hono/cors";
import { ensureSchema, getDb } from "@life-os/db";
import {
  completeHabitSchema,
  completeCardSchema,
  createAchievementSchema,
  createAgentPropertySchema,
  createDashboardCardSchema,
  createGoalSchema,
  createHabitSchema,
  incrementAgentPropertySchema,
  updateAgentPropertySchema,
  agentSetupSchema,
  ACTIVITIES,
  CARD_KINDS,
  GOAL_CONDITION_SYNTAX,
  REPEAT_RULES,
  createScheduleBlockSchema,
  createStudySessionSchema,
  injectAgentEventSchema,
  injectLightReviewSchema,
  injectQuestSchema,
  setHabitThemeSchema,
  updateDashboardCardSchema,
  updateGamificationConfigSchema,
  updateGoalSchema,
  updateHabitSchema,
  updateScheduleBlockSchema,
  updateSettingsSchema,
  activeSessionSchema,
  XP_MODEL_DOC,
} from "@life-os/shared";
import { requireAuth, type AuthVars } from "./middleware/auth.js";
import * as auth from "./services/auth.js";
import * as habits from "./services/habits.js";
import * as study from "./services/study.js";
import * as goals from "./services/goals.js";
import * as dashboard from "./services/dashboard.js";
import * as settings from "./services/settings.js";
import * as achievements from "./services/achievements.js";
import * as quests from "./services/quests.js";
import * as snapshots from "./services/snapshots.js";
import * as blocks from "./services/blocks.js";
import * as events from "./services/events.js";
import * as cards from "./services/cards.js";
import * as properties from "./services/properties.js";
import * as backups from "./services/backups.js";
import * as setup from "./services/setup.js";
import { isAllowedOrigin, isExposed } from "./net.js";
import { env } from "./env.js";
/** Typed context so `c.get("username")` is checked rather than inferred as never. */
type AppEnv = { Variables: AuthVars };

export function createApp() {
  ensureSchema();
  const app = new Hono<AppEnv>();

  app.use(
    "*",
    cors({
      /**
       * Loopback and private-LAN origins are allowed on any port, so the app
       * works from a phone on the same Wi-Fi without hand-listing its address.
       * Public origins must be named in CORS_ORIGINS — an open policy would let
       * any page the user happens to be browsing talk to their instance.
       */
      origin: (origin) =>
        isAllowedOrigin(origin, env.corsOrigins) ? origin : null,
      credentials: true,
      allowHeaders: ["Content-Type", "Authorization"],
    }),
  );

  app.get("/health", (c) =>
    c.json({
      ok: true,
      service: "life-os-api",
      storage: env.storageMode,
      // Lets a phone or a future native client confirm it reached the right box.
      host: env.apiHost,
      lan: isExposed(env.apiHost),
    }),
  );

  /**
   * Auth is the API token and nothing else.
   *
   * The old `POST /auth/login` took a username and password that defaulted to
   * admin/lifeos and were documented publicly, so it was a way in for anyone who
   * could reach the port rather than a lock. It is gone; the routes answer 410 so
   * an older client fails loudly instead of silently looking unauthenticated.
   */
  const loginGone = (c: Context) =>
    c.json(
      {
        error: "Password login has been removed",
        hint: "Authenticate with Authorization: Bearer <API_TOKEN> from the Life OS .env",
      },
      410,
    );
  app.post("/api/v1/auth/login", loginGone);
  app.post("/api/v1/auth/logout", loginGone);

  /** Cheap way for a client to check its token before showing the app. */
  app.get("/api/v1/auth/me", requireAuth, (c) => {
    return c.json(auth.me(c.get("username")));
  });

  // Protected API
  const api = new Hono<AppEnv>();
  api.use("*", requireAuth);

  /**
   * Re-check every goal after any successful write.
   *
   * "Any change in the database" is the contract agents are given, so the hook
   * lives here rather than being sprinkled through the services — a new
   * endpoint gets goal checking for free instead of silently not having it.
   */
  api.use("*", async (c, next) => {
    await next();
    if (c.req.method === "GET" || c.res.status >= 400) return;
    try {
      goals.evaluateGoals(getDb());
    } catch (error) {
      console.warn("[goals] evaluation failed:", error);
    }
  });

  api.get("/habits", (c) => c.json(habits.listHabits(getDb())));
  api.get("/habits/:id", (c) => {
    const h = habits.getHabit(getDb(), c.req.param("id"));
    if (!h) return c.json({ error: "Not found" }, 404);
    return c.json(h);
  });
  api.post("/habits", async (c) => {
    const body = createHabitSchema.parse(await c.req.json());
    return c.json(habits.createHabit(getDb(), body), 201);
  });
  api.patch("/habits/:id", async (c) => {
    const body = updateHabitSchema.parse(await c.req.json());
    const h = habits.updateHabit(getDb(), c.req.param("id"), body);
    if (!h) return c.json({ error: "Not found" }, 404);
    return c.json(h);
  });
  api.delete("/habits/:id", (c) => {
    habits.deleteHabit(getDb(), c.req.param("id"));
    return c.json({ ok: true });
  });
  api.post("/habits/:id/complete", async (c) => {
    let body: { source: "user" | "agent"; note: string | null } = {
      source: "user",
      note: null,
    };
    try {
      body = { ...body, ...completeHabitSchema.parse(await c.req.json()) };
    } catch {
      /* empty body ok */
    }
    const result = habits.completeHabit(getDb(), c.req.param("id"), body);
    if ("error" in result) {
      // 404 unknown habit, 409 duplicate — agents need to tell these apart.
      return c.json(result, result.error === "Habit not found" ? 404 : 409);
    }
    return c.json(result);
  });
  api.post("/habits/:id/undo", (c) => {
    const result = habits.undoHabitCompletion(getDb(), c.req.param("id"));
    if ("error" in result) return c.json(result, 400);
    return c.json(result);
  });
  api.patch("/habits/:id/theme", async (c) => {
    const body = setHabitThemeSchema.parse(await c.req.json());
    const h = habits.setHabitTheme(getDb(), c.req.param("id"), body);
    if (!h) return c.json({ error: "Not found" }, 404);
    return c.json(h);
  });

  api.get("/study", (c) => c.json(study.listStudySessions(getDb())));
  api.post("/study", async (c) => {
    const body = createStudySessionSchema.parse(await c.req.json());
    return c.json(study.createStudySession(getDb(), body), 201);
  });

  // Agent-defined day blocks (study / life / deep work on timeline)
  api.get("/blocks", (c) => c.json(blocks.listBlocks(getDb())));
  api.get("/blocks/study", (c) => c.json(blocks.listStudyBlocks(getDb())));
  api.post("/blocks", async (c) => {
    const body = createScheduleBlockSchema.parse(await c.req.json());
    return c.json(blocks.createBlock(getDb(), body), 201);
  });
  api.patch("/blocks/:id", async (c) => {
    const body = updateScheduleBlockSchema.parse(await c.req.json());
    const b = blocks.updateBlock(getDb(), c.req.param("id"), body);
    if (!b) return c.json({ error: "Not found" }, 404);
    return c.json(b);
  });
  api.delete("/blocks/:id", (c) =>
    c.json(blocks.deleteBlock(getDb(), c.req.param("id"))),
  );
  api.post("/blocks/:id/start", (c) => {
    const r = blocks.startBlock(getDb(), c.req.param("id"));
    if ("error" in r) return c.json(r, 404);
    return c.json(r);
  });
  api.post("/blocks/:id/complete", (c) => {
    const r = blocks.completeBlock(getDb(), c.req.param("id"));
    if ("error" in r) return c.json(r, 404);
    return c.json(r);
  });

  api.get("/events", (c) => c.json(events.listAgentEvents(getDb())));
  api.post("/events", async (c) => {
    const body = injectAgentEventSchema.parse(await c.req.json());
    return c.json(events.injectAgentEvent(getDb(), body), 201);
  });
  api.post("/events/:id/complete", (c) => {
    const result = events.completeAgentEvent(getDb(), c.req.param("id"));
    if ("error" in result) return c.json(result, 404);
    return c.json(result);
  });
  api.post("/events/:id/dismiss", (c) =>
    c.json(events.dismissAgentEvent(getDb(), c.req.param("id"))),
  );

  // Agent cards: 2 pinned content slots + the setup card + scheduled event/reminder cards
  api.get("/cards", (c) => c.json(cards.listCards(getDb())));
  api.get("/cards/upcoming", (c) => c.json(cards.listUpcomingCards(getDb())));
  /** Only what is about to happen — within 15 minutes, overdue, or pinged. */
  api.get("/cards/imminent", (c) => c.json(cards.listImminentCards(getDb())));
  api.get("/cards/due", (c) => c.json(cards.listDueReminders(getDb())));
  api.get("/cards/:id", (c) => {
    const card = cards.getCard(getDb(), c.req.param("id"));
    if (!card) return c.json({ error: "Not found" }, 404);
    return c.json(card);
  });
  api.post("/cards", async (c) => {
    const body = createDashboardCardSchema.parse(await c.req.json());
    const result = cards.createCard(getDb(), {
      ...body,
      imageUrl: body.imageUrl || null,
      meta: body.meta ?? null,
    });
    if ("error" in result) return c.json(result, 400);
    // svgNotes lists anything the sanitizer stripped, so agents can self-correct.
    return c.json({ ...result.card, svgNotes: result.svgNotes }, 201);
  });
  api.patch("/cards/:id", async (c) => {
    const body = updateDashboardCardSchema.parse(await c.req.json());
    const result = cards.updateCard(getDb(), c.req.param("id"), {
      ...body,
      imageUrl: body.imageUrl === "" ? null : body.imageUrl,
      meta: body.meta ?? undefined,
    });
    if (!result) return c.json({ error: "Not found" }, 404);
    if ("error" in result) return c.json(result, 400);
    return c.json(result);
  });
  api.delete("/cards/:id", (c) =>
    c.json(cards.deleteCard(getDb(), c.req.param("id"))),
  );
  /** Client confirms it actually chimed, so the reminder fires exactly once. */
  api.post("/cards/:id/notified", (c) => {
    const result = cards.markCardNotified(getDb(), c.req.param("id"));
    if ("error" in result) return c.json(result, 404);
    return c.json(result);
  });

  /** Start a scheduled card — it takes over the timeline under its activity tag. */
  api.post("/cards/:id/start", (c) => {
    const result = cards.startCard(getDb(), c.req.param("id"));
    if ("error" in result) {
      return c.json(result, result.error === "Card not found" ? 404 : 409);
    }
    return c.json(result);
  });

  api.post("/cards/:id/complete", async (c) => {
    let body: { note?: string | null; source?: "user" | "agent"; progress?: number } =
      { source: "user" };
    try {
      body = completeCardSchema.parse(await c.req.json());
    } catch {
      /* empty ok */
    }
    const result = await cards.completeCard(getDb(), c.req.param("id"), body);
    if ("error" in result) return c.json(result, 404);
    return c.json(result);
  });

  api.post("/habits/rebalance-xp", (c) =>
    c.json({ shares: habits.rebalanceHabitXp(getDb()) }),
  );

  api.get("/goals", (c) => c.json(goals.listGoals(getDb())));
  /** Goals whose condition is true but whose celebration has not been watched. */
  api.get("/goals/pending-celebration", (c) =>
    c.json(goals.pendingCelebrations(getDb())),
  );
  api.post("/goals", async (c) => {
    const body = createGoalSchema.parse(await c.req.json());
    const result = goals.createGoal(getDb(), body);
    if ("error" in result) return c.json(result, 400);
    return c.json(result.goal, 201);
  });
  api.patch("/goals/:id", async (c) => {
    const body = updateGoalSchema.parse(await c.req.json());
    const g = goals.updateGoal(getDb(), c.req.param("id"), body);
    if (!g) return c.json({ error: "Not found" }, 404);
    if ("error" in g) return c.json(g, 400);
    return c.json(g);
  });
  /**
   * The user watched the celebration — the only way a goal becomes `achieved`.
   * A met-but-unwitnessed goal stays active on purpose.
   */
  api.post("/goals/:id/celebration-seen", (c) => {
    const result = goals.markCelebrationSeen(getDb(), c.req.param("id"));
    if (!result) return c.json({ error: "Not found" }, 404);
    if ("error" in result) return c.json(result, 409);
    return c.json(result.goal);
  });
  /** Force a re-check without waiting for the next write. */
  api.post("/goals/evaluate", (c) =>
    c.json({ evaluated: goals.evaluateGoals(getDb()) }),
  );
  api.delete("/goals/:id", (c) => {
    goals.deleteGoal(getDb(), c.req.param("id"));
    return c.json({ ok: true });
  });

  // Agent-defined internal properties — the counters goal conditions read.
  api.get("/properties", (c) => c.json(properties.listProperties(getDb())));
  api.get("/properties/:key", (c) => {
    const prop = properties.getProperty(getDb(), c.req.param("key"));
    if (!prop) return c.json({ error: "Not found" }, 404);
    return c.json(prop);
  });
  api.post("/properties", async (c) => {
    const body = createAgentPropertySchema.parse(await c.req.json());
    const result = properties.createProperty(getDb(), body);
    if ("error" in result) return c.json(result, 409);
    return c.json(result.property, 201);
  });
  api.patch("/properties/:key", async (c) => {
    const body = updateAgentPropertySchema.parse(await c.req.json());
    const prop = properties.updateProperty(getDb(), c.req.param("key"), body);
    if (!prop) return c.json({ error: "Not found" }, 404);
    return c.json(prop);
  });
  api.post("/properties/:key/increment", async (c) => {
    let body = { by: 1 };
    try {
      body = incrementAgentPropertySchema.parse(await c.req.json());
    } catch {
      /* empty body means +1 */
    }
    const result = properties.incrementProperty(
      getDb(),
      c.req.param("key"),
      body.by,
    );
    if ("error" in result) return c.json(result, 400);
    return c.json(result);
  });
  api.delete("/properties/:key", (c) =>
    c.json(properties.deleteProperty(getDb(), c.req.param("key"))),
  );

  // Database snapshots
  api.get("/backups", (c) =>
    c.json({
      backups: backups.listDatabaseBackups(),
      settings: {
        backupsEnabled: settings.getSettings(getDb()).backupsEnabled,
        backupIntervalHours: settings.getSettings(getDb()).backupIntervalHours,
        backupKeep: settings.getSettings(getDb()).backupKeep,
        lastBackupAt: settings.getSettings(getDb()).lastBackupAt,
      },
    }),
  );
  api.post("/backups", (c) => {
    const result = backups.runBackup(getDb(), { force: true });
    if (!result.ok) return c.json(result, 500);
    return c.json(result, 201);
  });

  api.get("/dashboard/today", (c) => c.json(dashboard.getDashboard(getDb())));
  api.get("/dashboard/vs-yesterday", (c) =>
    c.json(snapshots.getVsYesterday(getDb())),
  );
  api.get("/dashboard/pulse", (c) => c.json(snapshots.getPulse(getDb())));
  api.get("/analytics", (c) => c.json(dashboard.getAnalytics(getDb())));

  api.get("/session/active", (c) => {
    const d = dashboard.getDashboard(getDb());
    return c.json(d.activeSession);
  });
  api.post("/session/active", async (c) => {
    const body = activeSessionSchema.parse(await c.req.json());
    return c.json(
      dashboard.setActiveSession(
        getDb(),
        body.activity,
        body.startedAt,
        body.blockId,
      ),
    );
  });
  api.delete("/session/active", (c) =>
    c.json(dashboard.clearActiveSession(getDb())),
  );
  /**
   * Finish the running session and hand the day back to whatever it
   * interrupted. DELETE stops everything; this stops just this one.
   */
  api.post("/session/end", (c) =>
    c.json({ activeSession: dashboard.endActiveSession(getDb()) }),
  );

  api.get("/quests", (c) => c.json(quests.listQuests(getDb())));
  api.post("/quests", async (c) => {
    const body = injectQuestSchema.parse(await c.req.json());
    return c.json(quests.injectQuest(getDb(), body), 201);
  });
  api.get("/reviews", (c) => c.json(quests.listLightReviews(getDb())));
  api.post("/reviews", async (c) => {
    const body = injectLightReviewSchema.parse(await c.req.json());
    return c.json(quests.injectLightReview(getDb(), body), 201);
  });
  api.post("/reviews/:id/complete", (c) =>
    c.json(quests.completeLightReview(getDb(), c.req.param("id"))),
  );

  api.get("/achievements", (c) =>
    c.json(achievements.listAchievements(getDb())),
  );
  api.post("/achievements", async (c) => {
    const body = createAchievementSchema.parse(await c.req.json());
    return c.json(achievements.createAchievement(getDb(), body), 201);
  });

  api.get("/settings", (c) => c.json(settings.getSettings(getDb())));
  api.patch("/settings", async (c) => {
    const body = updateSettingsSchema.parse(await c.req.json());
    return c.json(settings.updateSettings(getDb(), body));
  });

  api.get("/gamification/config", (c) =>
    c.json(settings.getGamificationConfig(getDb())),
  );
  api.patch("/gamification/config", async (c) => {
    const body = updateGamificationConfigSchema.parse(await c.req.json());
    return c.json(settings.updateGamificationConfig(getDb(), body));
  });

  api.get("/export/json", (c) => c.json(settings.exportAll(getDb())));

  api.get("/agent/capabilities", (c) =>
    c.json({
      name: "Life OS",
      version: "0.4.0",
      maxPinnedCards: 2,
      agentSetupCard: { slot: 2, kind: "agent-setup", singleton: true },
      cardKinds: CARD_KINDS,
      cardGraphics: ["emoji", "imageUrl", "imageData", "svg"],
      /** The closed set of day buckets. Invent any content; map it onto one of these. */
      activityTags: ACTIVITIES,
      repeatRules: REPEAT_RULES,
      scheduleRule:
        "showAt <= remindAt < eventAt. The user is always told about a thing before the thing; " +
        "a card whose reminder lands at or after its own event is rejected with 400.",
      growthStyles: ["sprout", "orb"],
      legacyGrowthStyles: { plant: "sprout", water: "orb", both: "sprout" },
      settings:
        "Every field of GET /api/v1/settings is agent-writable via PATCH, including " +
        "day reset, quiet hours, sleep window, theme, celebration intensity, webhooks and backups.",
      goals:
        "Goals are yours to set, not the user's. Write a condition, push data into properties, " +
        "and the system re-checks after every write. See GET /api/v1/agent/goal-syntax.",
      tools: [
        "cards.crud",
        "cards.complete",
        "cards.svg",
        "cards.agent-setup",
        "cards.schedule",
        "cards.reminders",
        "cards.start",
        "cards.repeat.spaced",
        "habits.crud",
        "habits.complete",
        "habits.rebalance-xp",
        "blocks.crud",
        "blocks.start_complete",
        "events.inject",
        "events.xpOnComplete",
        "study.log",
        "goals.crud",
        "goals.conditions",
        "goals.celebration",
        "properties.crud",
        "properties.increment",
        "quests.inject",
        "reviews.inject",
        "gamification.config",
        "dailyXpTarget",
        "settings.all",
        "settings.agentWebhook",
        "backups.run",
        "dashboard.today",
        "agent.xp-model",
        "export.json",
      ],
      notes:
        "Agent owns 2 pinned cards + 1 setup card + unlimited scheduled event/reminder cards, " +
        "habits, blocks, goals, internal properties, settings and the XP pool. " +
        "Webhooks fire on complete. No levels. See GET /api/v1/agent/xp-model.",
    }),
  );

  /** Reshape the whole instance in one call — habits, hours, XP pool, setup card. */
  api.post("/agent/setup", async (c) => {
    const body = agentSetupSchema.parse(await c.req.json());
    return c.json(setup.runInitialSetup(getDb(), body));
  });

  /** Copy-pasteable goal + property syntax, so agents never have to guess. */
  api.get("/agent/goal-syntax", (c) =>
    c.json({
      ...GOAL_CONDITION_SYNTAX,
      celebration:
        "When a condition first comes true the goal gets conditionMetAt and appears in " +
        "GET /api/v1/goals/pending-celebration. It stays status:'active' until the user has " +
        "seen the animation and the client calls POST /api/v1/goals/<id>/celebration-seen. " +
        "An unwitnessed goal is not a finished goal.",
      liveProperties: properties.listProperties(getDb()),
    }),
  );

  // Self-describing XP rules so agents never have to guess the maths.
  api.get("/agent/xp-model", (c) => {
    const config = settings.getGamificationConfig(getDb());
    const activeHabits = habits.listHabits(getDb());
    return c.json({
      ...XP_MODEL_DOC,
      current: {
        dailyXpTarget: config.dailyXpTarget,
        baseMultipliers: config.baseMultipliers,
        growthStyle: config.growthStyle,
        activeHabitCount: activeHabits.length,
        totalWeight: activeHabits.reduce((a, h) => a + (h.xpWeight || 1), 0),
        shares: activeHabits.map((h) => ({
          id: h.id,
          name: h.name,
          xpWeight: h.xpWeight,
          baseXp: h.baseXp,
          extraXp: h.extraXp,
        })),
      },
    });
  });

  app.route("/api/v1", api);

  app.onError((err, c) => {
    console.error(err);
    if (err && typeof err === "object" && "issues" in err) {
      return c.json({ error: "Validation failed", details: err }, 400);
    }
    return c.json(
      { error: err instanceof Error ? err.message : "Internal error" },
      500,
    );
  });

  return app;
}
