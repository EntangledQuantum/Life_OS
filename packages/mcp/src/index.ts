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

import { listHabits, createHabit, updateHabit, deleteHabit, completeHabit, setHabitTheme } from "../../../apps/api/src/services/habits.js";
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
import { localDateString } from "@life-os/shared";

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
    description: "Patch live gamification multipliers / level curve",
    inputSchema: {
      type: "object" as const,
      properties: {
        levelBase: { type: "number" },
        levelExponent: { type: "number" },
        baseMultipliers: { type: "object" },
      },
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
  { name: "life-os", version: "0.1.0" },
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
