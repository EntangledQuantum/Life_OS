#!/usr/bin/env node
/**
 * Life OS MCP server — stdio transport for Hermes / OpenClaw / any MCP client.
 * Shares the same SQLite DB as the HTTP API.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { getDb } from "@life-os/db";
import { z } from "zod";

// Load root .env
config({
  path: path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../.env"),
});

// Import services from API package via relative path is fragile in monorepo;
// re-implement thin wrappers by importing from api source is better — use dynamic imports of service modules.
// For reliability, duplicate call surface by importing db + inlined service functions from api.

import { listHabits, createHabit, updateHabit, deleteHabit, completeHabit, setHabitTheme, rebalanceHabitXp } from "../../../apps/api/src/services/habits.js";
import {
  listCards,
  listUpcomingCards,
  listDueReminders,
  getCard,
  createCard,
  updateCard,
  deleteCard,
  completeCard,
  markCardNotified,
} from "../../../apps/api/src/services/cards.js";
import {
  listBlocks,
  createBlock,
  updateBlock,
  deleteBlock,
  completeBlock,
} from "../../../apps/api/src/services/blocks.js";
import {
  listGoals,
  createGoal,
  updateGoal,
  deleteGoal,
  evaluateGoals,
  pendingCelebrations,
} from "../../../apps/api/src/services/goals.js";
import {
  listProperties,
  getProperty,
  createProperty,
  updateProperty,
  incrementProperty,
  deleteProperty,
} from "../../../apps/api/src/services/properties.js";
import { runInitialSetup } from "../../../apps/api/src/services/setup.js";
import {
  listDatabaseBackups,
  runBackup,
} from "../../../apps/api/src/services/backups.js";
import {
  listAgentEvents,
  injectAgentEvent,
} from "../../../apps/api/src/services/events.js";
import { createStudySession } from "../../../apps/api/src/services/study.js";
import { getDashboard } from "../../../apps/api/src/services/dashboard.js";
import { getVsYesterday, getPulse } from "../../../apps/api/src/services/snapshots.js";
import { injectQuest, injectLightReview, listQuests, listLightReviews } from "../../../apps/api/src/services/quests.js";
import {
  getSettings,
  updateSettings,
  getGamificationConfig,
  updateGamificationConfig,
  exportAll,
} from "../../../apps/api/src/services/settings.js";
import { listAchievements, createAchievement } from "../../../apps/api/src/services/achievements.js";
import {
  ACTIVITIES,
  CARD_KINDS,
  GOAL_CONDITION_SYNTAX,
  GOAL_METRICS,
  NOTIFICATION_SOUND_IDS,
  REPEAT_RULES,
  localDateString,
  XP_MODEL_DOC,
} from "@life-os/shared";

const db = getDb();

const tools = [
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
    name: "lifeos_inject_light_review",
    description: "Inject a light review prompt for a date (default today)",
    inputSchema: {
      type: "object" as const,
      properties: {
        prompt: { type: "string" },
        forDate: { type: "string" },
      },
      required: ["prompt"],
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
    name: "lifeos_list_cards",
    description: "List front-page cards (2 content slots + the agent-setup card in slot 2)",
    inputSchema: { type: "object" as const, properties: {} },
  },
  {
    name: "lifeos_upsert_card",
    description:
      "Create or replace a pinned front-page card. slot 0/1 are the two content cards; " +
      "kind:'agent-setup' targets the reserved slot 2. `svg` accepts inline SVG " +
      "markup (sanitized, rendered sandboxed) for custom graphics. " +
      "For anything with a time on it use lifeos_schedule_card instead — scheduled cards " +
      "are unpinned and never eat one of the two precious front-page slots.",
    inputSchema: {
      type: "object" as const,
      properties: {
        slot: { type: "number", enum: [0, 1, 2] },
        kind: { type: "string", enum: [...CARD_KINDS] },
        purpose: { type: "string" },
        activityTag: { type: "string", enum: [...ACTIVITIES] },
        title: { type: "string" },
        subtitle: { type: "string" },
        body: { type: "string" },
        emoji: { type: "string" },
        themeColor: { type: "string" },
        imageUrl: { type: "string" },
        svg: { type: "string" },
        progress: { type: "number" },
        ctaLabel: { type: "string" },
        ctaLink: { type: "string" },
        meta: { type: "object" },
        xpOnComplete: { type: "number" },
        webhookOnComplete: { type: "boolean" },
      },
      required: ["title"],
    },
  },
  {
    name: "lifeos_update_card",
    description: "Patch an existing card by id (progress, body, svg, status…)",
    inputSchema: {
      type: "object" as const,
      properties: {
        id: { type: "string" },
        title: { type: "string" },
        subtitle: { type: "string" },
        body: { type: "string" },
        svg: { type: "string" },
        progress: { type: "number" },
        status: { type: "string", enum: ["active", "done", "hidden"] },
        meta: { type: "object" },
      },
      required: ["id"],
    },
  },
  {
    name: "lifeos_delete_card",
    description: "Delete a front-page card by id",
    inputSchema: {
      type: "object" as const,
      properties: { id: { type: "string" } },
      required: ["id"],
    },
  },
  {
    name: "lifeos_complete_card",
    description: "Mark a card complete (awards xpOnComplete and fires the webhook)",
    inputSchema: {
      type: "object" as const,
      properties: { id: { type: "string" }, note: { type: "string" } },
      required: ["id"],
    },
  },
  {
    name: "lifeos_list_blocks",
    description: "List today's schedule blocks on the day timeline",
    inputSchema: { type: "object" as const, properties: {} },
  },
  {
    name: "lifeos_create_block",
    description:
      "Add a timeline block (agent owns the schedule; the user starts/completes it)",
    inputSchema: {
      type: "object" as const,
      properties: {
        category: { type: "string" },
        label: { type: "string" },
        plannedStart: { type: "string" },
        plannedEnd: { type: "string" },
        notes: { type: "string" },
        date: { type: "string" },
      },
      required: ["label"],
    },
  },
  {
    name: "lifeos_update_block",
    description: "Patch a schedule block by id",
    inputSchema: {
      type: "object" as const,
      properties: {
        id: { type: "string" },
        label: { type: "string" },
        category: { type: "string" },
        plannedStart: { type: "string" },
        plannedEnd: { type: "string" },
        status: {
          type: "string",
          enum: ["planned", "active", "done", "skipped"],
        },
      },
      required: ["id"],
    },
  },
  {
    name: "lifeos_delete_block",
    description: "Delete a schedule block by id",
    inputSchema: {
      type: "object" as const,
      properties: { id: { type: "string" } },
      required: ["id"],
    },
  },
  {
    name: "lifeos_list_events",
    description: "List today's agent events in the Quick log queue",
    inputSchema: { type: "object" as const, properties: {} },
  },
  {
    name: "lifeos_inject_event",
    description:
      "Push a task/review/reminder into Quick log. It flashes until the user " +
      "completes it, and awards xpOnComplete as bonus XP outside the habit pool.",
    inputSchema: {
      type: "object" as const,
      properties: {
        kind: {
          type: "string",
          enum: ["review", "task", "life", "study", "reminder", "other"],
        },
        title: { type: "string" },
        body: { type: "string" },
        link: { type: "string" },
        priority: { type: "number" },
        xpOnComplete: { type: "number" },
      },
      required: ["title"],
    },
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
    name: "lifeos_schedule_card",
    description:
      "Schedule an event or reminder card. RULE: showAt <= remindAt < eventAt — the user must be " +
      "told about a thing before the thing, so a reminder at or after its own event is rejected. " +
      `Tag it with one of ${ACTIVITIES.join(" | ")}; starting the card takes over the day ` +
      "timeline under that tag. repeatRule 'spaced' walks an expanding ladder (1/3/7/14/30/60 " +
      "days by default) on each completion — that is how you build spaced repetition.",
    inputSchema: {
      type: "object" as const,
      properties: {
        kind: { type: "string", enum: ["event", "reminder"] },
        title: { type: "string" },
        purpose: {
          type: "string",
          description: "What this card is for, in your own words",
        },
        activityTag: { type: "string", enum: [...ACTIVITIES] },
        showAt: { type: "string", description: "ISO 8601 — card appears" },
        remindAt: { type: "string", description: "ISO 8601 — chime fires" },
        eventAt: { type: "string", description: "ISO 8601 — the thing happens" },
        durationMinutes: { type: "number" },
        repeatRule: { type: "string", enum: [...REPEAT_RULES] },
        repeatOffsetsDays: { type: "array", items: { type: "number" } },
        sound: { type: "boolean" },
        flash: { type: "boolean" },
        subtitle: { type: "string" },
        body: { type: "string" },
        emoji: { type: "string" },
        themeColor: { type: "string" },
        svg: { type: "string" },
        meta: { type: "object" },
        xpOnComplete: { type: "number" },
      },
      required: ["title"],
    },
  },
  {
    name: "lifeos_list_upcoming_cards",
    description: "Scheduled event/reminder cards currently on screen, soonest first",
    inputSchema: { type: "object" as const, properties: {} },
  },
  {
    name: "lifeos_list_due_reminders",
    description: "Reminders whose time has passed and which have not chimed yet",
    inputSchema: { type: "object" as const, properties: {} },
  },
  {
    name: "lifeos_mark_card_notified",
    description: "Record that a reminder has chimed, so it fires only once",
    inputSchema: {
      type: "object" as const,
      properties: { id: { type: "string" } },
      required: ["id"],
    },
  },
  {
    name: "lifeos_complete_block",
    description: "Complete a timeline block (study blocks also log a study session)",
    inputSchema: {
      type: "object" as const,
      properties: { id: { type: "string" } },
      required: ["id"],
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

async function handleTool(name: string, args: Record<string, unknown>) {
  switch (name) {
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
    case "lifeos_inject_light_review":
      return injectLightReview(db, {
        prompt: String(args.prompt),
        forDate: String(args.forDate || localDateString()),
      });
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
    case "lifeos_list_cards":
      return listCards(db);
    case "lifeos_upsert_card":
      return createCard(db, args as any);
    case "lifeos_update_card": {
      const { id, ...rest } = args as { id: string } & Record<string, unknown>;
      const result = updateCard(db, id, rest as any);
      if (!result) throw new Error(`Card not found: ${id}`);
      if ("error" in result) throw new Error(result.error);
      return result;
    }
    case "lifeos_delete_card":
      return deleteCard(db, String(args.id));
    case "lifeos_complete_card":
      return completeCard(db, String(args.id), {
        note: args.note as string | undefined,
        source: "agent",
      });
    case "lifeos_list_blocks":
      return listBlocks(db);
    case "lifeos_create_block":
      return createBlock(db, { source: "agent", ...(args as any) });
    case "lifeos_update_block": {
      const { id, ...rest } = args as { id: string } & Record<string, unknown>;
      const block = updateBlock(db, id, rest as any);
      if (!block) throw new Error(`Block not found: ${id}`);
      return block;
    }
    case "lifeos_delete_block":
      return deleteBlock(db, String(args.id));
    case "lifeos_list_events":
      return listAgentEvents(db);
    case "lifeos_inject_event":
      return injectAgentEvent(db, args as any);
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
        version: "0.4.0",
        maxPinnedCards: 2,
        cardKinds: CARD_KINDS,
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

    case "lifeos_schedule_card": {
      const kind =
        args.kind === "reminder" || args.kind === "event"
          ? args.kind
          : args.durationMinutes
            ? "event"
            : "reminder";
      const result = createCard(db, { ...(args as any), kind });
      if ("error" in result) throw new Error(result.error);
      return result;
    }
    case "lifeos_list_upcoming_cards":
      return listUpcomingCards(db);
    case "lifeos_list_due_reminders":
      return listDueReminders(db);
    case "lifeos_mark_card_notified": {
      const result = markCardNotified(db, String(args.id));
      if ("error" in result) throw new Error(result.error);
      return result;
    }

    case "lifeos_complete_block": {
      const result = completeBlock(db, String(args.id));
      if ("error" in result) throw new Error(result.error);
      return result;
    }

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
]);

const server = new Server(
  { name: "life-os", version: "0.4.0" },
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

// silence unused z import for future schema validation
void z;

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Life OS MCP server running on stdio");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
