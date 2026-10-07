import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { parseBrandConfig, type BrandConfigInput } from "@rafters/platform-contracts";
import { installMigrations } from "../../src/migrations/install.ts";

const missing =
  "migratr is not installed. Install the pinned commit with " +
  "`git clone https://github.com/rafters-studio/migratr && cd migratr && git checkout dcc991ff469583458f70f16280926163972e9603 && cargo install --locked --path crates/migratr-cli`, " +
  "then put it on PATH or point the MIGRATR environment variable at the binary.";

/** Run the real migratr CLI; fail with how to install it when it is missing. */
export function migratr(...args: string[]): string {
  try {
    return execFileSync(process.env.MIGRATR || "migratr", args, { encoding: "utf8" });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT")
      throw new Error(missing, { cause: error });
    throw error;
  }
}

/**
 * A SQLite database built by migratr from the migrations this package ships for the brand: the same files a
 * brand installs, applied the way a brand applies them. Every test that needs a database starts here.
 */
export function migratedDatabase(brandInput: BrandConfigInput): DatabaseSync {
  const brand = parseBrandConfig(brandInput);
  const dir = mkdtempSync(join(tmpdir(), "platform-auth-db-"));
  installMigrations({ to: join(dir, "migrations"), brand });
  const file = join(dir, "brand.db");
  migratr("--db", file, "--dir", join(dir, "migrations"), "up");
  return new DatabaseSync(file);
}
