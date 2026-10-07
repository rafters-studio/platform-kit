import type { BrandConfigInput } from "@rafters/platform-contracts";
import { describe, expect, it } from "vite-plus/test";
import { seedStaffOrganization } from "../../src/server/index.ts";
import { STAFF_ROLE_NAMES, staffOrganizationSlug } from "../../src/shared/index.ts";
import { brandAuth } from "../helpers/brand-auth.ts";

const brand: BrandConfigInput = {
  id: "bands",
  rootDomain: "bands.app",
  sending: { from: "hello@bands.app" },
  permissions: { budget: ["read", "write"] },
};

type Rows = { role: string; permission: string }[];

/** A seeded staff organization with sam as super and pat as a plain staff member holding `patRole`. */
async function staff(options: { teams?: boolean; patRole?: string } = {}) {
  const harness = brandAuth({ ...brand, plugins: { teams: options.teams ?? false } });
  const sam = harness.browser();
  const pat = harness.browser();
  await harness.signIn(sam, "sam@example.com");
  await harness.signIn(pat, "pat@example.com");
  expect(
    await seedStaffOrganization(harness.auth, { id: "bands", permissions: brand.permissions }),
  ).toBe(true);
  const org = harness.db
    .prepare(`select id from "organization" where slug = ?`)
    .get(staffOrganizationSlug({ id: "bands" })) as { id: string };
  const join = (email: string, role: string) => {
    const user = harness.db.prepare(`select id from "user" where email = ?`).get(email) as {
      id: string;
    };
    harness.db
      .prepare(
        `insert into "member" (id, organizationId, userId, role, createdAt) values (?, ?, ?, ?, ?)`,
      )
      .run(crypto.randomUUID(), org.id, user.id, role, new Date().toISOString());
  };
  join("sam@example.com", "super");
  join("pat@example.com", options.patRole ?? "support");
  const can = async (fetch: typeof pat, permissions: Record<string, string[]>) =>
    (await fetch("/organization/has-permission", { organizationId: org.id, permissions })).json
      ?.success === true;
  const roleRows = () =>
    harness.db
      .prepare(`select role, permission from "organizationRole" where organizationId = ?`)
      .all(org.id) as Rows;
  return { ...harness, sam, pat, org, can, roleRows };
}

describe("staff roles", () => {
  it("starts a new brand's staff organization with the seven default roles as rows", async () => {
    const { roleRows } = await staff();
    expect(
      roleRows()
        .map((row) => row.role)
        .sort(),
    ).toEqual([...STAFF_ROLE_NAMES].sort());
    const billing = roleRows().find((row) => row.role === "billing");
    expect(JSON.parse(billing?.permission ?? "{}")).toEqual({
      subscription: ["read", "update"],
      invoice: ["read", "update"],
    });
  });

  it("seeds once and never puts back a role the brand removed", async () => {
    const { auth, sam, org, roleRows } = await staff();
    expect(
      (await sam("/organization/delete-role", { organizationId: org.id, roleName: "auditor" }))
        .status,
    ).toBe(200);
    expect(await seedStaffOrganization(auth, { id: "bands", permissions: brand.permissions })).toBe(
      false,
    );
    expect(roleRows().map((row) => row.role)).not.toContain("auditor");
  });

  it("keeps the staff slug out of reach of an ordinary organization", async () => {
    const { sam } = await staff();
    const claimed = await sam("/organization/create", { name: "Mine", slug: "bands-staff" });
    expect(claimed.status).toBe(400);
  });
});

describe("roles at runtime", () => {
  it("lets super add a role, and the change governs the next permission check", async () => {
    const { sam, pat, org, can, db } = await staff({ patRole: "support" });
    expect(await can(pat, { budget: ["read"] })).toBe(false);

    const added = await sam("/organization/create-role", {
      organizationId: org.id,
      role: "bookkeeper",
      permission: { budget: ["read"] },
    });
    expect(added.status).toBe(200);
    db.prepare(
      `update "member" set role = 'bookkeeper' where organizationId = ? and role = 'support'`,
    ).run(org.id);
    expect(await can(pat, { budget: ["read"] })).toBe(true);
    expect(await can(pat, { budget: ["write"] })).toBe(false);
  });

  it("holds against the per-isolate cache when a role is changed and then removed", async () => {
    const { sam, pat, org, can, db } = await staff({ patRole: "support" });
    await sam("/organization/create-role", {
      organizationId: org.id,
      role: "bookkeeper",
      permission: { budget: ["read", "write"] },
    });
    db.prepare(
      `update "member" set role = 'bookkeeper' where organizationId = ? and role = 'support'`,
    ).run(org.id);
    expect(await can(pat, { budget: ["write"] })).toBe(true);

    const changed = await sam("/organization/update-role", {
      organizationId: org.id,
      roleName: "bookkeeper",
      data: { permission: { budget: ["read"] } },
    });
    expect(changed.status).toBe(200);
    expect(await can(pat, { budget: ["write"] })).toBe(false);
    expect(await can(pat, { budget: ["read"] })).toBe(true);

    db.prepare(
      `update "member" set role = 'support' where organizationId = ? and role = 'bookkeeper'`,
    ).run(org.id);
    const removed = await sam("/organization/delete-role", {
      organizationId: org.id,
      roleName: "bookkeeper",
    });
    expect(removed.status).toBe(200);
    expect(await can(pat, { budget: ["read"] })).toBe(false);
  });

  it("changes a seeded role the same way", async () => {
    const { sam, pat, org, can } = await staff({ patRole: "support" });
    expect(await can(pat, { audit: ["read"] })).toBe(true);
    const changed = await sam("/organization/update-role", {
      organizationId: org.id,
      roleName: "support",
      data: { permission: { user: ["read"] } },
    });
    expect(changed.status).toBe(200);
    expect(await can(pat, { audit: ["read"] })).toBe(false);
  });

  it("refuses a role from someone who lacks the permission to manage roles", async () => {
    const { pat, org } = await staff({ patRole: "support" });
    const refused = await pat("/organization/create-role", {
      organizationId: org.id,
      role: "sneaky",
      permission: { user: ["read"] },
    });
    expect(refused.status).toBe(403);
  });

  it("refuses a role that grants a permission outside the brand's vocabulary", async () => {
    const { sam, org, roleRows } = await staff();
    const before = roleRows().length;
    for (const permission of [
      { payroll: ["read"] },
      { budget: ["delete"] },
      { constructor: ["read"] },
    ]) {
      const refused = await sam("/organization/create-role", {
        organizationId: org.id,
        role: "outside",
        permission,
      });
      expect(refused.status).toBe(400);
    }
    const updated = await sam("/organization/update-role", {
      organizationId: org.id,
      roleName: "billing",
      data: { permission: { invoice: ["burn"] } },
    });
    expect(updated.status).toBe(400);
    expect(roleRows()).toHaveLength(before);
  });
});

describe("organization roles", () => {
  it("are stored per organization and checked from the database", async () => {
    const harness = brandAuth(brand);
    const pat = harness.browser();
    await harness.signIn(pat, "pat@example.com");
    const one = await pat("/organization/create", { name: "One", slug: "one" });
    const two = await pat("/organization/create", { name: "Two", slug: "two" });
    const role = (organizationId: unknown) =>
      pat("/organization/create-role", {
        organizationId,
        role: "treasurer",
        permission: { budget: ["read"] },
      });
    expect((await role(one.json?.id)).status).toBe(200);
    // The same name is free in another organization: roles belong to one organization each.
    expect((await role(two.json?.id)).status).toBe(200);
    expect(
      (
        await pat("/organization/delete-role", {
          organizationId: one.json?.id,
          roleName: "treasurer",
        })
      ).status,
    ).toBe(200);
    const rows = harness.db
      .prepare(`select organizationId, role from "organizationRole"`)
      .all() as { organizationId: string; role: string }[];
    expect(rows).toEqual([{ organizationId: two.json?.id, role: "treasurer" }]);
  });
});

describe("teams", () => {
  it("are unavailable unless the brand turns them on", async () => {
    const off = await staff({ teams: false });
    const refused = await off.sam("/organization/create-team", {
      organizationId: off.org.id,
      name: "Night shift",
    });
    expect(refused.status).toBe(404);

    const on = await staff({ teams: true });
    const created = await on.sam("/organization/create-team", {
      organizationId: on.org.id,
      name: "Night shift",
    });
    expect(created.status).toBe(200);
  });
});
