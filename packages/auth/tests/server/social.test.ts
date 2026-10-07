import type { BrandConfigInput } from "@rafters/platform-contracts";
import { describe, expect, it } from "vite-plus/test";
import { authOptions, type AuthEnv } from "../../src/server/index.ts";
import { recordingSender } from "../helpers/sender.ts";
import { brandAuth } from "../helpers/brand-auth.ts";

const credentials = { GITHUB_CLIENT_ID: "gh-id", GITHUB_CLIENT_SECRET: "gh-secret" };

const envWith = (extra: Record<string, string>): AuthEnv => ({
  ...extra,
  DB: {} as AuthEnv["DB"],
  BETTER_AUTH_SECRET: "test-secret-0123456789abcdef0123456789",
  SENDER: recordingSender(),
});

const brandA: BrandConfigInput = {
  id: "bandz",
  rootDomain: "bandz.app",
  sending: { from: "hello@bandz.app" },
  permissions: { budget: ["read"] },
  socialProviders: ["github"],
};
const brandB: BrandConfigInput = {
  id: "rafters",
  rootDomain: "rafters.studio",
  sending: { from: "hello@rafters.studio" },
  permissions: { project: ["edit"] },
};

const signInWith = (brand: BrandConfigInput, host: string) =>
  brandAuth(brand, credentials).browser().at(host)("/sign-in/social", {
    provider: "github",
    callbackURL: "/",
  });

describe("social providers per brand", () => {
  it("offers a provider the brand enabled", async () => {
    const response = await signInWith(brandA, "bandz.app");
    expect(response.status).toBe(200);
    expect(String(response.json?.url)).toContain("github.com/login/oauth/authorize");
    expect(String(response.json?.url)).toContain("client_id=gh-id");
  });

  it("neither offers nor accepts that provider on a brand that did not enable it", async () => {
    const response = await signInWith(brandB, "rafters.studio");
    expect(response.status).toBe(404);
    expect(JSON.stringify(response.json)).not.toContain("github.com");
  });

  it("enables nothing by default", () => {
    expect(authOptions(brandB, envWith(credentials)).socialProviders).toEqual({});
  });

  it("throws, naming the id, on a provider better-auth does not know", () => {
    const brand = { ...brandA, socialProviders: ["myspace"] };
    expect(() => authOptions(brand, envWith(credentials))).toThrow(/"myspace"/);
  });

  it("throws, naming the variables, when an enabled provider has no credentials", () => {
    expect(() => authOptions(brandA, envWith({}))).toThrow(/GITHUB_CLIENT_ID/);
  });
});
