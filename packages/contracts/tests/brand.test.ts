import { describe, expect, it } from "vite-plus/test";
import { parseBrandConfig } from "../src/brand.ts";

const minimal = {
  id: "bandz",
  rootDomain: "bandz.app",
  sending: { from: "hello@bandz.app" },
  permissions: { budget: ["read"] },
};

describe("parseBrandConfig", () => {
  it("fills every default from the four required fields", () => {
    expect(parseBrandConfig(minimal)).toEqual({
      ...minimal,
      ledger: false,
      recovery: { backupEmail: false, phone: false },
      plugins: { vouch: false, teams: false },
      socialProviders: [],
      apps: [],
      regulations: [],
    });
  });

  it("accepts vouching settings when the plugin is on", () => {
    const config = parseBrandConfig({
      ...minimal,
      plugins: { vouch: { required: 2, waitingPeriodSeconds: 86400 } },
    });
    expect(config.plugins.vouch).toEqual({ required: 2, waitingPeriodSeconds: 86400 });
  });

  it("throws one Error naming every failing path", () => {
    const bad = { id: "Bandz", rootDomain: "bandz.app", sending: { from: "nope" }, ledger: "yes" };
    let thrown: unknown;
    try {
      parseBrandConfig(bad);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(Error);
    const text = (thrown as Error).message;
    for (const path of ["id", "sending.from", "ledger", "permissions"])
      expect(text).toContain(`${path}:`);
  });
});
