#!/usr/bin/env node
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseBrandConfig, type BrandConfig } from "@rafters/platform-contracts";

/** The migratr migrations shipped in this package, next to src/ and dist/. */
export const shippedDir = join(dirname(fileURLToPath(import.meta.url)), "../../migrations");

/** `<YYYYMMDDHHMMSS>_<need>.json`: the timestamp is the need's identity, the name is the need. */
const SHIPPED = /^\d{14}_([a-z][a-z0-9_]*)\.json$/;

/**
 * The needs a brand's configuration turns on that are not always installed. A need absent here is
 * always installed; a shipped file whose need is neither listed here nor always on is a bug the
 * tests catch.
 */
const optionalNeeds: Record<string, (brand: BrandConfig) => boolean> = {
  teams: (brand) => brand.plugins.teams,
  backup_email: (brand) => brand.recovery.backupEmail,
  ledger_user_fields: (brand) => brand.ledger,
  vouch: (brand) => brand.plugins.vouch !== false,
};

/** Needs every brand installs. */
export const alwaysOnNeeds = ["auth_core", "passkey", "organization", "organization_role"];

export interface ShippedMigration {
  /** The file name, kept as shipped when installed. */
  file: string;
  need: string;
}

/** Every shipped migration in version order, whether or not a brand installs it. */
export function allShippedMigrations(dir = shippedDir): ShippedMigration[] {
  return readdirSync(dir)
    .filter((file) => SHIPPED.test(file))
    .sort()
    .map((file) => ({ file, need: SHIPPED.exec(file)?.[1] ?? file }));
}

/** The shipped migrations for the needs this brand's configuration turns on, in version order. */
export function shippedMigrations(brand: BrandConfig, dir = shippedDir): ShippedMigration[] {
  return allShippedMigrations(dir).filter(
    (migration) => optionalNeeds[migration.need]?.(brand) ?? true,
  );
}

/**
 * Copy into a brand's migratr migrations directory the files for the needs its configuration turns
 * on that are not there yet, under their shipped names. Returns the names written; a second run
 * writes nothing, and a need turned on later is copied on the next run. migratr applies a pending
 * migration even when newer ones are applied.
 */
export function installMigrations(options: {
  to: string;
  brand: BrandConfig;
  from?: string;
}): string[] {
  const from = options.from ?? shippedDir;
  mkdirSync(options.to, { recursive: true });
  const written: string[] = [];
  for (const migration of shippedMigrations(options.brand, from)) {
    if (existsSync(join(options.to, migration.file))) continue;
    copyFileSync(join(from, migration.file), join(options.to, migration.file));
    written.push(migration.file);
  }
  return written;
}

function main(args: string[]): void {
  const [configPath, to] = args;
  if (configPath === undefined || to === undefined) {
    console.error("usage: platform-auth-migrations <brand config .json> <migratr migrations dir>");
    process.exit(1);
  }
  const brand = parseBrandConfig(JSON.parse(readFileSync(configPath, "utf8")));
  const written = installMigrations({ to, brand });
  console.log(written.length > 0 ? written.join("\n") : "platform-auth migrations are up to date");
}

// Run as the bin (npm links it through node_modules/.bin, so compare real paths), not when imported.
if (
  process.argv[1] !== undefined &&
  realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main(process.argv.slice(2));
}
