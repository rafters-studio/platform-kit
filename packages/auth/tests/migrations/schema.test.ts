import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { BrandConfigInput } from "@rafters/platform-contracts";
import type { BetterAuthPlugin } from "better-auth";
import { getSchema } from "better-auth/db";
import { getMigrations } from "better-auth/db/migration";
import { describe, expect, it } from "vite-plus/test";
import { allShippedMigrations, shippedDir } from "../../src/migrations/install.ts";
import { authOptions, type AuthEnv } from "../../src/server/index.ts";
import { migratedDatabase } from "../helpers/database.ts";
import { recordingSender } from "../helpers/sender.ts";

const brand: BrandConfigInput = {
  id: "bandz",
  rootDomain: "bandz.app",
  sending: { from: "hello@bandz.app" },
  permissions: { budget: ["read"] },
};
const env = {
  DB: {} as AuthEnv["DB"],
  BETTER_AUTH_SECRET: "test-secret-0123456789abcdef0123456789",
  SENDER: recordingSender(),
};
// Ledger's own tables arrive with #15; here only the user fields its soft delete needs are in play.
const ledger = { ledgerPlugin: (): BetterAuthPlugin => ({ id: "ledger" }) };

const combinations = [false, true].flatMap((teams) =>
  [false, true].flatMap((backupEmail) =>
    [false, true].flatMap((vouch) =>
      [false, true].map((ledgerOn) => ({ teams, backupEmail, vouch, ledger: ledgerOn })),
    ),
  ),
);

describe.each(combinations)(
  "migratr up on the migrations a brand with teams $teams, backupEmail $backupEmail, vouch $vouch, ledger $ledger installs",
  (flags) => {
    const input: BrandConfigInput = {
      ...brand,
      ledger: flags.ledger,
      plugins: {
        teams: flags.teams,
        vouch: flags.vouch ? { required: 2, waitingPeriodSeconds: 3600 } : false,
      },
      recovery: { backupEmail: flags.backupEmail },
    };
    const db = migratedDatabase(input);
    const options = { ...authOptions(input, env, { ledger }), database: db };

    it("leaves better-auth nothing to create, add, or index", async () => {
      const pending = await getMigrations(options);
      expect(pending.toBeCreated).toEqual([]);
      expect(pending.toBeAdded).toEqual([]);
      expect(pending.toBeAddedIndexes).toEqual([]);
      expect(pending.unsafeChanges).toEqual([]);
      expect(pending.schemaProblems).toEqual([]);
    });

    it("holds exactly the tables and columns the options declare, and no others", () => {
      const schema = getSchema(options);
      const want: Record<string, string[]> = {};
      for (const [model, table] of Object.entries(schema)) {
        want[model] = [
          "id",
          ...Object.entries(table.fields).map(([key, field]) => field.fieldName ?? key),
        ].sort();
      }
      const tables = db
        .prepare(
          `select name from sqlite_master where type = 'table' and name not like 'sqlite_%' and name != '_migratr_migrations'`,
        )
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

    it("has team tables and columns only with teams on", () => {
      const names = db
        .prepare(`select name from sqlite_master where type = 'table'`)
        .all()
        .map((row) => String(row.name));
      const columns = ["session", "invitation"].flatMap((table) =>
        db
          .prepare(`pragma table_info("${table}")`)
          .all()
          .map((row) => String(row.name)),
      );
      expect(names.includes("team")).toBe(flags.teams);
      expect(names.includes("teamMember")).toBe(flags.teams);
      expect(columns.includes("teamId")).toBe(flags.teams);
      expect(columns.includes("activeTeamId")).toBe(flags.teams);
    });

    it("has vouching tables only with vouching on", () => {
      const names = db
        .prepare(`select name from sqlite_master where type = 'table'`)
        .all()
        .map((row) => String(row.name));
      expect(names.includes("vouchRequest")).toBe(flags.vouch);
      expect(names.includes("vouchApproval")).toBe(flags.vouch);
    });
  },
);

describe("the shipped migration files", () => {
  /** Every table a file creates and every column it adds, as table or table.column. */
  const touched = (file: string): string[] => {
    const body = JSON.parse(readFileSync(join(shippedDir, file), "utf8")) as {
      up: { op: string; table?: string; column?: { name: string } }[];
    };
    return body.up.flatMap((op) => {
      if (op.op === "create_table") return [`${op.table}`];
      if (op.op === "add_column") return [`${op.table}.${op.column?.name}`];
      return [];
    });
  };

  it("each cover exactly one need", () => {
    const byNeed = Object.fromEntries(
      allShippedMigrations().map(({ file, need }) => [need, touched(file)]),
    );
    expect(byNeed).toEqual({
      auth_core: ["user", "session", "account", "verification"],
      passkey: ["passkey"],
      organization: ["organization", "member", "invitation", "session.activeOrganizationId"],
      organization_role: ["organizationRole"],
      teams: ["team", "teamMember", "invitation.teamId", "session.activeTeamId"],
      backup_email: ["user.backupEmail", "user.backupEmailVerified"],
      ledger_user_fields: ["user.deletedAt", "user.deletedBy"],
      vouch: ["vouchRequest", "vouchApproval"],
      api_key: ["apikey"],
    });
  });

  it("use only operations and never raw sql", () => {
    for (const { file } of allShippedMigrations()) {
      expect(readFileSync(join(shippedDir, file), "utf8")).not.toContain("raw_sql");
    }
  });
});
