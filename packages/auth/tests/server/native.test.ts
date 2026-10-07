import type { BrandConfigInput } from "@rafters/platform-contracts";
import * as expo from "@better-auth/expo";
import { describe, expect, it } from "vite-plus/test";
import { authOptions, type AuthEnv } from "../../src/server/index.ts";
import { brandAuth } from "../helpers/brand-auth.ts";
import { recordingSender } from "../helpers/sender.ts";

const brand: BrandConfigInput = {
  id: "bands",
  rootDomain: "bands.app",
  sending: { from: "hello@bands.app" },
  permissions: { budget: ["read"] },
  apps: [{ name: "bands-mobile", scheme: "bands" }, { name: "bands-cli" }],
};
const plain: BrandConfigInput = { ...brand, apps: [] };

const env: AuthEnv = {
  DB: {} as AuthEnv["DB"],
  BETTER_AUTH_SECRET: "test-secret-0123456789abcdef0123456789",
  SENDER: recordingSender(),
};

describe("native apps", () => {
  it("trusts a phone app's scheme as an origin and loads expo", () => {
    const options = authOptions(brand, env, { expo });
    expect(options.trustedOrigins).toContain("bands://");
    expect(options.plugins?.map((plugin) => plugin.id)).toEqual(
      expect.arrayContaining(["bearer", "expo"]),
    );
  });

  it("adds nothing when the brand lists no apps", () => {
    const options = authOptions(plain, env);
    const ids = options.plugins?.map((plugin) => plugin.id);
    expect(ids).not.toContain("bearer");
    expect(ids).not.toContain("expo");
  });

  it("throws when a phone app has a scheme and the expo module is not passed", () => {
    expect(() => authOptions(brand, env)).toThrow(/expo/);
  });

  it("needs no expo module for apps without a scheme", () => {
    const options = authOptions({ ...brand, apps: [{ name: "bands-cli" }] }, env);
    expect(options.plugins?.map((plugin) => plugin.id)).toContain("bearer");
  });

  it("signs a desktop or command-line app in and authenticates it with a bearer token, no cookie", async () => {
    const { auth, browser, requestCode } = brandAuth(brand);
    const code = await requestCode(browser(), "cli@bands.app");

    const signedIn = await auth.handler(
      new Request("https://bands.app/api/auth/sign-in/email-otp", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: "cli@bands.app", otp: code }),
      }),
    );
    expect(signedIn.status).toBe(200);
    const token = signedIn.headers.get("set-auth-token");
    expect(token).toBeTruthy();

    const session = await auth.handler(
      new Request("https://bands.app/api/auth/get-session", {
        headers: { authorization: `Bearer ${token}` },
      }),
    );
    expect(session.status).toBe(200);
    const body = (await session.json()) as { user?: { email?: string } } | null;
    expect(body?.user?.email).toBe("cli@bands.app");
  });

  it("refuses a request with no token and no cookie", async () => {
    const { auth } = brandAuth(brand);
    const session = await auth.handler(new Request("https://bands.app/api/auth/get-session"));
    expect(await session.json()).toBeNull();
  });

  it("lets a phone app's scheme through the origin check", async () => {
    const { auth, browser, requestCode } = brandAuth(brand, {}, { ledger: false });
    const code = await requestCode(browser(), "phone@bands.app");
    const signedIn = await auth.handler(
      new Request("https://bands.app/api/auth/sign-in/email-otp", {
        method: "POST",
        headers: { "content-type": "application/json", origin: "bands://" },
        body: JSON.stringify({ email: "phone@bands.app", otp: code }),
      }),
    );
    expect(signedIn.status).toBe(200);
    expect(signedIn.headers.get("set-cookie")).toContain("session_token");
  });
});
