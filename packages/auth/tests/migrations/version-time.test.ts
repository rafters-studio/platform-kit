import { execFileSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vite-plus/test";

const dir = join(dirname(fileURLToPath(import.meta.url)), "../../migrations");
const week = 7 * 24 * 60 * 60 * 1000;

/** `20261008004218` read as a UTC instant, or null when it is not 14 digits. */
export const versionTime = (name: string): number | null => {
  const m = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})_/.exec(name);
  if (!m) return null;
  const [y, mo, d, h, mi, s] = m.slice(1).map(Number);
  return Date.UTC(y!, mo! - 1, d, h, mi, s);
};

/** When the file first entered history (-m also lists merge commits), or now if uncommitted. */
const addedAt = (name: string): number => {
  const out = execFileSync(
    "git",
    ["log", "-m", "--no-renames", "--diff-filter=A", "--format=%cI", "--", join(dir, name)],
    { cwd: dir, encoding: "utf8" },
  )
    .split("\n")
    .filter(Boolean)
    .map((iso) => Date.parse(iso));
  return out.length === 0 ? Date.now() : Math.min(...out);
};

/** The reason a migration's version does not match when it was added, or null. */
export const versionFault = (name: string, added: number): string | null => {
  const version = versionTime(name);
  if (version === null) return `${name}: the version is not a 14 digit UTC time`;
  if (version > added) return `${name}: the version is later than the commit that added it`;
  if (added - version > week) return `${name}: the version is more than 7 days before it was added`;
  return null;
};

describe("a migration's version is the time its file was added", () => {
  it("names a file whose version is later than its commit", () => {
    const added = Date.UTC(2026, 9, 7, 12, 0, 0);
    expect(versionFault("20261007120001_late.json", added)).toContain("20261007120001_late.json");
    expect(versionFault("20261007120001_late.json", added)).toContain("later");
  });

  it("names a file whose version is more than 7 days before its commit", () => {
    const added = Date.UTC(2026, 9, 20, 0, 0, 0);
    expect(versionFault("20261007100000_old.json", added)).toContain("7 days");
  });

  it("accepts a version at or just before the commit", () => {
    const added = Date.UTC(2026, 9, 7, 12, 0, 0);
    expect(versionFault("20261007120000_now.json", added)).toBeNull();
    expect(versionFault("20261006120000_day.json", added)).toBeNull();
  });

  it("holds for every migration on main", () => {
    const faults = readdirSync(dir)
      .filter((n) => n.endsWith(".json"))
      .map((n) => versionFault(n, addedAt(n)))
      .filter((f): f is string => f !== null);
    expect(faults).toEqual([]);
  });
});
