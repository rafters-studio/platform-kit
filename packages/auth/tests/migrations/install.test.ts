import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseBrandConfig, type BrandConfigInput } from "@rafters/platform-contracts";
import { describe, expect, it } from "vite-plus/test";
import { installMigrations, shippedDir } from "../../src/migrations/install.ts";
import { migratr } from "../helpers/database.ts";

const base: BrandConfigInput = {
  id: "bandz",
  rootDomain: "bandz.app",
  sending: { from: "hello@bandz.app" },
  permissions: { budget: ["read"] },
};
const configured = (extra: Partial<BrandConfigInput> = {}) =>
  parseBrandConfig({ ...base, ...extra });
const fresh = () => mkdtempSync(join(tmpdir(), "platform-auth-migrations-"));

const always = [
  "20261007100000_auth_core.json",
  "20261007100100_passkey.json",
  "20261007100200_organization.json",
  "20261007100300_organization_role.json",
];
const apiKey = "20261007100700_api_key.json";
const teams = "20261007100400_teams.json";
const backupEmail = "20261007100500_backup_email.json";
const phoneNumber = "20261007100900_phone_number.json";
const ledger = "20261007100600_ledger_user_fields.json";
const vouch = "20261007100800_vouch.json";
const orgCredentials = "20261008000451_org_credentials.json";

describe("installMigrations", () => {
  it("copies only the always-on needs for a brand with everything off, byte for byte", () => {
    const to = fresh();
    expect(installMigrations({ to, brand: configured() })).toEqual([
      ...always,
      apiKey,
      orgCredentials,
    ]);
    expect(readdirSync(to).sort()).toEqual([...always, apiKey, orgCredentials]);
    expect(readFileSync(join(to, always[0] ?? ""), "utf8")).toBe(
      readFileSync(join(shippedDir, always[0] ?? ""), "utf8"),
    );
  });

  it("copies each optional need only when its setting is on", () => {
    const all = configured({
      plugins: { teams: true },
      recovery: { backupEmail: true },
      ledger: true,
    });
    const allOn = configured({
      plugins: { teams: true, vouch: { required: 2, waitingPeriodSeconds: 3600 } },
      recovery: { backupEmail: true, phone: true },
      ledger: true,
    });
    expect(installMigrations({ to: fresh(), brand: all })).toEqual([
      ...always,
      teams,
      backupEmail,
      ledger,
      apiKey,
      orgCredentials,
    ]);
    expect(installMigrations({ to: fresh(), brand: allOn })).toEqual([
      ...always,
      teams,
      backupEmail,
      ledger,
      apiKey,
      vouch,
      phoneNumber,
      orgCredentials,
    ]);
    expect(
      installMigrations({ to: fresh(), brand: configured({ recovery: { phone: true } }) }),
    ).toEqual([...always, apiKey, phoneNumber, orgCredentials]);
    expect(installMigrations({ to: fresh(), brand: configured({ ledger: true }) })).toEqual([
      ...always,
      ledger,
      apiKey,
      orgCredentials,
    ]);
  });

  it("copies nothing on a second run and leaves the brand's own files alone", () => {
    const to = fresh();
    writeFileSync(join(to, "20260101000000_budgets.json"), '{"up":[]}');
    const brand = configured({ ledger: true });
    installMigrations({ to, brand });
    const before = readdirSync(to).sort();
    expect(installMigrations({ to, brand })).toEqual([]);
    expect(readdirSync(to).sort()).toEqual(before);
  });

  it("copies only a need's file when the brand turns it on later, and migratr applies it", () => {
    const to = fresh();
    const db = join(fresh(), "brand.db");
    installMigrations({ to, brand: configured() });
    migratr("--db", db, "--dir", to, "up");

    expect(installMigrations({ to, brand: configured({ plugins: { teams: true } }) })).toEqual([
      teams,
    ]);
    expect(installMigrations({ to, brand: configured({ ledger: true }) })).toEqual([ledger]);

    const out = migratr("--db", db, "--dir", to, "up");
    expect(out).toContain("applied 2 migration(s)");
    expect(migratr("--db", db, "--dir", to, "status")).not.toContain("pending");
  });
});
