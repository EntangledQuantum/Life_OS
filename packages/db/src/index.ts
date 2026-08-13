export * from "./schema.js";
export * from "./client.js";
export {
  ensureSchema,
  readSchemaVersion,
  currentVersion,
  LATEST_VERSION,
  MIGRATIONS,
} from "./ensure-schema.js";
export type { Migration, MigrationResult } from "./ensure-schema.js";
export { bootstrapDatabase, type BootstrapResult } from "./bootstrap.js";
export {
  backupDatabase,
  backupsDir,
  listBackups,
  pruneBackups,
  type BackupFile,
} from "./backup.js";
