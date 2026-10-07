import type { BrandConfigInput } from "@rafters/platform-contracts";
import { describe, expect, it } from "vite-plus/test";
import { brandAuth } from "../helpers/brand-auth.ts";

const brand: BrandConfigInput = {
  id: "bands",
  rootDomain: "bands.app",
  sending: { from: "hello@bands.app" },
  permissions: { budget: ["read"] },
};

const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe("every id a flow creates", () => {
  it("parses as a version-7 UUID across sign-up, sign-in, app password, and organization", async () => {
    const { db, browser, signIn } = brandAuth(brand);
    const pat = browser();
    await signIn(pat, "pat@example.com"); // sign-up: first sign-in creates the user
    const again = browser();
    await signIn(again, "pat@example.com"); // sign-in: a second session for the same user
    expect((await pat("/api-key/create", { name: "mail" })).status).toBe(200);
    const org = await pat("/organization/create", { name: "Duo", slug: "duo" });
    expect(org.status).toBe(200);
    expect(
      (
        await pat("/organization/invite-member", {
          email: "sam@example.com",
          role: "member",
          organizationId: org.json?.id,
        })
      ).status,
    ).toBe(200);

    const tables = [
      "user",
      "session",
      "verification",
      "apikey",
      "organization",
      "member",
      "invitation",
    ];
    const seen: Record<string, number> = {};
    for (const table of tables) {
      const rows = db.prepare(`select "id" from "${table}"`).all();
      seen[table] = rows.length;
      for (const row of rows) expect(String(row.id), `${table}.id`).toMatch(UUID_V7);
    }
    // The flows really created rows in the tables that matter, so the loop above was not vacuous.
    for (const table of ["user", "session", "apikey", "organization", "member", "invitation"]) {
      expect(seen[table], table).toBeGreaterThan(0);
    }
  });
});
