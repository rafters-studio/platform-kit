import { senderRequest, type BrandConfigInput } from "@rafters/platform-contracts";
import { betterAuth } from "better-auth";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { authOptions, type AuthEnv } from "../../src/server/index.ts";
import { CODE_LIFETIME_SECONDS } from "../../src/server/send.ts";
import { migratedDatabase } from "../helpers/database.ts";
import { recordingSender } from "../helpers/sender.ts";
import { SoftwarePasskey } from "../helpers/webauthn.ts";

const brands: BrandConfigInput[] = [
  {
    id: "bands",
    rootDomain: "bands.app",
    sending: { from: "hello@bands.app" },
    permissions: { budget: ["read"] },
  },
  {
    id: "rafters",
    rootDomain: "rafters.studio",
    sending: { from: "hello@rafters.studio" },
    permissions: { project: ["edit"] },
  },
];

/** One brand's auth on a database built from the shipped migrations, driven over HTTP like a browser. */
function brandAuth(brand: BrandConfigInput) {
  const origin = `https://${brand.rootDomain}`;
  const sender = recordingSender();
  const env = {
    DB: {} as AuthEnv["DB"],
    BETTER_AUTH_SECRET: "test-secret-0123456789abcdef0123456789",
    SENDER: sender,
  };
  const auth = betterAuth({
    ...authOptions(brand, env),
    database: migratedDatabase({ ledger: false }),
    baseURL: origin,
  });

  /** A browser: its own cookie jar, sending the brand's origin. */
  function browser() {
    const cookies = new Map<string, string>();
    return async (path: string, body?: unknown) => {
      const headers = new Headers({ origin });
      if (cookies.size > 0)
        headers.set("cookie", [...cookies].map(([name, value]) => `${name}=${value}`).join("; "));
      if (body !== undefined) headers.set("content-type", "application/json");
      const response = await auth.handler(
        new Request(`${origin}/api/auth${path}`, {
          method: body === undefined ? "GET" : "POST",
          headers,
          body: body === undefined ? undefined : JSON.stringify(body),
        }),
      );
      for (const cookie of response.headers.getSetCookie()) {
        const [pair = ""] = cookie.split(";");
        const index = pair.indexOf("=");
        cookies.set(pair.slice(0, index), pair.slice(index + 1));
      }
      const text = await response.text();
      return {
        status: response.status,
        json: text ? (JSON.parse(text) as Record<string, unknown>) : null,
      };
    };
  }

  /** Ask for a sign-in code and return the one the sender received. */
  async function requestCode(fetch: ReturnType<typeof browser>, email: string): Promise<string> {
    const before = sender.requests.length;
    const sent = await fetch("/email-otp/send-verification-otp", { email, type: "sign-in" });
    expect(sent.status).toBe(200);
    const request = sender.requests[before];
    expect(senderRequest.safeParse(request).success).toBe(true);
    expect(request?.message.kind).toBe("sign-in-code");
    return request?.message.kind === "sign-in-code" ? request.message.data.code : "";
  }

  return { origin, sender, browser, requestCode };
}

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
    const { origin, browser, requestCode } = brandAuth(brand);
    const passkey = new SoftwarePasskey(brand.rootDomain, origin);

    // Sign up with an email code, then register a passkey on that fresh session.
    const owner = browser();
    const code = await requestCode(owner, "sam@example.com");
    expect(
      (await owner("/sign-in/email-otp", { email: "sam@example.com", otp: code })).status,
    ).toBe(200);
    const registration = await owner("/passkey/generate-register-options");
    expect(registration.status).toBe(200);
    const registered = await owner("/passkey/verify-registration", {
      response: passkey.register(String(registration.json?.challenge)),
    });
    expect(registered.status).toBe(200);

    // A new browser with no session signs in with the passkey alone.
    const visitor = browser();
    const challenge = await visitor("/passkey/generate-authenticate-options");
    expect(challenge.status).toBe(200);
    const signedIn = await visitor("/passkey/verify-authentication", {
      response: passkey.authenticate(String(challenge.json?.challenge)),
    });
    expect(signedIn.status).toBe(200);
    expect((await visitor("/get-session")).json?.user).toMatchObject({ email: "sam@example.com" });
  });
});
