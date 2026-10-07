import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { installMigrations, shippedDir } from "../../src/migrations/install.ts";

const fresh = () => mkdtempSync(join(tmpdir(), "platform-auth-migrations-"));

describe("installMigrations", () => {
  it("copies the shipped migrations into an empty directory, byte for byte", () => {
    const to = fresh();
    expect(installMigrations({ to, ledger: false })).toEqual([
      "0001_platform-auth-0001_auth-core.sql",
    ]);
    expect(readFileSync(join(to, "0001_platform-auth-0001_auth-core.sql"), "utf8")).toBe(
      readFileSync(join(shippedDir, "0001_auth-core.sql"), "utf8"),
    );
  });

  it("numbers them after the brand's last migration", () => {
    const to = fresh();
    writeFileSync(join(to, "0001_init.sql"), "");
    writeFileSync(join(to, "0007_budgets.sql"), "");
    expect(installMigrations({ to, ledger: true })).toEqual([
      "0008_platform-auth-0001_auth-core.sql",
      "0009_platform-auth-0002_ledger-user-fields.sql",
    ]);
  });

  it("copies nothing on a second run", () => {
    const to = fresh();
    installMigrations({ to, ledger: true });
    const before = readdirSync(to).sort();
    expect(installMigrations({ to, ledger: true })).toEqual([]);
    expect(readdirSync(to).sort()).toEqual(before);
  });

  it("adds only the ledger migration when a brand turns ledger on later", () => {
    const to = fresh();
    installMigrations({ to, ledger: false });
    expect(installMigrations({ to, ledger: true })).toEqual([
      "0002_platform-auth-0002_ledger-user-fields.sql",
    ]);
  });
});
