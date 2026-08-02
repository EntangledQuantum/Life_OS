import { bootstrapDatabase } from "./bootstrap.js";
import { resolveDbPath } from "./client.js";

console.log(`Migrating database at ${resolveDbPath()}…`);
const result = bootstrapDatabase();
if (result.note) console.warn("Drizzle migrate note:", result.note);
console.log(
  result.created
    ? "Database created and migrations applied."
    : "Migrations complete.",
);
