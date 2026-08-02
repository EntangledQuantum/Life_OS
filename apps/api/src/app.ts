import { Hono } from "hono";
import { cors } from "hono/cors";
import { ensureSchema, getDb } from "@life-os/db";
import {
  completeHabitSchema,
  createAchievementSchema,
  createGoalSchema,
  createHabitSchema,
  createScheduleBlockSchema,
  createStudySessionSchema,
  injectAgentEventSchema,
  injectLightReviewSchema,
  injectQuestSchema,
  loginSchema,
  setHabitThemeSchema,
  updateGamificationConfigSchema,
  updateGoalSchema,
  updateHabitSchema,
  updateScheduleBlockSchema,
  updateSettingsSchema,
  activeSessionSchema,
} from "@life-os/shared";
import { requireAuth } from "./middleware/auth.js";
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
import { env } from "./env.js";
export function createApp() {
  ensureSchema();
  const app = new Hono();

  app.use(
    "*",
    cors({
      origin: ["http://localhost:5173", "http://127.0.0.1:5173", "http://localhost:4173"],
      credentials: true,
      allowHeaders: ["Content-Type", "Authorization"],
    }),
  );

  app.get("/health", (c) =>
    c.json({ ok: true, service: "life-os-api", storage: env.storageMode }),
  );

  // Auth
  app.post("/api/v1/auth/login", async (c) => {
    const body = loginSchema.parse(await c.req.json());
    const result = auth.login(getDb(), body.username, body.password);
    if (!result.ok) return c.json({ error: result.error }, 401);
    c.header(
      "Set-Cookie",
      `lifeos_token=${result.token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${7 * 86400}`,
    );
    return c.json({
      token: result.token,
      username: result.username,
      user: auth.me(result.username),
    });
  });

  app.post("/api/v1/auth/logout", requireAuth, async (c) => {
    const header = c.req.header("authorization");
    const token = header?.startsWith("Bearer ") ? header.slice(7) : "";
    if (token) auth.logout(getDb(), token);
    c.header(
      "Set-Cookie",
      "lifeos_token=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0",
    );
    return c.json({ ok: true });
  });

  app.get("/api/v1/auth/me", requireAuth, (c) => {
    return c.json(auth.me(c.get("username") as string));
  });

  // Protected API
  const api = new Hono();
  api.use("*", requireAuth);

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
    let body = { source: "user" as const, note: null as string | null };
    try {
      body = { ...body, ...completeHabitSchema.parse(await c.req.json()) };
    } catch {
      /* empty body ok */
    }
    const result = habits.completeHabit(getDb(), c.req.param("id"), body);
    if ("error" in result && result.error === "Habit not found") {
      return c.json(result, 404);
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
  api.post("/events/:id/complete", (c) =>
    c.json(events.completeAgentEvent(getDb(), c.req.param("id"))),
  );
  api.post("/events/:id/dismiss", (c) =>
    c.json(events.dismissAgentEvent(getDb(), c.req.param("id"))),
  );

  api.get("/goals", (c) => c.json(goals.listGoals(getDb())));
  api.post("/goals", async (c) => {
    const body = createGoalSchema.parse(await c.req.json());
    return c.json(goals.createGoal(getDb(), body), 201);
  });
  api.patch("/goals/:id", async (c) => {
    const body = updateGoalSchema.parse(await c.req.json());
    const g = goals.updateGoal(getDb(), c.req.param("id"), body);
    if (!g) return c.json({ error: "Not found" }, 404);
    return c.json(g);
  });
  api.delete("/goals/:id", (c) => {
    goals.deleteGoal(getDb(), c.req.param("id"));
    return c.json({ ok: true });
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
      version: "0.1.0",
      tools: [
        "habits.crud",
        "habits.complete",
        "blocks.crud",
        "blocks.start_complete",
        "events.inject",
        "study.log",
        "goals.crud",
        "quests.inject",
        "reviews.inject",
        "gamification.config",
        "dailyXpTarget",
        "settings.dayResetTime",
        "dashboard.today",
        "export.json",
      ],
      notes:
        "No levels — efficiency % & improvement %. User completes; agent customizes. Day resets at dayResetTime.",
    }),
  );

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
