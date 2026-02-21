import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { createDatabase } from "./client.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

export function applyMigrations({ workspacePath }: { workspacePath: string }): void {
  const db = createDatabase({ workspacePath });
  const migrationsFolder = resolve(__dirname, "..", "drizzle");
  migrate(db, { migrationsFolder });
}
