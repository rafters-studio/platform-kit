import { describe, expect, it } from "vite-plus/test";
import type { BrandFetch } from "../helpers/brand-auth.ts";
import { cookieHeader, twoBrands } from "./harness.ts";

/**
 * NFR-PLATFORM-AUTH-101: two brand deployments built from the same package, one email registered at both.
 * From each brand, try to use the other's session, app password, user id and organization id, and count
 * every attempt that succeeds or returns the other brand's data. The target is 0.
 */

const email = "pat@example.com";

type Harness = ReturnType<typeof twoBrands>;
type Side = Harness["a"];

interface Identity {
  userId: string;
  orgId: string;
  cookie: string;
  appPassword: string;
  fetch: BrandFetch;
}

/** The same person at one brand: signed in, in an organization, holding an app password. */
async function register(side: Side, brand: Harness["brandA"], slug: string): Promise<Identity> {
  const fetch = side.browser();
  await side.signIn(fetch, email);
  const cookie = cookieHeader(fetch.cookies());
  const org = await fetch("/organization/create", { name: slug, slug });
  const made = await fetch("/api-key/create", { name: "mail" });
  const session = await side.auth.api.getSession({
    headers: new Headers({ host: String(brand.rootDomain), "x-forwarded-proto": "https", cookie }),
  });
  return {
    userId: session?.user.id ?? "",
    orgId: String(org.json?.id ?? ""),
    cookie,
    appPassword: String((made.json as unknown as { key: string }).key),
    fetch,
  };
}

/** True when a response succeeded or carries any of the other brand's identifiers. */
function crossed(
  response: { status: number; json: Record<string, unknown> | null },
  foreign: string[],
) {
  const body = JSON.stringify(response.json ?? null);
  return foreign.some((value) => body.includes(value));
}

/** Every attempt `attacker` makes at `victim`'s brand with `victim`'s credentials; returns the successes. */
async function attemptsFrom(
  h: Harness,
  attacker: { side: Side; brand: Harness["brandA"]; me: Identity },
  victim: { them: Identity },
): Promise<string[]> {
  const { me } = attacker;
  const { them } = victim;
  const successes: string[] = [];
  const foreign = [them.userId, them.orgId];

  // The victim's session cookie, presented at the attacker's brand.
  const session = await h.sessionAt(attacker.side, attacker.brand, them.cookie);
  if (session !== null) successes.push("session");

  // The victim's app password, presented at the attacker's brand for the shared email.
  const user = await h.appPasswordAt(attacker.side, attacker.brand, email, them.appPassword);
  if (user !== null) successes.push("app password");

  // The victim's organization id, used by a signed-in user of the attacker's brand.
  for (const path of [
    `/organization/get-full-organization?organizationId=${them.orgId}`,
    `/organization/list-invitations?organizationId=${them.orgId}`,
    `/organization/list-members?organizationId=${them.orgId}`,
  ]) {
    const response = await me.fetch(path);
    if (response.status === 200 && crossed(response, foreign)) successes.push(`org id ${path}`);
  }
  for (const [path, body] of [
    ["/organization/set-active", { organizationId: them.orgId }],
    ["/organization/update", { organizationId: them.orgId, data: { name: "taken" } }],
    ["/organization/delete", { organizationId: them.orgId }],
    [
      "/organization/invite-member",
      { organizationId: them.orgId, email: "x@example.com", role: "member" },
    ],
  ] as const) {
    const response = await me.fetch(path, body);
    if (response.status === 200) successes.push(`org id ${path}`);
  }

  // The victim's user id, used by a signed-in user of the attacker's brand.
  for (const [path, body] of [
    ["/organization/add-member", { userId: them.userId, role: "member", organizationId: me.orgId }],
    [
      "/organization/update-member-role",
      { memberId: them.userId, role: "admin", organizationId: me.orgId },
    ],
    ["/organization/remove-member", { memberIdOrEmail: them.userId, organizationId: me.orgId }],
  ] as const) {
    const response = await me.fetch(path, body);
    if (response.status === 200 && crossed(response, foreign)) successes.push(`user id ${path}`);
  }
  const members = await me.fetch(`/organization/get-full-organization?organizationId=${me.orgId}`);
  if (crossed(members, [them.userId])) successes.push("user id listed as a member");

  // Nothing of the victim's reached the attacker's database.
  for (const [table, ids] of [
    ["user", [them.userId]],
    ["organization", [them.orgId]],
  ] as const) {
    for (const id of ids) {
      const row = attacker.side.db
        .prepare(`select count(*) as n from "${table}" where id = ?`)
        .get(id);
      if ((row as { n: number }).n !== 0)
        successes.push(`${table} row ${id} in the other database`);
    }
  }
  return successes;
}

describe("NFR-PLATFORM-AUTH-101: zero cross-brand successes", () => {
  it("counts no session, app password, user id or organization id that works across brands", async () => {
    const h = twoBrands();
    const inA = await register(h.a, h.brandA, "band-a");
    const inB = await register(h.b, h.brandB, "band-b");

    // The same email is two users.
    expect(inA.userId).not.toBe("");
    expect(inB.userId).not.toBe("");
    expect(inA.userId).not.toBe(inB.userId);

    // Controls: at home each credential works, so a zero below means refusal, not a broken attempt.
    expect((await h.sessionAt(h.a, h.brandA, inA.cookie))?.user.id).toBe(inA.userId);
    expect((await h.sessionAt(h.b, h.brandB, inB.cookie))?.user.id).toBe(inB.userId);
    expect(await h.appPasswordAt(h.a, h.brandA, email, inA.appPassword)).toMatchObject({ email });
    expect(await h.appPasswordAt(h.b, h.brandB, email, inB.appPassword)).toMatchObject({ email });
    expect(
      (await inA.fetch(`/organization/get-full-organization?organizationId=${inA.orgId}`)).status,
    ).toBe(200);
    expect(
      (await inB.fetch(`/organization/get-full-organization?organizationId=${inB.orgId}`)).status,
    ).toBe(200);

    const fromA = await attemptsFrom(h, { side: h.a, brand: h.brandA, me: inA }, { them: inB });
    const fromB = await attemptsFrom(h, { side: h.b, brand: h.brandB, me: inB }, { them: inA });
    const successes = [...fromA.map((s) => `A->B ${s}`), ...fromB.map((s) => `B->A ${s}`)];

    console.log(`cross-brand successes: ${successes.length}`);
    expect(successes).toEqual([]);
    expect(successes.length).toBe(0);
  });
});
