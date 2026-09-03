import { Hono, type Context } from "hono";
import { cors } from "hono/cors";
import { ensureSchema, getDb } from "@life-os/db";
import {
  CELEBRATION_THEMES,
  MAX_GOAL_TIERS,
  MIN_ART_OVERLAY,
  completeHabitSchema,
  completeCardSchema,
  createAchievementSchema,
  createAgentPropertySchema,
  createGoalSchema,
  createHabitSchema,
  incrementAgentPropertySchema,
  updateAgentPropertySchema,
  agentSetupSchema,
  isAnalyticsRange,
  ACTIVITIES,
  GOAL_CONDITION_SYNTAX,
  REPEAT_RULES,
  createStudySessionSchema,
  injectQuestSchema,
  setHabitThemeSchema,
  updateGamificationConfigSchema,
  updateGoalSchema,
  updateHabitSchema,
  updateSettingsSchema,
  activeSessionSchema,
  cardInteractSchema,
  createTaskSchema,
  updateTaskSchema,
  MIN_PROTOCOL_VERSION,
  TASK_KINDS,
  PROTOCOL_HEADER,
  PROTOCOL_VERSION,
  isSupportedProtocol,
  protocolMismatch,
  readProtocol,
  createWebhookTargetSchema,
  updateWebhookTargetSchema,
  WEBHOOK_EVENTS,
  WEBHOOK_PRESETS,
  XP_MODEL_DOC,
} from "@life-os/shared";
import { requireAuth, type AuthVars } from "./middleware/auth.js";
import { handleMcpRequest } from "./mcp/http.js";
import * as auth from "./services/auth.js";
import * as habits from "./services/habits.js";
import * as study from "./services/study.js";
import * as goals from "./services/goals.js";
import * as dashboard from "./services/dashboard.js";
import * as settings from "./services/settings.js";
import * as achievements from "./services/achievements.js";
import * as quests from "./services/quests.js";
import * as snapshots from "./services/snapshots.js";
import * as properties from "./services/properties.js";
import * as backups from "./services/backups.js";
import * as setup from "./services/setup.js";
import * as webhook from "./services/webhook.js";
import * as tasks from "./services/tasks.js";
import { getAnalytics } from "./services/analytics.js";
import { claimPairingCode, mintPairingCode } from "./services/pairing.js";
import { getPublicUrl, getReachabilityHint, getTunnelMode } from "./reachability.js";
import { isAllowedOrigin, isExposed, lanAddresses } from "./net.js";
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
      /*
       * The public URL is allowed too. It is deliberately not a private
       * address, so the private-network rule alone would reject the dashboard
       * when it is reached through the very tunnel we told the phone to use.
       */
      origin: (origin) => {
        const publicUrl = getPublicUrl();
        const extra = publicUrl
          ? [...env.corsOrigins, publicUrl]
          : env.corsOrigins;
        return isAllowedOrigin(origin, extra) ? origin : null;
      },
      credentials: true,
      /*
       * `X-LifeOS-Protocol` has to be here or the browser's preflight rejects
       * every cross-origin request before it is sent — which is the dev setup
       * (Vite on 5173, API on 8787) and any deployment where the dashboard is
       * not served by the API itself. The failure is a CORS error in the
       * console and a dashboard that never loads, with nothing to connect it
       * back to the header the client started sending.
       */
      /*
       * The `mcp-*` pair is for an MCP client running in a browser. Agents
       * speak to `/mcp` from a server and never send a preflight, but a client
       * that does would fail on the protocol-version header alone, and the
       * failure looks like a dead endpoint rather than a missing header.
       */
      allowHeaders: [
        "Content-Type",
        "Authorization",
        PROTOCOL_HEADER,
        "mcp-protocol-version",
        "mcp-session-id",
      ],
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
   * Trade a pairing code for the real token.
   *
   * **Deliberately unauthenticated** — a phone that had the token would not
   * need to pair. What makes it safe is the code: high entropy, five minutes,
   * single use, and minted only by someone already signed into the dashboard.
   *
   * The token is never in the QR. A short-lived code that burns on first use is
   * strictly better than an encrypted token whose key has to travel with it.
   */
  app.post("/api/v1/pair/claim", async (c) => {
    let code = "";
    try {
      const body = (await c.req.json()) as { code?: string };
      code = String(body.code ?? "");
    } catch {
      return c.json({ error: "Expected { code }" }, 400);
    }
    const result = claimPairingCode(code, env.apiToken);
    if (!result.ok) return c.json({ error: result.error }, 401);
    return c.json({ baseUrl: result.baseUrl, token: result.token });
  });

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

  /** What this server speaks, so a client can check before it does anything. */
  app.get("/api/v1/protocol", (c) =>
    c.json({
      protocol: PROTOCOL_VERSION,
      minProtocol: MIN_PROTOCOL_VERSION,
    }),
  );

  /**
   * MCP, for an agent that cannot spawn a process on this machine.
   *
   * The tools were stdio-only, which quietly assumed the agent shared a
   * filesystem with `lifeos.db`. Plenty do not — a gateway in a container, an
   * agent on another host — and those were pushed onto the REST API, which is
   * the apps' surface: shaped for a screen, and answering "here is the
   * dashboard" when the question was "what happened on the 3rd".
   *
   * Deliberately **not** under `/api/v1`. The version negotiation there is
   * about the shape of the dashboard payload and would 426 every MCP client for
   * not sending a header it has never heard of; MCP does its own negotiation
   * inside the protocol. Same token, though — `requireAuth` is the same
   * middleware the rest of the surface uses.
   */
  app.all("/mcp", requireAuth, (c) => handleMcpRequest(c));

  // Protected API
  const api = new Hono<AppEnv>();
  api.use("*", requireAuth);

  /**
   * Refuse a client that cannot read what we send.
   *
   * v2 collapsed cards, agent events, reviews and study blocks into tasks and
   * removed the old payload. A v1 client asking for the dashboard would get
   * fields it does not understand and none of the ones it wants, and would
   * render an empty day rather than an error — so it is told, with a 426 and a
   * link to a build that works.
   */
  api.use("*", async (c, next) => {
    const claimed = readProtocol(c.req.header(PROTOCOL_HEADER));
    if (!isSupportedProtocol(claimed)) {
      return c.json(protocolMismatch(claimed), 426);
    }
    await next();
  });

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

  /*
   * Tasks. One of the two nouns, the other being habits.
   *
   * `/cards`, `/events`, `/reviews` and `/blocks` are gone. They were four
   * views of the same object with different fields supported, so an agent had
   * to pick a table and live with what it happened not to offer. A client older
   * than protocol v2 gets a 426 from the middleware above rather than a payload
   * it cannot read.
   *
   * There is no `/tasks/:id/start`. A task has a target time and a completion;
   * it does not run, and completing it does not change what activity you are in
   * — that is `/session/active`.
   */
  api.get("/tasks", (c) => {
    const status = c.req.query("status") as
      | "active"
      | "done"
      | "dismissed"
      | undefined;
    const kind = c.req.query("kind") as
      | "task"
      | "study"
      | "review"
      | "reminder"
      | undefined;
    return c.json(tasks.listTasks(getDb(), { status, kind, visibleOnly: true }));
  });
  /** What is current: inside the lead window and not past its own end. */
  api.get("/tasks/current", (c) => c.json(tasks.listCurrentTasks(getDb())));
  /** Notifications that should fire now and have not yet. */
  api.get("/tasks/due", (c) => c.json(tasks.listDueTasks(getDb())));
  api.get("/tasks/:id", (c) => {
    const task = tasks.getTask(getDb(), c.req.param("id"));
    if (!task) return c.json({ error: "Not found" }, 404);
    return c.json(task);
  });
  api.post("/tasks", async (c) => {
    const body = createTaskSchema.parse(await c.req.json());
    const result = tasks.createTask(getDb(), body);
    if ("error" in result) return c.json(result, 400);
    return c.json(result.task, 201);
  });
  api.patch("/tasks/:id", async (c) => {
    const body = updateTaskSchema.parse(await c.req.json());
    const result = tasks.updateTask(getDb(), c.req.param("id"), body);
    if ("error" in result) {
      return c.json(result, result.error === "Task not found" ? 404 : 400);
    }
    return c.json(result.task);
  });
  api.delete("/tasks/:id", (c) =>
    c.json(tasks.deleteTask(getDb(), c.req.param("id"))),
  );
  api.post("/tasks/:id/complete", async (c) => {
    let body: { note?: string | null; source?: "user" | "agent"; progress?: number } =
      { source: "user" };
    try {
      body = completeCardSchema.parse(await c.req.json());
    } catch {
      /* an empty body is a plain completion */
    }
    const result = await tasks.completeTask(getDb(), c.req.param("id"), body);
    if ("error" in result) return c.json(result, 404);
    return c.json(result);
  });
  api.post("/tasks/:id/dismiss", (c) => {
    const result = tasks.dismissTask(getDb(), c.req.param("id"));
    if ("error" in result) return c.json(result, 404);
    return c.json(result);
  });
  api.post("/tasks/:id/notified", (c) => {
    const result = tasks.markTaskNotified(getDb(), c.req.param("id"));
    if ("error" in result) return c.json(result, 404);
    return c.json(result);
  });
  /** Move a task's slider or press its button. Not a completion. */
  api.post("/tasks/:id/interact", async (c) => {
    let body: { value?: number; pressed?: boolean } = {};
    try {
      body = cardInteractSchema.parse(await c.req.json());
    } catch {
      /* a bare button press has no body */
    }
    const result = await tasks.interactWithTask(getDb(), c.req.param("id"), body);
    if ("error" in result) {
      return c.json(result, result.error === "Task not found" ? 404 : 400);
    }
    return c.json(result);
  });

  /*
   * There is no `/cards/:id/start`, and there never will be again. A scheduled
   * card has a target time and a completion; it does not run, and completing it
   * does not change what activity you are in. That is set by hand, from
   * `/sessions/active`.
   */

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
    /*
     * `tier` is optional and a client that predates the ladder omits it, which
     * claims the lowest rung still owed — so an old build walks the ladder one
     * celebration at a time instead of skipping to the top.
     */
    const tier = c.req.query("tier") || undefined;
    const result = goals.markCelebrationSeen(getDb(), c.req.param("id"), tier);
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

  /*
   * Webhook targets. Secrets go in and never come back out — the API returns
   * `secretSet` so the UI can say "configured" without ever handing the value
   * to a browser, a screenshot, or a log.
   */
  api.get("/webhooks/targets", (c) =>
    c.json(webhook.listWebhookTargets(getDb())),
  );
  api.post("/webhooks/targets", async (c) => {
    const body = createWebhookTargetSchema.parse(await c.req.json());
    const result = webhook.createWebhookTarget(getDb(), body);
    if ("error" in result) return c.json(result, 400);
    return c.json(result, 201);
  });
  api.patch("/webhooks/targets/:id", async (c) => {
    const body = updateWebhookTargetSchema.parse(await c.req.json());
    const result = webhook.updateWebhookTarget(getDb(), c.req.param("id"), body);
    if ("error" in result) return c.json(result, 404);
    return c.json(result);
  });
  api.delete("/webhooks/targets/:id", (c) =>
    c.json(webhook.deleteWebhookTarget(getDb(), c.req.param("id"))),
  );
  /** Send a throwaway event, so a target can be proven before it is relied on. */
  api.post("/webhooks/targets/:id/test", async (c) => {
    const result = await webhook.testWebhookTarget(getDb(), c.req.param("id"));
    if ("error" in result) return c.json(result, 404);
    return c.json(result);
  });
  api.get("/webhooks/deliveries", (c) => {
    const limit = Number(c.req.query("limit") ?? 50);
    return c.json(
      webhook.listWebhookDeliveries(
        getDb(),
        Number.isFinite(limit) ? Math.min(200, Math.max(1, limit)) : 50,
      ),
    );
  });
  /** What an agent can subscribe to, so it does not have to guess event names. */
  api.get("/webhooks/events", (c) =>
    c.json({ events: WEBHOOK_EVENTS, presets: WEBHOOK_PRESETS }),
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
  /**
   * Analytics over a window. Every series carries its own history and, where
   * there is a target, the target rides the same axis as the actual.
   */
  api.get("/analytics", (c) => {
    const raw = c.req.query("range");
    const range = isAnalyticsRange(raw) ? raw : "30d";
    return c.json(getAnalytics(getDb(), range));
  });

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
  /* Light reviews are tasks of kind "review" — see /tasks?kind=review. */

  api.get("/achievements", (c) =>
    c.json(achievements.listAchievements(getDb())),
  );
  api.post("/achievements", async (c) => {
    const body = createAchievementSchema.parse(await c.req.json());
    return c.json(achievements.createAchievement(getDb(), body), 201);
  });

  /**
   * Mint a pairing code, for the dashboard to draw as a QR.
   *
   * Which URL to hand the phone, in order of usefulness: the public one if a
   * tunnel is up, then whatever `PUBLIC_URL` names, then the address this very
   * request arrived on. That last fallback is what makes pairing work with no
   * configuration at all — if the browser reached the server at that address, a
   * phone on the same Wi-Fi can too.
   */
  api.post("/pair", (c) => {
    const requestOrigin = (() => {
      try {
        return new URL(c.req.url).origin;
      } catch {
        return null;
      }
    })();

    /*
     * A loopback origin is useless to a phone — "127.0.0.1" on a phone is the
     * phone. Someone with the dashboard open on localhost and the QR on screen
     * would scan it and get a connection refused with nothing to explain why,
     * so the LAN address is used instead.
     */
    const loopback =
      requestOrigin !== null &&
      /^https?:\/\/(127\.|\[?::1\]?|localhost)/i.test(requestOrigin);
    const lan = lanAddresses()[0];
    const base =
      getPublicUrl() ??
      (loopback && lan ? `http://${lan}:${env.apiPort}` : requestOrigin);

    if (!base) {
      return c.json(
        {
          error: "Could not work out a URL to pair with",
          hint:
            "This machine has no network address other than loopback, so a phone " +
            "has nothing to connect to. Join a network, or set PUBLIC_URL.",
        },
        500,
      );
    }
    return c.json(mintPairingCode(base));
  });

  /** Every address this instance answers on, and why there may not be a public one. */
  api.get("/pair/reachability", (c) =>
    c.json({
      publicUrl: getPublicUrl(),
      lan: lanAddresses().map((ip) => `http://${ip}:${env.apiPort}`),
      tunnel: getTunnelMode(),
      hint: getReachabilityHint(),
    }),
  );

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
      version: "0.6.0",
      maxPinnedCards: 2,
      agentSetupCard: { slot: 2, kind: "agent-setup", singleton: true },
      taskKinds: TASK_KINDS,
      /*
       * Two independent picture slots, not one. `image*` is what the card is
       * about and `cardStyle.layout` places it; `iconImage*` is the tile beside
       * the title and is drawn whatever the layout says. A card can have both.
       */
      cardGraphics: [
        "emoji",
        "imageUrl",
        "imageData",
        "iconImageUrl",
        "iconImageData",
        "svg",
      ],
      pinnedCards:
        "A card in slot 0 or 1 is drawn as a card and left out of the agenda, " +
        "the day list and the timeline. Do not create a companion task for one — " +
        "that is two things to tick for one act.",
      /*
       * Habits, goals and tiers all take the same two slots, with the same
       * dimensions, so one picture works in any of them. Everything optional.
       */
      art: {
        fields: [
          "iconImageUrl",
          "iconImageData",
          "backgroundImageUrl",
          "backgroundImageData",
          "artOverlay",
        ],
        on: ["habit", "goal", "goalTier", "card (as imageUrl/iconImageUrl)"],
        background: {
          aspect: "3:2 landscape",
          recommended: "1200x800",
          minimum: "600x400",
          note: "Cover-cropped from the centre — keep the subject away from the edges.",
        },
        icon: {
          aspect: "1:1 square",
          recommended: "256x256",
          minimum: "96x96",
          note: "Drawn at about 44pt. Fine detail reads as mud at that size.",
        },
        overlay: `${MIN_ART_OVERLAY}-0.92 scrim over a background, clamped. It cannot be turned off: a name that cannot be read over its own photograph is a broken row.`,
        caching:
          "Both clients cache what they fetch (Cache Storage on the web, disk via expo-image on the phone). Send a picture once; re-sending the same art is churn on every device watching.",
        optional:
          "Always. A habit or goal with no art renders exactly as it did before art existed, and most should.",
      },
      goalTiers: {
        max: MAX_GOAL_TIERS,
        themes: CELEBRATION_THEMES,
        rules: [
          "Bottom rung first — array order is the ladder.",
          "A higher rung implies every lower one, so write increasing bars rather than unrelated tests.",
          "One celebration per rung, lowest first.",
          "The goal only becomes 'achieved' when the top rung is witnessed; lower rungs fire goal.tier.",
          "Sending tiers replaces the whole ladder. A rung keeping its rank and label keeps the date it was earned.",
        ],
      },
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
        "tasks.crud",
        "tasks.complete",
        "tasks.dismiss",
        "tasks.repeat.spaced",
        "tasks.resources",
        "tasks.control",
        "tasks.svg",
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
