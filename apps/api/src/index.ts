import { serve } from "@hono/node-server";
import { ensureSchema, getDb } from "@life-os/db";
import { createApp } from "./app.js";
import { env } from "./env.js";

ensureSchema();
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
