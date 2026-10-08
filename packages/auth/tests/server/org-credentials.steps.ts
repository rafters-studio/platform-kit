import assert from "node:assert/strict";
import { Given, Then, When } from "@cucumber/cucumber";
import { brandAuth, type BrandFetch } from "../helpers/brand-auth.ts";

const brand = {
  id: "bandz",
  rootDomain: "bandz.app",
  sending: { from: "hello@bandz.app" },
  permissions: { budget: ["read", "write"] },
};

type Harness = ReturnType<typeof brandAuth>;

interface World {
  harness: Harness;
  owner: BrandFetch;
  member: BrandFetch;
  organizationId: string;
  credential: { id: string; key: string };
  given: Record<string, string[]>;
  outcome: { organizationId: string } | null;
}

/** A service presenting a key to the server-side check, as the helpdesk's host would. */
async function present(
  world: World,
  key: string,
  permissions?: Record<string, string[]>,
): Promise<{ organizationId: string } | null> {
  const api = world.harness.auth.api as unknown as {
    verifyOrganizationCredential(input: {
      body: { key: string; permissions?: Record<string, string[]> };
      headers: Headers;
    }): Promise<{ organizationId: string }>;
  };
  return api
    .verifyOrganizationCredential({
      body: { key, ...(permissions ? { permissions } : {}) },
      headers: new Headers({ host: "bandz.app", "x-forwarded-proto": "https" }),
    })
    .then(
      (result) => result,
      () => null,
    );
}

async function createCredential(
  world: World,
  by: BrandFetch,
  permissions: Record<string, string[]>,
) {
  const made = await by("/organization-credential/create", {
    organizationId: world.organizationId,
    name: "helpdesk",
    permissions,
  });
  assert.equal(made.status, 200);
  world.credential = made.json as unknown as { id: string; key: string };
}

/** An organization with an owner and a second member who is an admin, which holds the apiKey permissions. */
async function organizationWithMember(world: World) {
  world.harness = brandAuth(brand);
  world.owner = world.harness.browser();
  world.member = world.harness.browser();
  await world.harness.signIn(world.owner, "owner@example.com");
  await world.harness.signIn(world.member, "pat@example.com");
  const made = await world.owner("/organization/create", { name: "Help", slug: "help" });
  assert.equal(made.status, 200);
  world.organizationId = made.json?.id as string;
  const user = world.harness.db
    .prepare(`select id from "user" where email = ?`)
    .get("pat@example.com") as { id: string };
  world.harness.db
    .prepare(
      `insert into "member" (id, organizationId, userId, role, createdAt) values (?, ?, ?, ?, ?)`,
    )
    .run(crypto.randomUUID(), world.organizationId, user.id, "admin", new Date().toISOString());
}

Given(
  "an organization with a member who is permitted to create organization credentials",
  async function (this: World) {
    await organizationWithMember(this);
  },
);

Given("that member has created an organization credential", async function (this: World) {
  await createCredential(this, this.member, { budget: ["read"] });
});

When("the member leaves the organization", async function (this: World) {
  const left = await this.owner("/organization/remove-member", {
    organizationId: this.organizationId,
    memberIdOrEmail: "pat@example.com",
  });
  assert.equal(left.status, 200);
  const rows = this.harness.db
    .prepare(
      `select m.id from "member" m join "user" u on u.id = m.userId where m.organizationId = ? and u.email = ?`,
    )
    .all(this.organizationId, "pat@example.com");
  assert.equal(rows.length, 0);
});

When("a service makes a request with that organization credential", async function (this: World) {
  this.outcome = await present(this, this.credential.key);
});

Then("the request is authenticated as the organization", function (this: World) {
  assert.equal(this.outcome?.organizationId, this.organizationId);
});

Given(
  "an organization credential that was given some permissions and not others",
  async function (this: World) {
    await organizationWithMember(this);
    this.given = { budget: ["read"] };
    await createCredential(this, this.owner, this.given);
    assert.ok(await present(this, this.credential.key, this.given));
  },
);

When(
  "a service uses that credential to attempt an action requiring a permission it was not given",
  async function (this: World) {
    this.outcome = await present(this, this.credential.key, { budget: ["write"] });
  },
);

Then("the action is refused", function (this: World) {
  assert.equal(this.outcome, null);
});

Given("an organization credential that authenticates", async function (this: World) {
  await organizationWithMember(this);
  await createCredential(this, this.owner, { budget: ["read"] });
  assert.equal((await present(this, this.credential.key))?.organizationId, this.organizationId);
});

When("the credential is revoked", async function (this: World) {
  const revoked = await this.owner("/api-key/delete", {
    keyId: this.credential.id,
    configId: "organization",
  });
  assert.equal(revoked.status, 200);
});

When("a service makes a request with the revoked credential", async function (this: World) {
  this.outcome = await present(this, this.credential.key);
});

Then("the request is not authenticated", function (this: World) {
  assert.equal(this.outcome, null);
});
