#!/usr/bin/env node
/**
 * Life OS MCP over stdio, for an agent on this machine.
 *
 * There is nothing to start. An MCP client spawns this as a child process when
 * it connects and talks JSON-RPC down the pipes; when the client goes away, so
 * does this. Running it by hand is a way to check it boots, not a step in
 * setting anything up — it will print one line and then wait silently for
 * messages a terminal is never going to send.
 *
 * An agent that is **not** on this machine cannot use stdio at all: there is no
 * process to spawn and no filesystem in common. That one talks to the same
 * tools over HTTP at `/mcp` on the API. Both transports serve the identical
 * server, built by `createMcpServer()`.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";

/*
 * `.env` first, and before the server module is imported — it is where
 * DATABASE_PATH lives, and the tools resolve the database on their first call.
 *
 * `config()` does not overwrite a variable that is already set, so anything the
 * MCP client passed in its own `env` block wins over the file. That is the
 * dependable way to pin which database an agent is on, and it is why this call
 * cannot simply be dropped in favour of the client's environment.
 */
config({
  path: path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../../../.env",
  ),
});

const { StdioServerTransport } = await import(
  "@modelcontextprotocol/sdk/server/stdio.js"
);
const { createMcpServer } = await import(
  "../../../apps/api/src/mcp/server.js"
);

const server = createMcpServer();
await server.connect(new StdioServerTransport());

/*
 * stdout is the transport. Anything written there that is not a JSON-RPC frame
 * corrupts the stream, so every human-readable line goes to stderr — which the
 * client shows in its logs.
 */
console.error("Life OS MCP server running on stdio");
