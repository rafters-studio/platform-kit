// Writes a legion requirement's verification.scenarios to a Gherkin feature file.
// Usage: node scripts/features.mjs <requirement-id> <feature path>
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Renders the feature file text for one `legion document view <id> --json` row.
 * The same row always renders the same bytes.
 */
export function renderFeature(row) {
  const payload = typeof row.payload === "string" ? JSON.parse(row.payload) : row.payload;
  const scenarios = payload?.verification?.scenarios;
  if (!Array.isArray(scenarios) || scenarios.length === 0) {
    throw new Error(`${row.id} has no verification.scenarios`);
  }
  const header = [
    `# Generated from legion requirement ${row.id}, revision ${row.updated_at}.`,
    "# Do not edit: regenerate with scripts/features.mjs.",
  ];
  const blocks = scenarios.map((scenario) => scenario.gherkin.trim().replace(/^/gm, "  "));
  return `${header.join("\n")}\n\nFeature: ${payload.title}\n\n${blocks.join("\n\n")}\n`;
}

function main(argv) {
  const [id, path] = argv;
  if (!id || !path) {
    throw new Error("usage: node scripts/features.mjs <requirement-id> <feature path>");
  }
  const json = execFileSync("legion", ["document", "view", id, "--json"], { encoding: "utf8" });
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, renderFeature(JSON.parse(json)));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2));
}
