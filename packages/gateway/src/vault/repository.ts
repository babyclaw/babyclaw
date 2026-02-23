import { eq } from "drizzle-orm";
import type { Database } from "../database/client.js";
import { secrets, type Secret } from "../database/schema.js";

type VaultRepositoryInput = {
  db: Database;
};

export type VaultEntry = Pick<Secret, "key" | "value" | "label" | "createdAt" | "updatedAt">;
export type VaultListItem = Pick<Secret, "key" | "label" | "updatedAt">;

export class VaultRepository {
  private readonly db: Database;

  constructor({ db }: VaultRepositoryInput) {
    this.db = db;
  }

  async get({ key }: { key: string }): Promise<VaultEntry | null> {
    const row = this.db.select().from(secrets).where(eq(secrets.key, key)).get();
    return row ?? null;
  }

  async set({
    key,
    value,
    label,
  }: {
    key: string;
    value: string;
    label?: string;
  }): Promise<{ created: boolean }> {
    const existing = this.db
      .select({ key: secrets.key })
      .from(secrets)
      .where(eq(secrets.key, key))
      .get();

    if (existing) {
      this.db
        .update(secrets)
        .set({ value, label: label ?? null, updatedAt: new Date() })
        .where(eq(secrets.key, key))
        .run();
      return { created: false };
    }

    this.db
      .insert(secrets)
      .values({ key, value, label: label ?? null })
      .run();
    return { created: true };
  }

  async delete({ key }: { key: string }): Promise<{ deleted: boolean }> {
    const result = this.db.delete(secrets).where(eq(secrets.key, key)).run();
    return { deleted: result.changes > 0 };
  }

  async list(): Promise<VaultListItem[]> {
    const rows = this.db
      .select({ key: secrets.key, label: secrets.label, updatedAt: secrets.updatedAt })
      .from(secrets)
      .all();
    return rows;
  }
}
