import type { BrandConfigInput } from "@rafters/platform-contracts";
import { describe, expect, it } from "vite-plus/test";
import { brandAuth } from "../helpers/brand-auth.ts";

const brand: BrandConfigInput = {
  id: "bandz",
  rootDomain: "bandz.app",
  sending: { from: "hello@bandz.app" },
  permissions: { budget: ["read"] },
};

async function twoUsers() {
  const harness = brandAuth(brand);
  const pat = harness.browser();
  const sam = harness.browser();
  await harness.signIn(pat, "pat@example.com");
  await harness.signIn(sam, "sam@example.com");
  return { ...harness, pat, sam };
}

describe("organizations", () => {
  it("makes the creator the first member, an owner", async () => {
    const { pat } = await twoUsers();
    const created = await pat("/organization/create", { name: "Pat and Sam", slug: "pat-sam" });
    expect(created.status).toBe(200);
    expect(created.json?.members).toMatchObject([{ role: "owner" }]);
  });

  it("lets a user belong to several organizations at once, with a role in each", async () => {
    const { pat, sam, sender } = await twoUsers();
    const first = await pat("/organization/create", { name: "Duo", slug: "duo" });
    const second = await sam("/organization/create", { name: "Trio", slug: "trio" });
    const invited = await sam("/organization/invite-member", {
      email: "pat@example.com",
      role: "admin",
      organizationId: second.json?.id,
    });
    expect(invited.status).toBe(200);
    const invitation = sender.requests.at(-1)?.message;
    expect(invitation?.kind).toBe("invitation");
    expect(
      (
        await pat("/organization/accept-invitation", {
          invitationId: (invited.json as { id: string }).id,
        })
      ).status,
    ).toBe(200);

    const list = await pat("/organization/list");
    expect(list.status).toBe(200);
    expect((list.json as unknown as { id: string }[]).map((o) => o.id).sort()).toEqual(
      [first.json?.id, second.json?.id].sort(),
    );
    const roles = await Promise.all(
      [first.json?.id, second.json?.id].map(async (id) => {
        const full = await pat(`/organization/get-full-organization?organizationId=${id}`);
        const members = (
          full.json as unknown as { members: { role: string; user: { email: string } }[] }
        ).members;
        return members.find((m) => m.user.email === "pat@example.com")?.role;
      }),
    );
    expect(roles).toEqual(["owner", "admin"]);
  });

  it("lets a member read the members and invitations, and refuses a non-member", async () => {
    const { pat, sam } = await twoUsers();
    const org = await pat("/organization/create", { name: "Duo", slug: "duo" });
    await pat("/organization/invite-member", {
      email: "lee@example.com",
      role: "member",
      organizationId: org.json?.id,
    });
    const url = `?organizationId=${org.json?.id}`;
    const full = await pat(`/organization/get-full-organization${url}`);
    expect(full.status).toBe(200);
    expect(full.json?.members).toHaveLength(1);
    expect(full.json?.invitations).toHaveLength(1);
    expect((await pat(`/organization/list-invitations${url}`)).status).toBe(200);

    for (const path of ["get-full-organization", "list-invitations"]) {
      const refused = await sam(`/organization/${path}${url}`);
      expect(refused.status).toBeGreaterThanOrEqual(400);
      expect(JSON.stringify(refused.json)).not.toContain("lee@example.com");
    }
    expect((await sam("/organization/list")).json).toEqual([]);
  });

  it("never sends an invitation for an organization named with a line break", async () => {
    const { pat, sender } = await twoUsers();
    const org = await pat("/organization/create", {
      name: "Duo\r\nBcc: victim@example.com",
      slug: "duo",
    });
    const before = sender.requests.length;
    // better-auth sends the invitation in the background, so the request itself answers 200.
    await pat("/organization/invite-member", {
      email: "lee@example.com",
      role: "member",
      organizationId: org.json?.id,
    });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(sender.requests.length).toBe(before);
  });
});
