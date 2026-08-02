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
  getCard,
  createCard,
  updateCard,
  deleteCard,
  completeCard,
} from "../../../apps/api/src/services/cards.js";
import {
  listBlocks,
  createBlock,
  updateBlock,
  deleteBlock,
} from "../../../apps/api/src/services/blocks.js";
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
} from "../../../apps/api/src/services/settings.js";
import { listAchievements, createAchievement } from "../../../apps/api/src/services/achievements.js";
import { localDateString, XP_MODEL_DOC } from "@life-os/shared";

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
      "Create or replace a front-page card. slot 0/1 are content cards; " +
      "kind:'agent-setup' targets the reserved slot 2. `svg` accepts inline SVG " +
      "markup (sanitized, rendered sandboxed) for custom graphics.",
    inputSchema: {
      type: "object" as const,
      properties: {
        slot: { type: "number", enum: [0, 1, 2] },
        kind: { type: "string", enum: ["task", "agent-setup"] },
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
    description: "Update quiet hours, gamification toggles, theme, storage mode",
    inputSchema: {
      type: "object" as const,
      properties: {
        gamificationEnabled: { type: "boolean" },
        quietHoursStart: { type: "string" },
        quietHoursEnd: { type: "string" },
        plannedWake: { type: "string" },
        celebrationIntensity: {
          type: "string",
          enum: ["full", "minimal", "off"],
        },
        accentTheme: {
          type: "string",
          enum: ["nebula", "quantum", "terminal", "ember"],
        },
      },
    },
  },
  {
    name: "lifeos_get_settings",
    description: "Read current settings",
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
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

const server = new Server(
  { name: "life-os", version: "0.3.0" },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  try {
    const result = await handleTool(name, (args ?? {}) as Record<string, unknown>);
    return {
      content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
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
