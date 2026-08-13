import { serve, type ServerType } from "@hono/node-server";
import { bootstrapDatabase, getDb } from "@life-os/db";
import { createApp } from "./app.js";
import { startBackupScheduler } from "./services/backups.js";
import { isExposed, lanAddresses } from "./net.js";
import {
  discoverReachability,
  getPublicUrl,
  getReachabilityHint,
  getTunnelMode,
} from "./reachability.js";
import { env } from "./env.js";

// Provision + migrate before anything touches the DB, so `pnpm dev` works on a
// fresh clone without a separate migrate step.
const boot = bootstrapDatabase();
console.log(
  `Life OS database ${boot.created ? "created" : "ready"} at ${boot.dbPath} ` +
    `(schema v${boot.schemaVersion})`,
);
// Say what actually changed. A silent upgrade is the thing that makes people
// distrust a migration system.
for (const m of boot.appliedMigrations) {
  console.log(`  migrated v${m.version}: ${m.name}`);
}
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
      console.log(`  on this network at http://${address}:${env.apiPort}`);
    }
  } else {
    console.log(
      "  loopback only — your phone cannot reach this. Remove API_HOST from .env " +
        "to listen on the network.",
    );
  }

  /*
   * The public URL, when there is one.
   *
   * This matters more than the LAN addresses: a LAN address stops working the
   * moment you leave the house, and "my phone works at home and not on the
   * train" is the single most common way this setup disappoints someone.
   */
  const publicUrl = getPublicUrl();
  if (publicUrl) {
    console.log(`  from anywhere at ${publicUrl}`);
  } else if (getTunnelMode() !== "off") {
    const hint = getReachabilityHint();
    if (hint) console.log(`  no public URL — ${hint}`);
  }

  console.log(
    "  pair a phone: open Settings in the dashboard and scan the QR. " +
      "Keep API_TOKEN secret.",
  );
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

// Ask the tunnel where we are before announcing. A failure here is not
// fatal: the LAN works whether or not a tunnel does.
void discoverReachability().finally(() => bind());
