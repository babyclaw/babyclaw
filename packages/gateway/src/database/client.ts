import { mkdirSync } from "node:fs";
import { join } from "node:path";
import SqliteDatabase from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "./schema.js";

const DB_DIR = ".data";
const DB_FILENAME = "babyclaw.db";

export function getDatabasePath({
  workspacePath,
}: {
  workspacePath: string;
}): string {
  return join(workspacePath, DB_DIR, DB_FILENAME);
}

export function createDatabase({
  workspacePath,
}: {
  workspacePath: string;
}) {
  const dir = join(workspacePath, DB_DIR);
  mkdirSync(dir, { recursive: true });
  const filePath = join(dir, DB_FILENAME);
  const sqlite = new SqliteDatabase(filePath);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  return drizzle(sqlite, { schema });
}

export type Database = ReturnType<typeof createDatabase>;
