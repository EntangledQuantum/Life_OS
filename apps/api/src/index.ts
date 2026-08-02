import { serve } from "@hono/node-server";
import { bootstrapDatabase, getDb } from "@life-os/db";
import { createApp } from "./app.js";
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

console.log(
  `Life OS API listening on http://${env.apiHost}:${env.apiPort} (storage=${env.storageMode})`,
);

serve({
  fetch: app.fetch,
  port: env.apiPort,
  hostname: env.apiHost,
});
