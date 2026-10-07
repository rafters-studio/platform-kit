import type { BrandConfigInput } from "@rafters/platform-contracts";
import type { BetterAuthPlugin } from "better-auth";
import { getSchema } from "better-auth/db";
import { getMigrations } from "better-auth/db/migration";
import { describe, expect, it } from "vite-plus/test";
import { authOptions, type AuthEnv } from "../../src/server/index.ts";
import { migratedDatabase } from "../helpers/database.ts";
import { recordingSender } from "../helpers/sender.ts";

const brand: BrandConfigInput = {
  id: "bands",
  rootDomain: "bands.app",
  sending: { from: "hello@bands.app" },
  permissions: { budget: ["read"] },
};
const env = {
  DB: {} as AuthEnv["DB"],
  BETTER_AUTH_SECRET: "test-secret-0123456789abcdef0123456789",
  SENDER: recordingSender(),
};
// Ledger's own tables arrive with #15; here only the user fields its soft delete needs are in play.
const ledger = { ledgerPlugin: (): BetterAuthPlugin => ({ id: "ledger" }) };

describe.each([false, true])("the shipped migrations with ledger %s", (ledgerOn) => {
  const db = migratedDatabase({ ledger: ledgerOn });
  const options = { ...authOptions({ ...brand, ledger: ledgerOn }, env, { ledger }), database: db };

  it("leave better-auth nothing to create, add, or index", async () => {
    const pending = await getMigrations(options);
    expect(pending.toBeCreated).toEqual([]);
    expect(pending.toBeAdded).toEqual([]);
    expect(pending.toBeAddedIndexes).toEqual([]);
    expect(pending.unsafeChanges).toEqual([]);
    expect(pending.schemaProblems).toEqual([]);
  });

  it("hold exactly the tables and columns the options declare, and no others", () => {
    const schema = getSchema(options);
    const want: Record<string, string[]> = {};
    for (const [model, table] of Object.entries(schema)) {
      want[model] = [
        "id",
        ...Object.entries(table.fields).map(([key, field]) => field.fieldName ?? key),
      ].sort();
    }
    const tables = db
      .prepare(`select name from sqlite_master where type = 'table' and name not like 'sqlite_%'`)
      .all()
      .map((row) => String(row.name));
    const have: Record<string, string[]> = {};
    for (const table of tables) {
      have[table] = db
        .prepare(`pragma table_info("${table}")`)
        .all()
        .map((row) => String(row.name))
        .sort();
    }
    expect(have).toEqual(want);
  });
});
