import type { BrandConfigInput } from "@rafters/platform-contracts";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { CODE_LIFETIME_SECONDS } from "../../src/server/send.ts";
import { brandAuth } from "../helpers/brand-auth.ts";
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

afterEach(() => {
  vi.useRealTimers();
});

describe.each(brands)("sign-in on $id", (brand) => {
  it("sends a code by email through the sender and signs the user in with it", async () => {
    const { sender, browser, requestCode } = brandAuth(brand);
    const fetch = browser();
    const code = await requestCode(fetch, "pat@example.com");

    expect(sender.requests[0]).toMatchObject({
      brand: { id: brand.id, from: brand.sending.from },
      recipient: { channel: "email", to: "pat@example.com" },
    });
    expect(
      (await fetch("/sign-in/email-otp", { email: "pat@example.com", otp: code })).status,
    ).toBe(200);
    const session = await fetch("/get-session");
    expect(session.json?.user).toMatchObject({ email: "pat@example.com" });
  });

  it("refuses a code that was already used", async () => {
    const { browser, requestCode } = brandAuth(brand);
    const first = browser();
    const code = await requestCode(first, "pat@example.com");
    expect(
      (await first("/sign-in/email-otp", { email: "pat@example.com", otp: code })).status,
    ).toBe(200);

    const second = browser();
    expect(
      (await second("/sign-in/email-otp", { email: "pat@example.com", otp: code })).status,
    ).not.toBe(200);
    expect((await second("/get-session")).json).toBeNull();
  });

  it("refuses an expired code", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const { browser, requestCode } = brandAuth(brand);
    const fetch = browser();
    const code = await requestCode(fetch, "pat@example.com");

    vi.setSystemTime(Date.now() + (CODE_LIFETIME_SECONDS + 1) * 1000);
    expect(
      (await fetch("/sign-in/email-otp", { email: "pat@example.com", otp: code })).status,
    ).not.toBe(200);
    expect((await fetch("/get-session")).json).toBeNull();
  });

  it("registers a passkey and signs in with it", async () => {
    const { browser, requestCode } = brandAuth(brand);
    const origin = `https://${brand.rootDomain}`;
    const passkey = new SoftwarePasskey(brand.rootDomain);

    // Sign up with an email code, then register a passkey on that fresh session.
    const owner = browser();
    const code = await requestCode(owner, "sam@example.com");
    expect(
      (await owner("/sign-in/email-otp", { email: "sam@example.com", otp: code })).status,
    ).toBe(200);
    const registration = await owner("/passkey/generate-register-options");
    expect(registration.status).toBe(200);
    const registered = await owner("/passkey/verify-registration", {
      response: passkey.register(String(registration.json?.challenge), origin),
    });
    expect(registered.status).toBe(200);

    // A new browser with no session signs in with the passkey alone.
    const visitor = browser();
    const challenge = await visitor("/passkey/generate-authenticate-options");
    expect(challenge.status).toBe(200);
    const signedIn = await visitor("/passkey/verify-authentication", {
      response: passkey.authenticate(String(challenge.json?.challenge), origin),
    });
    expect(signedIn.status).toBe(200);
    expect((await visitor("/get-session")).json?.user).toMatchObject({ email: "sam@example.com" });
  });
});
