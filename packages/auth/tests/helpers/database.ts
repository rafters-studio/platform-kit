import { DatabaseSync } from "node:sqlite";
import { shippedMigrations } from "../../src/migrations/install.ts";

/**
 * An in-memory SQLite database built from the migrations this package ships, the same files a brand
 * installs into D1. Every test that needs a database starts here, so the tests run on the shipped schema.
 */
export function migratedDatabase(options: { ledger: boolean }): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  for (const migration of shippedMigrations(options)) db.exec(migration.sql);
  return db;
}
