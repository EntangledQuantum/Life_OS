/**
 * Docs shipped on GitHub Pages. Raw markdown is imported from the repo
 * `docs/` folder at build time — the files stay the source of truth.
 */
import lifeOs from "@docs/LIFE_OS.md?raw";
import setup from "@docs/AGENT_SETUP.md?raw";
import api from "@docs/API.md?raw";
import network from "@docs/NETWORK.md?raw";
import database from "@docs/DATABASE.md?raw";
import skill from "@docs/skills/life-os/SKILL.md?raw";
import hooks from "@docs/AGENT_HOOKS.md?raw";
import log from "@docs/development_log.md?raw";

export type DocGroup = "Start" | "API" | "Agent" | "Project";

export type DocPage = {
  slug: string;
  title: string;
  group: DocGroup;
  file: string;
  description: string;
  markdown: string;
};

export const DOCS: DocPage[] = [
  {
    slug: "overview",
    title: "Overview",
    group: "Start",
    file: "docs/LIFE_OS.md",
    description: "What Life OS is, and the contracts it will not break.",
    markdown: lifeOs,
  },
  {
    slug: "setup",
    title: "Set it up",
    group: "Start",
    file: "docs/AGENT_SETUP.md",
    description: "Install, connect, interview, configure — addressed to an agent.",
    markdown: setup,
  },
  {
    slug: "api",
    title: "HTTP API",
    group: "API",
    file: "docs/API.md",
    description: "Endpoints, headers, protocol version, pairing, tasks, webhooks.",
    markdown: api,
  },
  {
    slug: "network",
    title: "Network & security",
    group: "API",
    file: "docs/NETWORK.md",
    description: "LAN bind, CORS, tokens, tunnels — how a phone reaches the API.",
    markdown: network,
  },
  {
    slug: "database",
    title: "Database",
    group: "API",
    file: "docs/DATABASE.md",
    description: "One SQLite file, migrations, backups, what never gets committed.",
    markdown: database,
  },
  {
    slug: "skill",
    title: "Agent skill",
    group: "Agent",
    file: "docs/skills/life-os/SKILL.md",
    description: "MCP tools, the two-noun model, cards, goals, nightly check-in.",
    markdown: skill,
  },
  {
    slug: "hooks",
    title: "Agent hooks",
    group: "Agent",
    file: "docs/AGENT_HOOKS.md",
    description: "Start Life OS with the gateway so the phone is never talking to air.",
    markdown: hooks,
  },
  {
    slug: "log",
    title: "Development log",
    group: "Project",
    file: "docs/development_log.md",
    description: "How the product got here. Read it if you are extending it.",
    markdown: log,
  },
];

export const DOC_GROUPS: DocGroup[] = ["Start", "API", "Agent", "Project"];

export function docBySlug(slug: string | undefined): DocPage {
  return DOCS.find((d) => d.slug === slug) ?? DOCS[0];
}

export function stripFrontmatter(markdown: string): string {
  if (!markdown.startsWith("---")) return markdown;
  const end = markdown.indexOf("\n---", 3);
  if (end < 0) return markdown;
  return markdown.slice(end + 4).replace(/^\s+/, "");
}
