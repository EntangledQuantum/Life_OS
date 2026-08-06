import { serve, type ServerType } from "@hono/node-server";
import { bootstrapDatabase, getDb } from "@life-os/db";
import { createApp } from "./app.js";
import { startBackupScheduler } from "./services/backups.js";
import { isExposed, lanAddresses } from "./net.js";
import { env } from "./env.js";

// Provision + migrate before anything touches the DB, so `pnpm dev` works on a
// fresh clone without a separate migrate step.
const boot = bootstrapDatabase();
console.log(
  `Life OS database ${boot.created ? "created" : "ready"} at ${boot.dbPath}`,
);
if (boot.note) console.warn(`  migration note: ${boot.note}`);

getDb();

const app = createApp();

// Snapshots the SQLite file on the interval in settings (default every 6h).
const backups = startBackupScheduler();

/**
 * Binding, with the two things the old version got wrong.
 *
 * It printed "Life OS API listening on …" *before* calling serve(), so a failed
 * bind still produced a full success banner followed by a stack trace — which
 * is why a dead API looked like a running one in the logs.
 *
 * And `serve()` returns a plain node Server: an 'error' event with no listener
 * is rethrown, which killed the process outright. A single EADDRINUSE took the
 * whole API down until someone noticed and restarted it.
 */
const MAX_BIND_ATTEMPTS = 3;
const RETRY_DELAY_MS = 1000;

let server: ServerType | null = null;

function announce(): void {
  console.log(
    `Life OS API listening on http://${env.apiHost}:${env.apiPort} (storage=${env.storageMode})`,
  );

  if (isExposed(env.apiHost)) {
    // Print the addresses a phone would actually type, and be honest about what
    // exposing it means — the auth here is a single shared token.
    for (const address of lanAddresses()) {
      console.log(`  reachable on your network at http://${address}:${env.apiPort}`);
    }
    console.log(
      "  ⚠ anyone on this network can reach the API — keep API_TOKEN secret and " +
        "do not port-forward this to the internet",
    );
  }
}

function portInUse(attempt: number): void {
  if (attempt < MAX_BIND_ATTEMPTS) {
    // Usually a previous run that has not finished letting go of the socket.
    // Waiting a beat fixes that without the user doing anything.
    console.warn(
      `  port ${env.apiPort} still busy — retrying (${attempt}/${MAX_BIND_ATTEMPTS - 1})`,
    );
    setTimeout(() => bind(attempt + 1), RETRY_DELAY_MS);
    return;
  }

  console.error(
    `\nCannot start: port ${env.apiPort} is already in use.\n\n` +
      "  Another Life OS API is almost certainly still running — on Windows a\n" +
      "  Ctrl+C in the terminal does not always kill the child node process.\n\n" +
      "  Find it:   netstat -ano | findstr :" +
      env.apiPort +
      "\n" +
      "  Stop it:   taskkill /PID <pid> /F\n\n" +
      "  Or run this one on a different port with API_PORT in .env.\n",
  );
  backups.stop();
  process.exit(1);
}

function bind(attempt = 1): void {
  const next = serve(
    { fetch: app.fetch, port: env.apiPort, hostname: env.apiHost },
    // Only true once the socket is actually bound.
    () => announce(),
  );

  next.on("error", (error: NodeJS.ErrnoException) => {
    if (error.code === "EADDRINUSE") {
      portInUse(attempt);
      return;
    }
    // Anything else: say so, but do not take the API down for it. A single bad
    // socket is not a reason to stop serving every other request.
    console.error("[server] error:", error);
  });

  server = next;
}

/** Release the port promptly so the next start does not hit EADDRINUSE. */
function shutdown(signal: string): void {
  console.log(`\n${signal} — shutting down Life OS API`);
  backups.stop();
  if (!server) process.exit(0);

  server.close(() => process.exit(0));
  // Do not hang forever on a keep-alive connection that will not close.
  setTimeout(() => process.exit(0), 3000).unref();
}

for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
  process.on(signal, () => shutdown(signal));
}

/**
 * Last line of defence. This is a single-user app on the user's own machine
 * with no supervisor to restart it, so a stray async error staying alive and
 * loud beats a silent exit that leaves the phone and the agent with a dead
 * endpoint. Anything caught here is a bug worth reporting, not normal.
 */
process.on("unhandledRejection", (reason) => {
  console.error("[unhandled rejection]", reason);
});
process.on("uncaughtException", (error) => {
  console.error("[uncaught exception]", error);
  console.error("  The API is still running. Please report this trace.");
});

bind();
