import * as ledger from "@rafters/ledger/better-auth";
import type { BrandConfigInput } from "@rafters/platform-contracts";
import type { BetterAuthOptions } from "better-auth";
import { describe, expect, it } from "vite-plus/test";
import * as server from "../../src/server/index.ts";
import { authOptions, type AuthEnv } from "../../src/server/index.ts";

const env: AuthEnv = {
  DB: {} as unknown as D1Database,
  BETTER_AUTH_SECRET: "test-secret-0123456789abcdef0123456789",
};
const bands: BrandConfigInput = {
  id: "bands",
  rootDomain: "bands.app",
  sending: { from: "hello@bands.app" },
  permissions: { budget: ["read"] },
};
const rafters: BrandConfigInput = {
  id: "rafters",
  rootDomain: "rafters.studio",
  sending: { from: "hello@rafters.studio" },
  permissions: { project: ["edit"] },
};

const pluginIds = (options: BetterAuthOptions) =>
  (options.plugins ?? []).map((plugin) => plugin.id);
const userFields = (options: BetterAuthOptions) =>
  Object.keys(options.user?.additionalFields ?? {});

describe("authOptions", () => {
  it("throws on a config that fails the contracts schema, naming the failing field, and returns nothing", () => {
    let result: BetterAuthOptions | undefined;
    let thrown: unknown;
    try {
      result = authOptions({ ...bands, sending: { from: "not-an-address" } }, env);
    } catch (error) {
      thrown = error;
    }
    expect(result).toBeUndefined();
    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as Error).message).toContain("sending.from:");
  });

  it("builds options for two brands that differ only in what their configuration sets", () => {
    const a = authOptions(bands, env);
    const b = authOptions(rafters, env);
    expect(a.appName).toBe("bands");
    expect(b.appName).toBe("rafters");
    const strip = ({ appName: _appName, advanced: _advanced, ...rest }: BetterAuthOptions) => rest;
    expect(strip(a)).toEqual(strip(b));
  });

  it("generates ids that parse as version-7 UUIDs", () => {
    const generate = authOptions(bands, env).advanced?.database?.generateId;
    expect(typeof generate).toBe("function");
    const id = typeof generate === "function" ? generate({ model: "user" }) : undefined;
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it("adds neither the ledger plugin nor the soft-delete fields when ledger is omitted or false", () => {
    for (const config of [bands, { ...bands, ledger: false }]) {
      const options = authOptions(config, env);
      expect(pluginIds(options)).not.toContain("ledger");
      expect(userFields(options)).toEqual([]);
    }
  });

  it("adds the ledger plugin and deletedAt and deletedBy when ledger is true", () => {
    const options = authOptions({ ...bands, ledger: true }, env, { ledger });
    expect(pluginIds(options)).toContain("ledger");
    expect(userFields(options)).toEqual(["deletedAt", "deletedBy"]);
  });

  it("refuses ledger: true without the ledger module, so a ledger-off brand never needs it", () => {
    expect(() => authOptions({ ...bands, ledger: true }, env)).toThrow(/pass the ledger module/);
  });

  it("exports only option builders, never a wrapped better-auth function", () => {
    expect(Object.keys(server).sort()).toEqual(["authOptions"]);
  });
});
