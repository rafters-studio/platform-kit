import type { BrandConfigInput } from "@rafters/platform-contracts";
import { describe, expect, it } from "vite-plus/test";
import { brandAuth, type BrandFetch } from "../helpers/brand-auth.ts";
import { SoftwarePasskey } from "../helpers/webauthn.ts";

const brands: BrandConfigInput[] = [
  {
    id: "bandz",
    rootDomain: "bandz.app",
    sending: { from: "hello@bandz.app" },
    permissions: { budget: ["read"] },
  },
  {
    id: "rafters",
    rootDomain: "rafters.studio",
    sending: { from: "hello@rafters.studio" },
    permissions: { project: ["edit"] },
  },
];

const userId = async (fetch: BrandFetch) => {
  const session = await fetch("/get-session");
  const user = session.json?.user;
  return typeof user === "object" && user !== null && "id" in user ? String(user.id) : null;
};

describe.each(brands)("one identity across $rootDomain", (brand) => {
  const a = `a.${brand.rootDomain}`;
  const b = `b.${brand.rootDomain}`;

  it("signs the user in on b after signing in on a, without signing in again", async () => {
    const { browser, signIn } = brandAuth(brand);
    const visitor = browser();
    await signIn(visitor.at(a), "pat@example.com");

    const onA = await userId(visitor.at(a));
    expect(onA).not.toBeNull();
    expect(await userId(visitor.at(b))).toBe(onA);
    expect(await userId(visitor.at(String(brand.rootDomain)))).toBe(onA);
    // The session cookie is scoped to the root domain, not to a.
    const domains = [...visitor.cookies().values()].map((cookie) => cookie.domain);
    expect(domains).toContain(brand.rootDomain);
    expect(domains).not.toContain(a);
  });

  it("signs the user in on b with a passkey registered on a", async () => {
    const { browser, signIn } = brandAuth(brand);
    const passkey = new SoftwarePasskey(String(brand.rootDomain));

    const owner = browser();
    await signIn(owner.at(a), "sam@example.com");
    const ownerId = await userId(owner.at(a));
    const options = await owner.at(a)("/passkey/generate-register-options");
    expect(options.status).toBe(200);
    const registered = await owner.at(a)("/passkey/verify-registration", {
      response: passkey.register(String(options.json?.challenge), `https://${a}`),
    });
    expect(registered.status).toBe(200);

    // A different browser, on the other subdomain, with no session.
    const visitor = browser().at(b);
    const challenge = await visitor("/passkey/generate-authenticate-options");
    expect(challenge.status).toBe(200);
    const signedIn = await visitor("/passkey/verify-authentication", {
      response: passkey.authenticate(String(challenge.json?.challenge), `https://${b}`),
    });
    expect(signedIn.status).toBe(200);
    expect(await userId(visitor)).toBe(ownerId);
  });

  it("refuses a page on another site that calls the brand's auth", async () => {
    const { browser, signIn } = brandAuth(brand);
    const passkey = new SoftwarePasskey(String(brand.rootDomain));
    const owner = browser();
    await signIn(owner.at(a), "sam@example.com");
    const options = await owner.at(a)("/passkey/generate-register-options");
    await owner.at(a)("/passkey/verify-registration", {
      response: passkey.register(String(options.json?.challenge), `https://${a}`),
    });

    const foreign = `https://${brand.rootDomain}.evil.example`;
    const outsider = browser().at(b, foreign);
    const challenge = await outsider("/passkey/generate-authenticate-options");
    const signedIn = await outsider("/passkey/verify-authentication", {
      response: passkey.authenticate(String(challenge.json?.challenge), foreign),
    });
    expect(signedIn.status).not.toBe(200);
    expect(await userId(browser().at(b))).toBeNull();
  });

  it("refuses a host outside the root domain", async () => {
    const { browser } = brandAuth(brand);
    await expect(browser().at(`${brand.rootDomain}.evil.example`)("/get-session")).rejects.toThrow(
      /not in the allowed hosts list/,
    );
  });
});
