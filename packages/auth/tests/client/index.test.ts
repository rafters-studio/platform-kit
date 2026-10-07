import { describe, expect, it } from "vite-plus/test";
import * as client from "../../src/client/index.ts";
import { clientPlugins } from "../../src/client/index.ts";
import * as shared from "../../src/shared/index.ts";

const bands = {
  id: "bands",
  rootDomain: "bands.app",
  sending: { from: "hello@bands.app" },
  permissions: { budget: ["read"] },
};

describe("clientPlugins", () => {
  it("returns the client plugins for the brand's user fields, passkeys, email codes, and organizations", () => {
    const plugins = clientPlugins(bands);
    expect(plugins.map((plugin) => plugin.id)).toEqual([
      "additional-fields-client",
      "passkey",
      "email-otp",
      "organization",
    ]);
  });

  it("throws on a config that fails the contracts schema", () => {
    expect(() => clientPlugins({ ...bands, id: "Not A Slug" })).toThrow(/id:/);
  });

  it("exports only plugin builders and shared data, never a wrapped better-auth function", () => {
    expect(Object.keys(client).sort()).toEqual(["clientPlugins"]);
    expect(Object.keys(shared).sort()).toEqual(["userAdditionalFields"]);
  });
});
