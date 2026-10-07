import type { BrandConfigInput } from "@rafters/platform-contracts";
import { describe, expect, it } from "vite-plus/test";
import { brandAuth, type BrandFetch } from "../helpers/brand-auth.ts";

const brand: BrandConfigInput = {
  id: "bands",
  rootDomain: "bands.app",
  sending: { from: "hello@bands.app" },
  permissions: { budget: ["read"] },
};

async function create(fetch: BrandFetch, name: string) {
  const made = await fetch("/api-key/create", { name });
  expect(made.status).toBe(200);
  return made.json as { id: string; key: string; name: string; permissions: unknown };
}

async function setup() {
  const harness = brandAuth(brand);
  const pat = harness.browser();
  await harness.signIn(pat, "pat@example.com");
  // authOptions returns plain options, so better-auth's inferred api type does not list plugin endpoints.
  const api = harness.auth.api as unknown as {
    verifyAppPassword(input: {
      body: { email: string; password: string };
      headers: Headers;
    }): Promise<{ user: { email: string } }>;
  };
  const check = (email: string, password: string) =>
    api
      .verifyAppPassword({
        body: { email, password },
        headers: new Headers({ host: "bands.app", "x-forwarded-proto": "https" }),
      })
      .then(
        (result) => result.user,
        () => null,
      );
  return { ...harness, pat, check };
}

describe("app passwords", () => {
  it("are created by a signed-in user with a name, and the value is shown only at creation", async () => {
    const { pat } = await setup();
    const made = await create(pat, "mail on my phone");
    expect(made.name).toBe("mail on my phone");
    expect(made.key.length).toBeGreaterThan(20);

    const listed = await pat("/api-key/list");
    expect(listed.status).toBe(200);
    const keys = (listed.json as unknown as { apiKeys: Record<string, unknown>[] }).apiKeys;
    expect(keys).toHaveLength(1);
    expect(JSON.stringify(keys)).not.toContain(made.key);
    expect(keys[0]).not.toHaveProperty("key");
  });

  it("need a name and a signed-in user", async () => {
    const { pat, browser } = await setup();
    expect((await pat("/api-key/create", {})).status).toBe(400);
    expect((await browser()("/api-key/create", { name: "mail" })).status).toBe(401);
  });

  it("are stored in a form that does not reveal them", async () => {
    const { pat, db } = await setup();
    const made = await create(pat, "mail");
    const rows = db.prepare(`select * from "apikey"`).all();
    expect(rows).toHaveLength(1);
    expect(JSON.stringify(rows)).not.toContain(made.key);
    expect(rows[0]?.key).not.toBe(made.key);
  });

  it("verify with the user's email, and carry the IMAP permission", async () => {
    const { pat, check } = await setup();
    const made = await create(pat, "mail");
    expect(made.permissions).toEqual({ imap: ["connect"] });
    expect(await check("pat@example.com", made.key)).toMatchObject({ email: "pat@example.com" });
    expect(await check("PAT@example.com", made.key)).toMatchObject({ email: "pat@example.com" });
  });

  it("do not verify for another user's email, an unknown email, or a wrong value", async () => {
    const { pat, signIn, browser, check } = await setup();
    await signIn(browser(), "sam@example.com");
    const made = await create(pat, "mail");
    expect(await check("sam@example.com", made.key)).toBeNull();
    expect(await check("nobody@example.com", made.key)).toBeNull();
    expect(await check("pat@example.com", `${made.key}x`)).toBeNull();
  });

  it("do not verify without the IMAP permission", async () => {
    const { pat, db, check } = await setup();
    const made = await create(pat, "mail");
    db.prepare(`update "apikey" set "permissions" = ? where "id" = ?`).run(
      JSON.stringify({ other: ["read"] }),
      made.id,
    );
    expect(await check("pat@example.com", made.key)).toBeNull();
  });

  it("revoke one at a time, leaving the user's others working", async () => {
    const { pat, check } = await setup();
    const phone = await create(pat, "phone");
    const laptop = await create(pat, "laptop");
    expect((await pat("/api-key/delete", { keyId: phone.id })).status).toBe(200);
    expect(await check("pat@example.com", phone.key)).toBeNull();
    expect(await check("pat@example.com", laptop.key)).toMatchObject({ email: "pat@example.com" });
    const listed = await pat("/api-key/list");
    expect(
      (listed.json as unknown as { apiKeys: { id: string }[] }).apiKeys.map((k) => k.id),
    ).toEqual([laptop.id]);
  });

  it("verify as often as a mail app logs in", async () => {
    const { pat, check } = await setup();
    const made = await create(pat, "mail");
    for (let i = 0; i < 25; i++) {
      expect(await check("pat@example.com", made.key)).not.toBeNull();
    }
  });

  it("cannot be checked over HTTP", async () => {
    const { pat, browser } = await setup();
    const made = await create(pat, "mail");
    const over = await browser()("/app-password/verify", {
      email: "pat@example.com",
      password: made.key,
    });
    expect(over.status).toBe(404);
  });

  it("never sign in to the brand", async () => {
    const { pat, auth, browser } = await setup();
    const made = await create(pat, "mail");
    const headers = new Headers({
      "x-api-key": made.key,
      host: "bands.app",
      "x-forwarded-proto": "https",
    });
    expect(await auth.api.getSession({ headers })).toBeNull();
    const bearerHeaders = new Headers({
      authorization: `Bearer ${made.key}`,
      host: "bands.app",
      "x-forwarded-proto": "https",
    });
    expect(await auth.api.getSession({ headers: bearerHeaders })).toBeNull();
    const web = browser();
    expect(
      (await web("/sign-in/email-otp", { email: "pat@example.com", otp: made.key })).status,
    ).not.toBe(200);
    expect((await web("/get-session")).json).toBeNull();
  });
});

describe("email and password", () => {
  it("is not exposed for sign-up or sign-in", async () => {
    const { browser } = brandAuth(brand);
    const fetch = browser();
    const up = await fetch("/sign-up/email", {
      email: "pat@example.com",
      password: "correct horse battery",
      name: "Pat",
    });
    const inn = await fetch("/sign-in/email", {
      email: "pat@example.com",
      password: "correct horse battery",
    });
    expect([up.status, inn.status]).toEqual([400, 400]);
    expect(up.json?.message).toMatch(/not enabled/i);
  });
});
