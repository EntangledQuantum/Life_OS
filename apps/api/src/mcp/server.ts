/**
 * The Life OS MCP server: tools, and the dispatch behind them.
 *
 * **Transport lives elsewhere on purpose.** This module builds a configured
 * `Server` and hands it back; who it talks to is someone else's problem.
 * `packages/mcp` connects it to stdio for an agent on this machine, and
 * `http.ts` next door serves the same thing over HTTP for one that is not.
 *
 * That split is the whole point. stdio requires a shared filesystem, so an
 * agent in a container or on another host could not reach these tools at all
 * and had to fall back to REST — which is the *apps'* surface, shaped for a
 * screen, and makes an agent reassemble a day out of a dozen round-trips.
 *
 * It lives under `apps/api` rather than in `packages/mcp` because every tool
 * here calls an API service. With the definition over there, the API importing
 * it to serve `/mcp` would have been a cycle.
 */
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { getDb, type LifeOsDb } from "@life-os/db";
import {
  getDaySummary,
  getRangeSummary,
  searchHistory,
} from "../services/narrative.js";
import {
  currentLifeDay,
  getWorkload,
  selectForCleanup,
  withVisibility,
} from "../services/agent-view.js";
import { z } from "zod";

/*
 * Environment is the caller's job. The API loads `.env` through `env.ts` before
 * it builds the app; the stdio entry loads it before it imports this module.
 * Loading it here as well would have to guess at the repo root from a path
 * relative to this file, and that guess broke the moment the file moved.
 */

import { listHabits, createHabit, updateHabit, deleteHabit, completeHabit, setHabitTheme, rebalanceHabitXp } from "../services/habits.js";
import {
  listGoals,
  createGoal,
  updateGoal,
  deleteGoal,
  evaluateGoals,
  pendingCelebrations,
} from "../services/goals.js";
import {
  listProperties,
  getProperty,
  createProperty,
  updateProperty,
  incrementProperty,
  deleteProperty,
} from "../services/properties.js";
import { runInitialSetup } from "../services/setup.js";
import {
  listDatabaseBackups,
  runBackup,
} from "../services/backups.js";
import { createStudySession } from "../services/study.js";
import {
  completeTask,
  createTask,
  deleteTask,
  dismissTask,
  getTask,
  listCurrentTasks,
  listDueTasks,
  listTasks,
  markTaskNotified,
  updateTask,
} from "../services/tasks.js";
import {
  createWebhookTarget,
  deleteWebhookTarget,
  listWebhookDeliveries,
  listWebhookTargets,
  testWebhookTarget,
  updateWebhookTarget,
} from "../services/webhook.js";
import { getDashboard } from "../services/dashboard.js";
import { getVsYesterday, getPulse } from "../services/snapshots.js";
import { injectQuest, listQuests } from "../services/quests.js";
import {
  getSettings,
  updateSettings,
  getGamificationConfig,
  updateGamificationConfig,
  exportAll,
} from "../services/settings.js";
import { listAchievements, createAchievement } from "../services/achievements.js";
import {
  ACTIVITIES,
  GOAL_CONDITION_SYNTAX,
  GOAL_METRICS,
  NOTIFICATION_SOUND_IDS,
  REPEAT_RULES,
  WEBHOOK_EVENTS,
  TASK_KINDS,
  localDateString,
  XP_MODEL_DOC,
} from "@life-os/shared";

/** Reported to every client, over either transport. */
export const MCP_SERVER_VERSION = "0.7.0";

const tools = [
  /*
   * ---------------------------------------------------------------------
   * Agent-shaped tools.
   *
   * These exist because MCP and REST are different surfaces on purpose. The
   * REST API is built for a screen — one dashboard payload, polled. An agent
   * asking "what happened last Tuesday" through CRUD tools has to fetch tasks,
   * then habit logs, then study sessions, then reassemble them, and it cannot
   * ask the dashboard for a past date at all.
   *
   * One call, one answer, already summarised. Everything below this block is
   * the CRUD, which is for writing rather than for understanding.
   * ---------------------------------------------------------------------
   */
  {
    name: "lifeos_get_day",
    description:
      "What actually happened on one day, summarised: XP against target, which habits closed and which did not, which scheduled things were done, missed, late or dismissed, study minutes, and what the user said they were doing. Returns a `story` line you can quote. Use this instead of assembling a day out of several list calls.",
    inputSchema: {
      type: "object" as const,
      properties: {
        date: {
          type: "string",
          description: "YYYY-MM-DD. Defaults to today (the life-day, which rolls at dayResetTime).",
        },
      },
    },
  },
  {
    name: "lifeos_get_range",
    description:
      "A window of days in one call: totals, per-habit completion rates, a line per day, and a `story` naming which habits are holding and which are slipping. Use this for 'how has this week/month gone' rather than calling lifeos_get_day repeatedly. Capped at 90 days.",
    inputSchema: {
      type: "object" as const,
      properties: {
        days: { type: "number", description: "How many days back. Default 7, max 90." },
        to: { type: "string", description: "Last day, YYYY-MM-DD. Defaults to today." },
      },
    },
  },
  {
    name: "lifeos_search_history",
    description:
      "Free-text search across tasks, study sessions and habits — titles, subtitles and bodies. Answers 'when did I last touch X' without scanning tables by hand.",
    inputSchema: {
      type: "object" as const,
      properties: {
        query: { type: "string", description: "What to look for." },
        limit: { type: "number", description: "Max results, default 25." },
      },
      required: ["query"],
    },
  },
  {
    name: "lifeos_bulk_create_tasks",
    description:
      "Create many tasks in one call — this is how you schedule a day or a week. Each entry takes the same fields as lifeos_create_task. Returns what was created and, separately, anything that was rejected with the reason, so a bad entry does not silently swallow the good ones.",
    inputSchema: {
      type: "object" as const,
      properties: {
        tasks: {
          type: "array",
          description: "The tasks to create.",
          items: { type: "object" as const },
        },
      },
      required: ["tasks"],
    },
  },
  {
    name: "lifeos_list_habits",
    description: "List all active habits with today status, streaks, and themes",
    inputSchema: { type: "object" as const, properties: {} },
  },
  {
    name: "lifeos_create_habit",
    description: "Create a habit (encourage tiny + anchor). Optional emoji, color, graphic theme.",
    inputSchema: {
      type: "object" as const,
      properties: {
        name: { type: "string" },
        emoji: { type: "string" },
        category: { type: "string" },
        isTiny: { type: "boolean" },
        baseXp: { type: "number" },
        anchor: { type: "string" },
        themeColor: { type: "string" },
        themeGraphic: {
          type: "string",
          enum: ["ring", "liquid", "tree", "flame", "none"],
        },
      },
      required: ["name"],
    },
  },
  {
    name: "lifeos_update_habit",
    description: "Update habit fields by id",
    inputSchema: {
      type: "object" as const,
      properties: {
        id: { type: "string" },
        name: { type: "string" },
        emoji: { type: "string" },
        baseXp: { type: "number" },
        active: { type: "boolean" },
      },
      required: ["id"],
    },
  },
  {
    name: "lifeos_delete_habit",
    description: "Soft-delete a habit",
    inputSchema: {
      type: "object" as const,
      properties: { id: { type: "string" } },
      required: ["id"],
    },
  },
  {
    name: "lifeos_complete_habit",
    description: "One-tap complete a habit (source=agent). Awards XP.",
    inputSchema: {
      type: "object" as const,
      properties: {
        id: { type: "string" },
        note: { type: "string" },
      },
      required: ["id"],
    },
  },
  {
    name: "lifeos_set_habit_theme",
    description: "Set emoji, color, graphic for a habit",
    inputSchema: {
      type: "object" as const,
      properties: {
        id: { type: "string" },
        emoji: { type: "string" },
        themeColor: { type: "string" },
        themeGraphic: { type: "string" },
      },
      required: ["id"],
    },
  },
  {
    name: "lifeos_get_today",
    description: "Full dashboard state for today",
    inputSchema: { type: "object" as const, properties: {} },
  },
  {
    name: "lifeos_get_vs_yesterday",
    description: "Today vs yesterday deltas (habits, XP, study, sleep)",
    inputSchema: { type: "object" as const, properties: {} },
  },
  {
    name: "lifeos_get_pulse",
    description: "Improvement Pulse: Improving | Stable | Recovering | Drifting",
    inputSchema: { type: "object" as const, properties: {} },
  },
  {
    name: "lifeos_log_study",
    description: "Log a study session with quality flag (inspired/feynman/retrieval escalate candidates)",
    inputSchema: {
      type: "object" as const,
      properties: {
        title: { type: "string" },
        durationMinutes: { type: "number" },
        qualityFlag: {
          type: "string",
          enum: ["normal", "struggle", "inspired", "feynman", "retrieval"],
        },
        linkedConceptSlug: { type: "string" },
        note: { type: "string" },
      },
      required: ["title"],
    },
  },
  {
    name: "lifeos_inject_quest",
    description: "Inject a daily/weekly quest",
    inputSchema: {
      type: "object" as const,
      properties: {
        title: { type: "string" },
        description: { type: "string" },
        targetCount: { type: "number" },
        xpBonus: { type: "number" },
        forDate: { type: "string" },
      },
      required: ["title"],
    },
  },
  {
    name: "lifeos_update_xp_rules",
    description:
      "Patch gamification config: dailyXpTarget (the fixed daily XP pool), " +
      "growthStyle (sprout|orb), and quality multipliers. Changing dailyXpTarget " +
      "rebalances every habit's baseXp. There are no levels.",
    inputSchema: {
      type: "object" as const,
      properties: {
        dailyXpTarget: { type: "number" },
        growthStyle: { type: "string", enum: ["sprout", "orb"] },
        baseMultipliers: { type: "object" },
      },
    },
  },
  {
    name: "lifeos_get_xp_model",
    description:
      "Explain the XP system: fixed daily pool, weighted redistribution, extraXp " +
      "bonuses, efficiency and improvement maths, plus each habit's current share.",
    inputSchema: { type: "object" as const, properties: {} },
  },
  {
    name: "lifeos_rebalance_xp",
    description:
      "Re-slice dailyXpTarget across active habits by xpWeight. Call after bulk habit edits.",
    inputSchema: { type: "object" as const, properties: {} },
  },
  {
    name: "lifeos_create_achievement",
    description: "Create a new achievement definition",
    inputSchema: {
      type: "object" as const,
      properties: {
        key: { type: "string" },
        title: { type: "string" },
        description: { type: "string" },
        emoji: { type: "string" },
        xpBonus: { type: "number" },
      },
      required: ["key", "title", "description"],
    },
  },
  {
    name: "lifeos_list_achievements",
    description: "List achievements and unlock status",
    inputSchema: { type: "object" as const, properties: {} },
  },
  {
    name: "lifeos_update_settings",
    description:
      "Change ANY instance setting. Every field here is yours to set — day reset time, " +
      "sleep window, quiet hours, theme, celebration intensity, reduced motion, the " +
      "gamification toggles, the agent webhook, and the database backup policy. " +
      "You do not need to ask before tuning these; reshape the instance to fit the user.",
    inputSchema: {
      type: "object" as const,
      properties: {
        gamificationEnabled: { type: "boolean" },
        streaksEnabled: { type: "boolean" },
        pointsEnabled: { type: "boolean" },
        achievementsEnabled: { type: "boolean" },
        questsEnabled: { type: "boolean" },
        celebrationIntensity: {
          type: "string",
          enum: ["full", "minimal", "off"],
        },
        accentTheme: {
          type: "string",
          enum: ["nebula", "quantum", "terminal", "ember"],
        },
        reducedMotion: { type: "boolean" },
        notificationSound: {
          type: "string",
          enum: [...NOTIFICATION_SOUND_IDS],
          description: "Reminder chime; 'none' is visual-only",
        },
        doNotDisturb: {
          type: "boolean",
          description:
            "Silence reminders without hiding them — no sound, flash or system notification",
        },
        quietHoursSilent: {
          type: "boolean",
          description: "Treat quiet hours as an automatic do-not-disturb window",
        },
        plannedWake: { type: "string", description: "HH:mm" },
        plannedSleepStart: { type: "string", description: "HH:mm" },
        plannedSleepEnd: { type: "string", description: "HH:mm" },
        quietHoursStart: { type: "string", description: "HH:mm" },
        quietHoursEnd: { type: "string", description: "HH:mm" },
        dayResetTime: {
          type: "string",
          description: "HH:mm — the life-day boundary, not midnight",
        },
        timezone: {
          type: "string",
          description:
            "IANA name, e.g. Asia/Kolkata. The zone every stored time is meant in. " +
            "Set it if you are not running on the same machine as Life OS — otherwise you " +
            "will schedule in your own zone and disagree with the app about which day a " +
            "completion belongs to. Empty means the server's own zone.",
        },
        agentWebhookUrl: { type: "string" },
        agentWebhookSecret: { type: "string" },
        backupsEnabled: { type: "boolean" },
        backupIntervalHours: { type: "number" },
        backupKeep: { type: "number" },
      },
    },
  },
  {
    name: "lifeos_get_settings",
    description: "Read current settings (every field is writable via lifeos_update_settings)",
    inputSchema: { type: "object" as const, properties: {} },
  },
  {
    name: "lifeos_get_capabilities",
    description:
      "What this instance lets you do: card kinds, the closed set of day activity tags, " +
      "repeat rules, the scheduling ordering rule, and the full tool list.",
    inputSchema: { type: "object" as const, properties: {} },
  },
  {
    name: "lifeos_setup_instance",
    description:
      "Reshape the whole instance in one call: replace or add habits, set the daily XP pool, " +
      "the growth style, wake/sleep/quiet hours, and publish your setup card. " +
      "Use this when you first connect to a fresh clone.",
    inputSchema: {
      type: "object" as const,
      properties: {
        replaceHabits: {
          type: "boolean",
          description: "Delete the seeded habits before adding yours",
        },
        habits: {
          type: "array",
          items: {
            type: "object",
            properties: {
              name: { type: "string" },
              emoji: { type: "string" },
              category: { type: "string" },
              isTiny: { type: "boolean" },
              anchor: { type: "string" },
              xpWeight: { type: "number" },
              themeColor: { type: "string" },
              themeGraphic: {
                type: "string",
                enum: ["ring", "liquid", "tree", "flame", "none"],
              },
            },
            required: ["name"],
          },
        },
        dailyXpTarget: { type: "number" },
        growthStyle: { type: "string", enum: ["sprout", "orb"] },
        settings: { type: "object", description: "Any lifeos_update_settings fields" },
        agentName: { type: "string" },
        agentSetupCard: {
          type: "object",
          properties: {
            title: { type: "string" },
            subtitle: { type: "string" },
            body: { type: "string" },
            svg: { type: "string" },
            themeColor: { type: "string" },
          },
        },
      },
    },
  },
  {
    name: "lifeos_list_properties",
    description:
      "List agent-defined internal properties with their live values and stable uids. " +
      "These are the counters goal conditions read.",
    inputSchema: { type: "object" as const, properties: {} },
  },
  {
    name: "lifeos_define_property",
    description:
      "Define an internal property you will push data into, e.g. {key:'books_read', " +
      "label:'Books finished', kind:'counter'}. Returns a stable uid you can store against " +
      "your own records. Goals then reference it by key.",
    inputSchema: {
      type: "object" as const,
      properties: {
        key: { type: "string", description: "lower_snake_case, e.g. books_read" },
        label: { type: "string" },
        kind: { type: "string", enum: ["counter", "number", "text", "json"] },
        value: { type: "number" },
        textValue: { type: "string" },
        unit: { type: "string" },
        description: { type: "string" },
        createdBy: { type: "string" },
      },
      required: ["key", "label"],
    },
  },
  {
    name: "lifeos_set_property",
    description: "Set a property's value outright (any kind)",
    inputSchema: {
      type: "object" as const,
      properties: {
        key: { type: "string" },
        value: { type: "number" },
        textValue: { type: "string" },
        label: { type: "string" },
        unit: { type: "string" },
        description: { type: "string" },
      },
      required: ["key"],
    },
  },
  {
    name: "lifeos_increment_property",
    description:
      "Add to a counter — the normal way to push data. Auto-defines the property on first use, " +
      "so a forgotten setup call never loses an increment. Any goal watching it is re-checked " +
      "immediately.",
    inputSchema: {
      type: "object" as const,
      properties: { key: { type: "string" }, by: { type: "number" } },
      required: ["key"],
    },
  },
  {
    name: "lifeos_delete_property",
    description: "Delete an internal property by key",
    inputSchema: {
      type: "object" as const,
      properties: { key: { type: "string" } },
      required: ["key"],
    },
  },
  {
    name: "lifeos_get_goal_syntax",
    description:
      "The goal condition language, worked examples, and how to push data into properties. " +
      "Read this before writing your first goal.",
    inputSchema: { type: "object" as const, properties: {} },
  },
  {
    name: "lifeos_list_goals",
    description: "List goals with live progress, condition traces, and celebration state",
    inputSchema: { type: "object" as const, properties: {} },
  },
  {
    name: "lifeos_create_goal",
    description:
      "Set a goal. Goals are YOUR job — the user should not have to decide what to want. " +
      "Give it a machine-checkable condition reading a property you push to, or a built-in " +
      `metric (${GOAL_METRICS.join(" | ")}). The condition is re-checked after every database ` +
      "change. When it comes true the goal is MET but not finished: it only becomes 'achieved' " +
      "after the user has watched the celebration on screen.",
    inputSchema: {
      type: "object" as const,
      properties: {
        title: { type: "string" },
        description: { type: "string" },
        whyItMatters: { type: "string" },
        targetDate: { type: "string" },
        emoji: { type: "string" },
        themeColor: { type: "string" },
        autoCheck: { type: "boolean" },
        condition: {
          type: "object",
          description:
            "e.g. {type:'property', key:'books_read', op:'>=', value:10} or " +
            "{type:'all', of:[...]} — see lifeos_get_goal_syntax",
        },
      },
      required: ["title"],
    },
  },
  {
    name: "lifeos_update_goal",
    description: "Patch a goal by id (title, condition, status, autoCheck…)",
    inputSchema: {
      type: "object" as const,
      properties: {
        id: { type: "string" },
        title: { type: "string" },
        description: { type: "string" },
        status: { type: "string", enum: ["active", "paused", "abandoned"] },
        condition: { type: "object" },
        autoCheck: { type: "boolean" },
      },
      required: ["id"],
    },
  },
  {
    name: "lifeos_delete_goal",
    description: "Delete a goal by id",
    inputSchema: {
      type: "object" as const,
      properties: { id: { type: "string" } },
      required: ["id"],
    },
  },
  {
    name: "lifeos_evaluate_goals",
    description:
      "Force a goal re-check now and return each goal's progress and condition trace. " +
      "Also lists goals waiting for the user to see their celebration.",
    inputSchema: { type: "object" as const, properties: {} },
  },
  {
    name: "lifeos_list_tasks",
    description:
      "Tasks — one of the two nouns, the other being habits. Everything the user has to do is " +
      "one of these: a thing with an optional time, an optional repeat, optional XP, optional " +
      "links, and an optional card presentation. " +
      "scope defaults to `all`, which includes tasks hidden behind a future showAt — those are " +
      "stored and correct but no client displays them yet, and leaving them out is what made " +
      "created tasks look like they had vanished. Use scope `visible` for what a client is " +
      "showing right now.",
    inputSchema: {
      type: "object" as const,
      properties: {
        status: { type: "string", enum: ["active", "done", "dismissed"] },
        kind: { type: "string", enum: ["task", "study", "review", "reminder"] },
        scope: {
          type: "string",
          enum: ["all", "visible"],
          description:
            "all = everything stored, including not-yet-shown. visible = only what a client would display now. Default all.",
        },
      },
    },
  },
  {
    name: "lifeos_get_workload",
    description:
      "Open work, split by the question it answers, instead of one flat list. " +
      "`due` is what should be happening now; `upcoming` has a time and is still ahead; " +
      "`missed` had a time that went past; `backlog` is open work with **no time on it at all** — " +
      "inventory, not today's plan; `hidden` is stored but behind a future showAt. " +
      "Use this rather than lifeos_list_tasks when deciding what to tell the user to do: an " +
      "untimed catalogue (imported reviews, a reading list) is not a day's workload, and reading " +
      "it as one is how 'today' grows to seventeen things that are not due.",
    inputSchema: {
      type: "object" as const,
      properties: {
        horizonDays: {
          type: "number",
          description: "How far ahead `upcoming` reaches. Default 7.",
        },
      },
    },
  },
  {
    name: "lifeos_bulk_dismiss_tasks",
    description:
      "Dismiss many tasks at once, for cleaning up after an import or a migration that left " +
      "duplicates. **Dry run by default** — it returns exactly what it would touch and changes " +
      "nothing until you pass confirm:true. Dismissed rather than deleted, so the rows survive " +
      "and the user's history stays intact. Take a backup first with lifeos_backup_now.",
    inputSchema: {
      type: "object" as const,
      properties: {
        status: { type: "string", enum: ["active", "done", "dismissed"] },
        kind: { type: "string", enum: ["task", "study", "review", "reminder"] },
        createdBefore: { type: "string", description: "ISO instant." },
        untimedOnly: {
          type: "boolean",
          description: "Only tasks with no eventAt — the usual shape of migration leftovers.",
        },
        titleContains: { type: "string" },
        confirm: {
          type: "boolean",
          description: "false or absent = dry run. true = actually dismiss them.",
        },
      },
    },
  },
  {
    name: "lifeos_current_tasks",
    description:
      "What is on the user's plate right now: inside the notification lead window and not past " +
      "its own end time. This is what the dashboard shows above the habits.",
    inputSchema: { type: "object" as const, properties: {} },
  },
  {
    name: "lifeos_due_tasks",
    description: "Tasks whose notification should fire now and has not yet",
    inputSchema: { type: "object" as const, properties: {} },
  },
  {
    name: "lifeos_create_task",
    description:
      "Create a task. There is no start — a task has a target time and a completion. " +
      "Set eventAt for when it should happen and durationMinutes for how long it takes " +
      "(without a duration it leaves the front page the moment its time passes). " +
      "repeatRule daily|weekly|spaced makes Life OS schedule it again on completion, so you " +
      "do not have to recreate recurring work every night. resources[] carries links — that is " +
      "all a study block ever was. control adds a slider or button that asks the user something " +
      "without completing the task.",
    inputSchema: {
      type: "object" as const,
      properties: {
        kind: { type: "string", enum: ["task", "study", "review", "reminder"] },
        title: { type: "string" },
        subtitle: { type: "string" },
        body: { type: "string" },
        purpose: { type: "string" },
        activityTag: { type: "string", enum: [...ACTIVITIES] },
        showAt: { type: "string" },
        eventAt: { type: "string" },
        remindAt: { type: "string" },
        durationMinutes: { type: "number" },
        repeatRule: { type: "string", enum: [...REPEAT_RULES] },
        repeatOffsetsDays: { type: "array", items: { type: "number" } },
        xpOnComplete: { type: "number" },
        webhookOnComplete: { type: "boolean" },
        webhookOnInteract: { type: "boolean" },
        resources: {
          type: "array",
          items: {
            type: "object",
            properties: {
              label: { type: "string" },
              url: { type: "string" },
              kind: { type: "string" },
            },
            required: ["label", "url"],
          },
        },
        slot: { type: "number", enum: [0, 1] },
        emoji: { type: "string" },
        themeColor: { type: "string" },
        imageUrl: { type: "string" },
        svg: { type: "string" },
        ctaLabel: { type: "string" },
        ctaLink: { type: "string" },
        control: { type: "object" },
        meta: { type: "object" },
      },
      required: ["title"],
    },
  },
  {
    name: "lifeos_update_task",
    description: "Patch a task. Moving its time re-arms the notification.",
    inputSchema: {
      type: "object" as const,
      properties: {
        id: { type: "string" },
        title: { type: "string" },
        body: { type: "string" },
        status: { type: "string", enum: ["active", "done", "dismissed"] },
        eventAt: { type: "string" },
        durationMinutes: { type: "number" },
        activityTag: { type: "string", enum: [...ACTIVITIES] },
        xpOnComplete: { type: "number" },
        resources: { type: "array", items: { type: "object" } },
        slot: { type: "number" },
      },
      required: ["id"],
    },
  },
  {
    name: "lifeos_complete_task",
    description:
      "Complete a task on the user's behalf. Awards XP, fires your webhook if you subscribed, " +
      "and spawns the next occurrence if it repeats.",
    inputSchema: {
      type: "object" as const,
      properties: { id: { type: "string" }, note: { type: "string" } },
      required: ["id"],
    },
  },
  {
    name: "lifeos_dismiss_task",
    description: "Put a task away without doing it. Distinct from done; stays in history.",
    inputSchema: {
      type: "object" as const,
      properties: { id: { type: "string" } },
      required: ["id"],
    },
  },
  {
    name: "lifeos_delete_task",
    description: "Remove a task entirely. Prefer dismiss — deleting loses the record.",
    inputSchema: {
      type: "object" as const,
      properties: { id: { type: "string" } },
      required: ["id"],
    },
  },
  {
    name: "lifeos_mark_task_notified",
    description: "Record that a notification fired, so it fires once. Clients normally do this.",
    inputSchema: {
      type: "object" as const,
      properties: { id: { type: "string" } },
      required: ["id"],
    },
  },
  {
    name: "lifeos_list_webhook_targets",
    description:
      "Where Life OS delivers completions. Secrets are never returned — only whether one is set.",
    inputSchema: { type: "object" as const, properties: {} },
  },
  {
    name: "lifeos_add_webhook_target",
    description:
      "Subscribe yourself to completions. preset 'hermes' signs an HMAC over <timestamp>.<body> " +
      "(X-Webhook-Signature-V2) and needs your route secret; preset 'openclaw' sends a bearer " +
      "token to /hooks/wake and needs hooks.token; 'generic' sends X-LifeOS-Secret. Omit `events` " +
      "to receive everything. Every delivery carries X-Request-ID so retries are safe to dedupe.",
    inputSchema: {
      type: "object" as const,
      properties: {
        name: { type: "string" },
        url: { type: "string" },
        preset: { type: "string", enum: ["hermes", "openclaw", "generic"] },
        secret: { type: "string" },
        events: {
          type: "array",
          items: { type: "string", enum: [...WEBHOOK_EVENTS] },
        },
      },
      required: ["name", "url"],
    },
  },
  {
    name: "lifeos_update_webhook_target",
    description: "Change a target's url, secret, subscribed events, or active flag",
    inputSchema: {
      type: "object" as const,
      properties: {
        id: { type: "string" },
        name: { type: "string" },
        url: { type: "string" },
        preset: { type: "string", enum: ["hermes", "openclaw", "generic"] },
        secret: { type: "string" },
        events: { type: "array", items: { type: "string" } },
        active: { type: "boolean" },
      },
      required: ["id"],
    },
  },
  {
    name: "lifeos_delete_webhook_target",
    description: "Stop delivering to a target",
    inputSchema: {
      type: "object" as const,
      properties: { id: { type: "string" } },
      required: ["id"],
    },
  },
  {
    name: "lifeos_test_webhook_target",
    description:
      "Send a throwaway event, so you find out a target works before relying on it for a real completion",
    inputSchema: {
      type: "object" as const,
      properties: { id: { type: "string" } },
      required: ["id"],
    },
  },
  {
    name: "lifeos_list_webhook_deliveries",
    description:
      "Recent delivery attempts with status and error — use this to find out whether you actually heard about something",
    inputSchema: {
      type: "object" as const,
      properties: { limit: { type: "number" } },
    },
  },
  {
    name: "lifeos_backup_now",
    description: "Snapshot the SQLite database into data/backups/ and prune old snapshots",
    inputSchema: { type: "object" as const, properties: {} },
  },
  {
    name: "lifeos_list_backups",
    description: "List database snapshots, newest first",
    inputSchema: { type: "object" as const, properties: {} },
  },
  {
    name: "lifeos_export_json",
    description: "Full JSON export of every table — useful before a risky restructure",
    inputSchema: { type: "object" as const, properties: {} },
  },
];

/**
 * Today's life-day key.
 *
 * This said it was the life-day and returned the calendar date. They differ for
 * the hours between midnight and `dayResetTime` — which is precisely when a
 * night owl is still working, and precisely when an evening check-in runs. An
 * agent asking "how did today go" at 01:00 was handed the key for a day that
 * had barely started, and reported an empty one.
 */
function todayKey(db: LifeOsDb): string {
  return currentLifeDay(db).lifeDay;
}

async function handleTool(name: string, args: Record<string, unknown>) {
  const db = getDb();
  switch (name) {
    /* ---- agent-shaped ------------------------------------------------ */
    case "lifeos_get_day":
      return getDaySummary(db, args.date ? String(args.date) : todayKey(db));
    case "lifeos_get_range":
      return getRangeSummary(
        db,
        args.to ? String(args.to) : todayKey(db),
        args.days === undefined ? 7 : Number(args.days),
      );
    case "lifeos_search_history":
      return searchHistory(
        db,
        String(args.query ?? ""),
        args.limit === undefined ? 25 : Number(args.limit),
      );
    case "lifeos_bulk_create_tasks": {
      const input = Array.isArray(args.tasks) ? args.tasks : [];
      const created: unknown[] = [];
      const rejected: { index: number; error: string }[] = [];
      let hidden = 0;
      input.forEach((entry, index) => {
        const result = createTask(db, entry as any);
        // Report each failure with its index rather than throwing: one bad
        // entry in a week's schedule must not discard the other thirty.
        if ("error" in result) {
          rejected.push({ index, error: result.error });
          return;
        }
        const withState = withVisibility(result.task);
        if (withState.visibility.state === "hidden_until_show_at") hidden++;
        created.push(withState);
      });
      /*
       * `hidden` is called out because this is the call that schedules a week
       * ahead, and most of what it writes is deliberately not visible yet. An
       * agent that lists tasks afterwards and finds four of thirty is looking
       * at a working showAt, not a failed write.
       */
      return {
        created: created.length,
        hiddenUntilShowAt: hidden,
        rejected,
        tasks: created,
        ...(hidden
          ? {
              note: `${hidden} of these are behind a future showAt and will not appear in task lists or on any client until then. That is the showAt working.`,
            }
          : {}),
      };
    }

    case "lifeos_list_habits":
      return listHabits(db);
    case "lifeos_create_habit":
      return createHabit(db, args as any);
    case "lifeos_update_habit": {
      const { id, ...rest } = args as { id: string } & Record<string, unknown>;
      return updateHabit(db, id, rest as any);
    }
    case "lifeos_delete_habit":
      return { ok: deleteHabit(db, String(args.id)) };
    case "lifeos_complete_habit":
      return completeHabit(db, String(args.id), {
        note: args.note as string | undefined,
        source: "agent",
      });
    case "lifeos_set_habit_theme": {
      const { id, ...theme } = args as { id: string } & Record<string, unknown>;
      return setHabitTheme(db, id, theme as any);
    }
    case "lifeos_get_today":
      return getDashboard(db);
    case "lifeos_get_vs_yesterday":
      return getVsYesterday(db);
    case "lifeos_get_pulse":
      return getPulse(db);
    case "lifeos_log_study":
      return createStudySession(db, {
        ...(args as any),
        source: "agent",
      });
    case "lifeos_inject_quest":
      return injectQuest(db, args as any);
    case "lifeos_update_xp_rules":
      return updateGamificationConfig(db, args as any);
    case "lifeos_get_xp_model": {
      const config = getGamificationConfig(db);
      const active = listHabits(db);
      return {
        ...XP_MODEL_DOC,
        current: {
          dailyXpTarget: config.dailyXpTarget,
          baseMultipliers: config.baseMultipliers,
          growthStyle: config.growthStyle,
          activeHabitCount: active.length,
          totalWeight: active.reduce((a, h) => a + (h.xpWeight || 1), 0),
          shares: active.map((h) => ({
            id: h.id,
            name: h.name,
            xpWeight: h.xpWeight,
            baseXp: h.baseXp,
            extraXp: h.extraXp,
          })),
        },
      };
    }
    case "lifeos_rebalance_xp":
      return { shares: rebalanceHabitXp(db) };
    case "lifeos_create_achievement":
      return createAchievement(db, args as any);
    case "lifeos_list_achievements":
      return listAchievements(db);
    case "lifeos_update_settings":
      return updateSettings(db, args as any);
    case "lifeos_get_settings":
      return getSettings(db);

    case "lifeos_get_capabilities":
      return {
        name: "Life OS",
        version: "0.6.0",
        maxPinnedTasks: 2,
        taskKinds: TASK_KINDS,
        activityTags: ACTIVITIES,
        repeatRules: REPEAT_RULES,
        scheduleRule: "showAt <= remindAt < eventAt",
        settings:
          "Every field of lifeos_get_settings is writable via lifeos_update_settings.",
        goals:
          "Goals are agent-set. Write a condition, push data into properties, and the " +
          "system re-checks after every database change. See lifeos_get_goal_syntax.",
        tools: tools.map((t) => t.name),
      };
    case "lifeos_setup_instance":
      return runInitialSetup(db, args as any);



    case "lifeos_list_properties":
      return listProperties(db);
    case "lifeos_define_property": {
      const result = createProperty(db, args as any);
      if ("error" in result) throw new Error(result.error);
      return result.property;
    }
    case "lifeos_set_property": {
      const { key, ...rest } = args as { key: string } & Record<string, unknown>;
      const prop = updateProperty(db, key, rest as any);
      if (!prop) throw new Error(`Unknown property: ${key}`);
      return prop;
    }
    case "lifeos_increment_property": {
      const result = incrementProperty(
        db,
        String(args.key),
        typeof args.by === "number" ? args.by : 1,
        "mcp",
      );
      if ("error" in result) throw new Error(result.error);
      return result;
    }
    case "lifeos_delete_property":
      return deleteProperty(db, String(args.key));

    case "lifeos_get_goal_syntax":
      return { ...GOAL_CONDITION_SYNTAX, liveProperties: listProperties(db) };
    case "lifeos_list_goals":
      return listGoals(db);
    case "lifeos_create_goal": {
      const result = createGoal(db, args as any);
      if ("error" in result) throw new Error(result.error);
      return result.goal;
    }
    case "lifeos_update_goal": {
      const { id, ...rest } = args as { id: string } & Record<string, unknown>;
      const result = updateGoal(db, id, rest as any);
      if (!result) throw new Error(`Goal not found: ${id}`);
      if ("error" in result) throw new Error(result.error);
      return result;
    }
    case "lifeos_delete_goal":
      return deleteGoal(db, String(args.id));
    case "lifeos_evaluate_goals":
      return {
        evaluated: evaluateGoals(db),
        // Met but unwitnessed: the user still has to see the animation.
        awaitingCelebration: pendingCelebrations(db),
      };

    case "lifeos_list_tasks": {
      /*
       * This used to force `visibleOnly: true` with no way to turn it off, so a
       * task created with a future showAt was written and then absent from
       * every read an agent could make. The write looked like it had failed,
       * and the honest response to that is to write it again.
       */
      const scope = args.scope === "visible" ? "visible" : "all";
      const rows = listTasks(db, {
        status: args.status as never,
        kind: args.kind as never,
        visibleOnly: scope === "visible",
      });
      return scope === "visible"
        ? rows
        : rows.map((task) => withVisibility(task));
    }
    case "lifeos_get_workload":
      return getWorkload(db, {
        horizonDays:
          args.horizonDays === undefined ? 7 : Number(args.horizonDays),
      });
    case "lifeos_bulk_dismiss_tasks": {
      const filter = {
        status: args.status as never,
        kind: args.kind as never,
        createdBefore: args.createdBefore as string | undefined,
        untimedOnly: Boolean(args.untimedOnly),
        titleContains: args.titleContains as string | undefined,
      };
      const matched = selectForCleanup(db, filter);
      const summary = matched.map((t) => ({
        id: t.id,
        title: t.title,
        kind: t.kind,
        eventAt: t.eventAt,
        createdAt: t.createdAt,
      }));

      // Nothing is touched without confirm. A cleanup that guesses wrong takes
      // out real work, and the agent cannot see what it is about to hit.
      if (args.confirm !== true) {
        return {
          dryRun: true,
          wouldDismiss: matched.length,
          tasks: summary,
          note: "Nothing was changed. Check this list, take a backup with lifeos_backup_now, then call again with confirm:true.",
        };
      }

      const failed: { id: string; error: string }[] = [];
      for (const task of matched) {
        const result = dismissTask(db, task.id);
        if ("error" in result) {
          failed.push({ id: task.id, error: String(result.error) });
        }
      }
      return {
        dryRun: false,
        dismissed: matched.length - failed.length,
        failed,
        tasks: summary,
      };
    }
    case "lifeos_current_tasks":
      return listCurrentTasks(db);
    case "lifeos_due_tasks":
      return listDueTasks(db);
    case "lifeos_create_task": {
      const result = createTask(db, args as never);
      if ("error" in result) throw new Error(result.error);
      /*
       * With the visibility attached, because the next thing an agent does is
       * list tasks to check the write landed — and if this one is hidden behind
       * a showAt it will not be there.
       */
      return withVisibility(result.task);
    }
    case "lifeos_update_task": {
      const { id, ...patch } = args as { id: string };
      const result = updateTask(db, id, patch as never);
      if ("error" in result) throw new Error(result.error);
      return result.task;
    }
    case "lifeos_complete_task": {
      const result = await completeTask(db, String(args.id), {
        note: (args.note as string) ?? null,
        source: "agent",
      });
      if ("error" in result) throw new Error(result.error);
      return result;
    }
    case "lifeos_dismiss_task": {
      const result = dismissTask(db, String(args.id));
      if ("error" in result) throw new Error(result.error);
      return result;
    }
    case "lifeos_delete_task":
      return deleteTask(db, String(args.id));
    case "lifeos_mark_task_notified": {
      const result = markTaskNotified(db, String(args.id));
      if ("error" in result) throw new Error(result.error);
      return result;
    }

    case "lifeos_list_webhook_targets":
      return listWebhookTargets(db);
    case "lifeos_add_webhook_target": {
      const result = createWebhookTarget(db, args as never);
      if ("error" in result) throw new Error(result.error);
      return result;
    }
    case "lifeos_update_webhook_target": {
      const { id, ...patch } = args as { id: string };
      const result = updateWebhookTarget(db, id, patch as never);
      if ("error" in result) throw new Error(result.error);
      return result;
    }
    case "lifeos_delete_webhook_target":
      return deleteWebhookTarget(db, String(args.id));
    case "lifeos_test_webhook_target": {
      const result = await testWebhookTarget(db, String(args.id));
      // A missing target is a caller error and throws; a target that exists but
      // rejected the delivery is a *result* — that is exactly what was asked.
      if (!("ok" in result)) throw new Error(result.error);
      return result;
    }
    case "lifeos_list_webhook_deliveries": {
      const raw = Number(args.limit ?? 50);
      const limit = Number.isFinite(raw) ? Math.min(200, Math.max(1, raw)) : 50;
      return listWebhookDeliveries(db, limit);
    }

    case "lifeos_backup_now": {
      const result = runBackup(db, { force: true });
      if (!result.ok) throw new Error(result.error);
      return result;
    }
    case "lifeos_list_backups":
      return listDatabaseBackups();
    case "lifeos_export_json":
      return exportAll(db);

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

/** Tools that only read — everything else triggers a goal re-check. */
const READ_ONLY_TOOLS = new Set([
  "lifeos_list_habits",
  "lifeos_get_today",
  "lifeos_get_vs_yesterday",
  "lifeos_get_pulse",
  "lifeos_get_xp_model",
  "lifeos_get_capabilities",
  "lifeos_get_settings",
  "lifeos_get_goal_syntax",
  "lifeos_list_cards",
  "lifeos_list_upcoming_cards",
  "lifeos_list_due_reminders",
  "lifeos_list_blocks",
  "lifeos_list_events",
  "lifeos_list_achievements",
  "lifeos_list_properties",
  "lifeos_list_goals",
  "lifeos_list_backups",
  "lifeos_export_json",
  "lifeos_get_day",
  "lifeos_get_range",
  "lifeos_search_history",
  "lifeos_get_workload",
]);

/**
 * A fresh server per caller.
 *
 * Stateless HTTP builds one of these per request, so this must not close over
 * anything that outlives a call. The tool table above is immutable and shared;
 * everything else is derived from the database at dispatch time.
 */
export function createMcpServer(): Server {
  const server = new Server(
    { name: "life-os", version: MCP_SERVER_VERSION },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    try {
      const result = await handleTool(name, (args ?? {}) as Record<string, unknown>);

      // Same contract as the HTTP API: any change to the database re-checks every
      // goal, so a goal fires the moment the thing that completes it is recorded.
      let celebrationsPending: ReturnType<typeof pendingCelebrations> = [];
      if (!READ_ONLY_TOOLS.has(name)) {
        try {
          const db = getDb();
          evaluateGoals(db);
          celebrationsPending = pendingCelebrations(db);
        } catch (error) {
          console.error("[goals] evaluation failed:", error);
        }
      }

      const payload = celebrationsPending.length
        ? {
            result,
            goalsAwaitingCelebration: celebrationsPending.map((g) => ({
              id: g.id,
              title: g.title,
              conditionMetAt: g.conditionMetAt,
              note: "Met — waiting for the user to see the animation on the dashboard.",
            })),
          }
        : result;

      return {
        content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }],
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        content: [{ type: "text" as const, text: `Error: ${message}` }],
        isError: true,
      };
    }
  });

  return server;
}
