/**
 * MCP over HTTP, for an agent that is not on this machine.
 *
 * stdio was the only transport, and stdio means a shared filesystem: the client
 * spawns the server as a child process and talks down its pipes. An agent in a
 * container, on a gateway, or on another host cannot do that. Those agents were
 * falling back to the REST API — which is the *apps'* surface. It answers "give
 * me the dashboard", not "tell me what happened on the 3rd", so an agent
 * reassembles a day out of a dozen calls and gets a screen's view of the data
 * rather than the whole of it.
 *
 * Same tools, same database, same token. Only the pipe is different.
 */
import type { Context } from "hono";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { createMcpServer } from "./server.js";

/**
 * One server and one transport per request, and nothing kept between them.
 *
 * Stateless is the right shape here rather than a concession. Sessions exist so
 * a server can push notifications to a client between calls and resume a
 * dropped stream; Life OS pushes nothing — every tool is a request the agent
 * made and a reply it waits for. Holding session state would mean a map of
 * live transports keyed by an id, entries leaking whenever an agent goes away
 * without saying goodbye, and a restart silently invalidating every client.
 *
 * The cost is one object allocation per call. The tool table is module-level
 * and shared; what gets built here is the dispatch wrapper around it.
 */
export async function handleMcpRequest(c: Context): Promise<Response> {
  /*
   * POST only, deliberately.
   *
   * GET on an MCP endpoint opens a server-initiated SSE stream, and the spec
   * explicitly allows answering it with 405 when the server has nothing to
   * push. Accepting it would mean holding an open stream — with its keep-alive
   * timer — for every agent that ever connected, to carry messages that do not
   * exist. Clients handle the 405 and use POST, which is the only thing they
   * need.
   */
  if (c.req.method !== "POST") {
    return c.json(
      {
        jsonrpc: "2.0",
        error: {
          code: -32000,
          message:
            "Life OS serves MCP over POST only. There are no server-initiated messages to stream, so this endpoint does not open an SSE channel.",
        },
        id: null,
      },
      405,
      { Allow: "POST" },
    );
  }

  const transport = new WebStandardStreamableHTTPServerTransport({
    // Explicitly undefined: this is what puts the transport in stateless mode.
    sessionIdGenerator: undefined,
    /*
     * Answer with a plain JSON body instead of an SSE frame. Every tool here
     * returns in one shot, so a stream would be a single event followed by a
     * close — more moving parts for a client to get wrong, and harder to try
     * with curl when something is not working.
     */
    enableJsonResponse: true,
  });

  const server = createMcpServer();
  await server.connect(transport);

  try {
    return await transport.handleRequest(c.req.raw);
  } finally {
    /*
     * Both are per-request, so they are released here rather than left for the
     * garbage collector — `enableJsonResponse` means the body is complete by
     * the time handleRequest resolves, so there is nothing still writing.
     */
    void transport.close().catch(() => {});
  }
}
