#!/usr/bin/env node
import { copyFileSync, mkdirSync, readdirSync, readFileSync, realpathSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** The migrations shipped in this package, next to src/ and dist/. */
export const shippedDir = join(dirname(fileURLToPath(import.meta.url)), "../../migrations");

/** Installed copies are named <brand number>_platform-auth-<shipped name>. */
const PREFIX = "platform-auth-";
const NUMBERED = /^(\d+)_/;

export interface ShippedMigration {
  name: string;
  sql: string;
  /** True when the first line is `-- requires: ledger`: installed only for a ledger-on brand. */
  ledger: boolean;
}

/** The shipped migrations in order, for brands whose `ledger` setting matches. */
export function shippedMigrations(
  options: { ledger: boolean },
  dir = shippedDir,
): ShippedMigration[] {
  return readdirSync(dir)
    .filter((name) => NUMBERED.test(name) && name.endsWith(".sql"))
    .sort()
    .map((name) => {
      const sql = readFileSync(join(dir, name), "utf8");
      return { name, sql, ledger: sql.startsWith("-- requires: ledger") };
    })
    .filter((migration) => options.ledger || !migration.ledger);
}

/**
 * Copy into a wrangler migrations directory the shipped migrations it does not have yet, numbered
 * after its last migration. Returns the names written; a second run writes nothing.
 */
export function installMigrations(options: {
  to: string;
  ledger: boolean;
  from?: string;
}): string[] {
  mkdirSync(options.to, { recursive: true });
  const existing = readdirSync(options.to).filter((name) => NUMBERED.test(name));
  const installed = new Set(existing.flatMap((name) => name.split(`_${PREFIX}`).slice(1)));
  let last = Math.max(0, ...existing.map((name) => Number(NUMBERED.exec(name)?.[1])));

  const written: string[] = [];
  for (const migration of shippedMigrations(options, options.from)) {
    if (installed.has(migration.name)) continue;
    last += 1;
    const name = `${String(last).padStart(4, "0")}_${PREFIX}${migration.name}`;
    copyFileSync(join(options.from ?? shippedDir, migration.name), join(options.to, name));
    written.push(name);
  }
  return written;
}

function main(args: string[]): void {
  const to = args.find((arg) => !arg.startsWith("--"));
  if (to === undefined) {
    console.error("usage: platform-auth-migrations <wrangler migrations dir> [--ledger]");
    process.exit(1);
  }
  const written = installMigrations({ to, ledger: args.includes("--ledger") });
  console.log(written.length > 0 ? written.join("\n") : "platform-auth migrations are up to date");
}

// Run as the bin (npm links it through node_modules/.bin, so compare real paths), not when imported.
if (
  process.argv[1] !== undefined &&
  realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main(process.argv.slice(2));
}
