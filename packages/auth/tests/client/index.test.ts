import { describe, expect, it } from "vite-plus/test";
import * as client from "../../src/client/index.ts";
import { clientPlugins } from "../../src/client/index.ts";
import * as shared from "../../src/shared/index.ts";

const bandz = {
  id: "bandz",
  rootDomain: "bandz.app",
  sending: { from: "hello@bandz.app" },
  permissions: { budget: ["read"] },
};

describe("clientPlugins", () => {
  it("returns the client plugins for the brand's user fields, passkeys, email codes, and organizations", () => {
    const plugins = clientPlugins(bandz);
    expect(plugins.map((plugin) => plugin.id)).toEqual([
      "additional-fields-client",
      "passkey",
      "email-otp",
      "organization",
      "api-key",
    ]);
  });

  it("throws on a config that fails the contracts schema", () => {
    expect(() => clientPlugins({ ...bandz, id: "Not A Slug" })).toThrow(/id:/);
  });

  it("exports only plugin builders and shared data, never a wrapped better-auth function", () => {
    expect(Object.keys(client).sort()).toEqual(["clientPlugins"]);
    expect(Object.keys(shared).sort()).toEqual([
      "STAFF_ROLE_NAMES",
      "accessStatements",
      "defaultOrganizationRoles",
      "defaultStaffRoles",
      "staffOrganizationSlug",
      "userAdditionalFields",
    ]);
  });
});
