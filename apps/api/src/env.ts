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
  /**
   * Bind address. Defaults to loopback so a fresh clone is not reachable from
   * the network by accident. Set `API_HOST=0.0.0.0` to expose it to your LAN
   * (phone, tablet, another machine) — see `docs/NETWORK.md`.
   */
  apiHost: process.env.API_HOST ?? "127.0.0.1",
  /**
   * Extra CORS origins beyond localhost and private-LAN addresses, comma
   * separated. Only needed for a tunnel or a real hostname.
   */
  corsOrigins: (process.env.CORS_ORIGINS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
  apiToken: process.env.API_TOKEN ?? "lifeos-local-agent-token",
  sessionSecret: process.env.SESSION_SECRET ?? "lifeos-dev-secret",
  databasePath: process.env.DATABASE_PATH ?? "./data/lifeos.db",
  storageMode: (process.env.STORAGE_MODE ?? "local") as "local" | "supabase",
  supabaseUrl: process.env.SUPABASE_URL ?? null,
  supabaseKey: process.env.SUPABASE_KEY ?? null,
};
