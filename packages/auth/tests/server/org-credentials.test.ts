import type { BrandConfigInput } from "@rafters/platform-contracts";
import { describe, expect, it } from "vite-plus/test";
import { brandAuth, type BrandFetch } from "../helpers/brand-auth.ts";

const brand: BrandConfigInput = {
  id: "bandz",
  rootDomain: "bandz.app",
  sending: { from: "hello@bandz.app" },
  permissions: { budget: ["read", "write"] },
};

async function setup() {
  const harness = brandAuth(brand);
  const owner = harness.browser();
  const pat = harness.browser();
  await harness.signIn(owner, "owner@example.com");
  await harness.signIn(pat, "pat@example.com");
  const made = await owner("/organization/create", { name: "Help", slug: "help" });
  expect(made.status).toBe(200);
  const orgId = made.json?.id as string;
  const userId = (email: string) =>
    (harness.db.prepare(`select id from "user" where email = ?`).get(email) as { id: string }).id;
  const join = (email: string, role: string) =>
    harness.db
      .prepare(
        `insert into "member" (id, organizationId, userId, role, createdAt) values (?, ?, ?, ?, ?)`,
      )
      .run(crypto.randomUUID(), orgId, userId(email), role, new Date().toISOString());
  const api = harness.auth.api as unknown as {
    verifyOrganizationCredential(input: {
      body: { key: string; permissions?: Record<string, string[]> };
      headers: Headers;
    }): Promise<{ organizationId: string }>;
  };
  const check = (key: string, permissions?: Record<string, string[]>) =>
    api
      .verifyOrganizationCredential({
        body: { key, ...(permissions ? { permissions } : {}) },
        headers: new Headers({ host: "bandz.app", "x-forwarded-proto": "https" }),
      })
      .then(
        (result) => result.organizationId,
        () => null,
      );
  const create = async (fetch: BrandFetch, permissions: Record<string, string[]>) => {
    const res = await fetch("/organization-credential/create", {
      organizationId: orgId,
      name: "helpdesk",
      permissions,
    });
    return { status: res.status, ...(res.json as { id: string; key: string }) };
  };
  return { ...harness, owner, pat, orgId, join, userId, check, create };
}

describe("organization credentials", () => {
  it("keep working after the member who created them leaves", async () => {
    const { owner, pat, orgId, join, check, create } = await setup();
    join("pat@example.com", "admin");
    const credential = await create(pat, { budget: ["read"] });
    expect(credential.status).toBe(200);
    expect(await check(credential.key)).toBe(orgId);
    const removed = await owner("/organization/remove-member", {
      organizationId: orgId,
      memberIdOrEmail: "pat@example.com",
    });
    expect(removed.status).toBe(200);
    expect(await check(credential.key)).toBe(orgId);
  });

  it("are refused for a permission they were not given", async () => {
    const { owner, check, create } = await setup();
    const credential = await create(owner, { budget: ["read"] });
    expect(await check(credential.key, { budget: ["read"] })).not.toBeNull();
    expect(await check(credential.key, { budget: ["write"] })).toBeNull();
    expect(await check(credential.key, { user: ["read"] })).toBeNull();
  });

  it("cannot be given a permission outside the brand's vocabulary", async () => {
    const { owner, create } = await setup();
    expect((await create(owner, { budget: ["delete"] })).status).toBe(400);
    expect((await create(owner, { nothing: ["read"] })).status).toBe(400);
  });

  it("no longer authenticate once revoked", async () => {
    const { owner, orgId, check, create } = await setup();
    const credential = await create(owner, { budget: ["read"] });
    expect(await check(credential.key)).toBe(orgId);
    const revoked = await owner("/api-key/delete", {
      keyId: credential.id,
      configId: "organization",
    });
    expect(revoked.status).toBe(200);
    expect(await check(credential.key)).toBeNull();
  });

  it("are listed and revoked only by roles that hold the apiKey permission", async () => {
    const { owner, pat, orgId, join, create } = await setup();
    const credential = await create(owner, { budget: ["read"] });
    join("pat@example.com", "member");
    expect((await create(pat, { budget: ["read"] })).status).toBe(403);
    expect((await pat(`/api-key/list?organizationId=${orgId}`)).status).toBe(403);
    expect(
      (await pat("/api-key/delete", { keyId: credential.id, configId: "organization" })).status,
    ).toBe(403);
    const listed = await owner(`/api-key/list?organizationId=${orgId}`);
    expect(listed.status).toBe(200);
    expect((listed.json as unknown as { apiKeys: unknown[] }).apiKeys).toHaveLength(1);
  });

  it("stop authenticating when their organization is deleted", async () => {
    const { owner, orgId, check, create } = await setup();
    const credential = await create(owner, { budget: ["read"] });
    expect((await owner("/organization/delete", { organizationId: orgId })).status).toBe(200);
    expect(await check(credential.key)).toBeNull();
  });

  it("are not accepted from an app password", async () => {
    const { owner, check } = await setup();
    const app = await owner("/api-key/create", { name: "phone" });
    expect(await check((app.json as { key: string }).key)).toBeNull();
  });
});
