import { readFileSync } from "node:fs";
import { describe, expect, it } from "vite-plus/test";
// @ts-expect-error -- plain ESM script with no type declarations
import { renderFeature } from "../../scripts/features.mjs";

const row = JSON.parse(
  readFileSync(new URL("./requirement.fixture.json", import.meta.url), "utf8"),
);
const payload = JSON.parse(row.payload);

describe("scripts/features.mjs", () => {
  const text: string = renderFeature(row);

  it("starts with a header naming the requirement id and revision", () => {
    const [first, second] = text.split("\n");
    expect(first).toContain(row.id);
    expect(first).toContain(row.updated_at);
    expect(first?.startsWith("#")).toBe(true);
    expect(second).toMatch(/Do not edit/);
  });

  it("follows the header with the Feature line", () => {
    expect(text).toContain(`\n\nFeature: ${payload.title}\n`);
  });

  it("writes every scenario in criteria order", () => {
    const tags = [...text.matchAll(/@criterion-(\S+)/g)].map((m) => m[1]);
    expect(tags).toEqual(payload.verification.criteria.map((c: { id: string }) => c.id));
    for (const scenario of payload.verification.scenarios) {
      expect(text).toContain(scenario.gherkin.split("\n")[1]);
    }
  });

  it("produces identical bytes on a second run", () => {
    expect(renderFeature(row)).toBe(text);
  });

  it("refuses a requirement with no scenarios", () => {
    expect(() => renderFeature({ id: "X", updated_at: "t", payload: { title: "T" } })).toThrow();
  });
});
