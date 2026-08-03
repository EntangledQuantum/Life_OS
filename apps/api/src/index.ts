import { serve } from "@hono/node-server";
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
startBackupScheduler();

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

serve({
  fetch: app.fetch,
  port: env.apiPort,
  hostname: env.apiHost,
});
