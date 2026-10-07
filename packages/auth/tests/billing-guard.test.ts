import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vite-plus/test";
import { migratedDatabase } from "./helpers/database.ts";

const brand = {
  id: "bandz",
  rootDomain: "bandz.app",
  sending: { from: "hello@bandz.app" },
  permissions: { budget: ["read"] },
};

/** Words that mark payment, subscription, or processor data. Auth holds none; each brand bills outside auth. */
const billingWord =
  /pay(ment|ment_?method|out)?|bill(ing)?|subscri|invoice|charge|checkout|customer|stripe|paddle|polar|lemon|braintree|paypal|adyen|chargebee|processor|plan|price|currency|card|iban|trial|entitle/i;

/** Payment processor SDKs, and better-auth's payment plugins, by package name. */
const processorPackage =
  /^(stripe|@stripe\/.+|@better-auth\/stripe|@better-auth\/polar|@polar-sh\/.+|@paddle\/.+|paddle-.+|@lemonsqueezy\/.+|braintree|paypal.*|@paypal\/.+|@adyen\/.+|adyen-.+|square|chargebee.*|dodopayments.*|@dodopayments\/.+)$/i;

function schemaNames(ledger: boolean): string[] {
  const db = migratedDatabase({
    ...brand,
    ledger,
    plugins: { teams: true },
    recovery: { backupEmail: true },
  });
  const names: string[] = [];
  const tables = db
    .prepare(`select name from sqlite_master where type = 'table' and name not like 'sqlite_%'`)
    .all()
    .map((row) => String(row.name));
  for (const table of tables) {
    names.push(table);
    for (const column of db.prepare(`pragma table_info("${table}")`).all()) {
      names.push(`${table}.${String(column.name)}`);
    }
  }
  return names;
}

describe.each([false, true])("the shipped schema with ledger %s", (ledger) => {
  it("has tables to inspect", () => {
    expect(schemaNames(ledger).length).toBeGreaterThan(0);
  });

  it("holds no payment, subscription, or processor table or column", () => {
    expect(schemaNames(ledger).filter((name) => billingWord.test(name))).toEqual([]);
  });
});

/** Package names a pnpm lockfile resolves for one workspace importer, following snapshots transitively. */
function resolvedPackageNames(lock: string, importer: string): string[] {
  const lines = lock.split("\n");
  const keyOf = (line: string) => line.match(/^ {2}'?([^':]+(?:\([^']*\))?)'?:/)?.[1];
  const entry = (name: string, version: string) => `${name}@${version}`;

  // Direct dependencies of the importer: `name:` at 6 spaces, `version:` at 8.
  const queue: string[] = [];
  let inImporter = false;
  let name = "";
  for (const line of lines.slice(lines.lastIndexOf("importers:"))) {
    if (/^snapshots:|^packages:/.test(line)) break;
    if (/^ {2}\S/.test(line)) inImporter = line.trim() === `${importer}:`;
    if (!inImporter) continue;
    const dep = line.match(/^ {6}'?([^':]+)'?:$/);
    if (dep?.[1]) name = dep[1];
    const version = line.match(/^ {8}version: (.+)$/);
    if (version?.[1] && !version[1].startsWith("link:")) queue.push(entry(name, version[1]));
  }

  // Snapshot graph: `key:` at 2 spaces, its `dependencies:` entries at 6.
  const graph = new Map<string, string[]>();
  let current: string[] | undefined;
  for (const line of lines.slice(lines.lastIndexOf("snapshots:"))) {
    const key = /^ {2}\S/.test(line) ? keyOf(line) : undefined;
    if (key) {
      current = [];
      graph.set(key, current);
      continue;
    }
    const dep = line.match(/^ {6}'?([^':]+)'?: (.+)$/);
    if (dep?.[1] && dep[2] && current) current.push(entry(dep[1], dep[2]));
  }

  const seen = new Set<string>();
  while (queue.length > 0) {
    const next = queue.pop();
    if (next === undefined || seen.has(next)) continue;
    seen.add(next);
    queue.push(...(graph.get(next) ?? []));
  }
  const nameOf = (key: string) => {
    const bare = key.split("(")[0] ?? key;
    return bare.slice(0, bare.lastIndexOf("@"));
  };
  return [...new Set([...seen].map(nameOf))];
}

describe("the package", () => {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
  const pkg: unknown = JSON.parse(
    readFileSync(resolve(root, "packages/auth/package.json"), "utf8"),
  );
  const lock = readFileSync(resolve(root, "pnpm-lock.yaml"), "utf8");

  it("declares no payment processor SDK in any dependency field", () => {
    const declared = new Set<string>();
    if (typeof pkg === "object" && pkg !== null) {
      for (const field of [
        "dependencies",
        "devDependencies",
        "peerDependencies",
        "optionalDependencies",
      ]) {
        const deps: unknown = Reflect.get(pkg, field);
        if (typeof deps === "object" && deps !== null)
          Object.keys(deps).forEach((n) => declared.add(n));
      }
    }
    expect(declared.size).toBeGreaterThan(0);
    expect([...declared].filter((n) => processorPackage.test(n))).toEqual([]);
  });

  it("resolves no payment processor SDK in the lockfile", () => {
    const resolved = resolvedPackageNames(lock, "packages/auth");
    expect(resolved).toContain("better-auth");
    expect(resolved.filter((n) => processorPackage.test(n))).toEqual([]);
  });

  it("recognizes a processor SDK when one is resolved", () => {
    const fake = [
      "importers:",
      "",
      "  packages/auth:",
      "    dependencies:",
      "      stripe:",
      "        specifier: ^1.0.0",
      "        version: 1.0.0",
      "",
      "snapshots:",
      "",
      "  stripe@1.0.0: {}",
      "",
    ].join("\n");
    expect(
      resolvedPackageNames(fake, "packages/auth").filter((n) => processorPackage.test(n)),
    ).toEqual(["stripe"]);
  });
});
