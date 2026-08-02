import path from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
config({ path: path.join(root, ".env") });

export const env = {
  root,
  adminUser: process.env.ADMIN_USER ?? "admin",
  adminPass: process.env.ADMIN_PASS ?? "lifeos",
  apiPort: Number(process.env.API_PORT ?? 8787),
  apiHost: process.env.API_HOST ?? "127.0.0.1",
  apiToken: process.env.API_TOKEN ?? "lifeos-local-agent-token",
  sessionSecret: process.env.SESSION_SECRET ?? "lifeos-dev-secret",
  databasePath: process.env.DATABASE_PATH ?? "./data/lifeos.db",
  storageMode: (process.env.STORAGE_MODE ?? "local") as "local" | "supabase",
  supabaseUrl: process.env.SUPABASE_URL ?? null,
  supabaseKey: process.env.SUPABASE_KEY ?? null,
};
