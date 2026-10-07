import type { BrandConfigInput } from "@rafters/platform-contracts";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { authOptions } from "../../src/server/index.ts";
import { brandAuth } from "../helpers/brand-auth.ts";
import { SoftwarePasskey } from "../helpers/webauthn.ts";

const brand: BrandConfigInput = {
  id: "bands",
  rootDomain: "bands.app",
  sending: { from: "hello@bands.app" },
  permissions: { budget: ["read"] },
  plugins: { vouch: { required: 2, waitingPeriodSeconds: 3600 } },
};
const origin = `https://${brand.rootDomain}`;

afterEach(() => {
  vi.useRealTimers();
});

/** Pat, Sam, and Lee share an organization; Kim is in none; Pat is the one who lost everything. */
async function band() {
  const harness = brandAuth(brand);
  const pat = harness.browser();
  const sam = harness.browser();
  const lee = harness.browser();
  const kim = harness.browser();
  for (const [who, mail] of [
    [pat, "pat@example.com"],
    [sam, "sam@example.com"],
    [lee, "lee@example.com"],
    [kim, "kim@example.com"],
  ] as const) {
    await harness.signIn(who, mail);
  }
  const org = await pat("/organization/create", { name: "Band", slug: "band" });
  const organizationId = String(org.json?.id);
  for (const [who, mail] of [
    [sam, "sam@example.com"],
    [lee, "lee@example.com"],
  ] as const) {
    const invited = await pat("/organization/invite-member", {
      email: mail,
      role: "member",
      organizationId,
    });
    await who("/organization/accept-invitation", {
      invitationId: (invited.json as { id: string }).id,
    });
  }
  // Pat's own device has no session: a new browser.
  return { ...harness, sam, lee, kim, organizationId, patDevice: harness.browser() };
}

function sessionsOf(db: ReturnType<typeof brandAuth>["db"]): number {
  const row = db
    .prepare(
      'select count(*) as n from "session" where "userId" = (select id from "user" where email = ?)',
    )
    .get("pat@example.com");
  return Number(row?.n);
}

async function startRequest(
  device: ReturnType<typeof brandAuth>["browser"] extends () => infer B ? B : never,
) {
  const started = await device("/vouch/start", { email: "pat@example.com" });
  expect(started.status).toBe(200);
  return String(started.json?.code);
}

describe("vouching recovery", () => {
  it("adds no vouch endpoints and no vouch plugin when it is off", async () => {
    const off = brandAuth({ ...brand, plugins: { vouch: false } });
    expect((await off.browser()("/vouch/start", { email: "pat@example.com" })).status).toBe(404);
    const options = authOptions(
      { ...brand, plugins: { vouch: false } },
      {
        DB: {} as never,
        BETTER_AUTH_SECRET: "x".repeat(32),
        SENDER: off.sender,
      },
      { expo: { expo: () => ({ id: "expo" }) } },
    );
    expect(options.plugins?.some((plugin) => plugin.id === "vouch")).toBe(false);
  });

  it("shows the device a request code and counts approvals from members", async () => {
    const { patDevice, sam, lee } = await band();
    const code = await startRequest(patDevice);
    expect(code).toMatch(/^[2-9A-HJKMNP-Z]{8}$/);
    expect((await patDevice("/vouch/status")).json).toMatchObject({ approvals: 0, required: 2 });

    const looked = await sam(`/vouch/request?code=${code}`);
    expect(looked.json).toMatchObject({ name: expect.any(String), email: "pat@example.com" });
    expect((await sam("/vouch/approve", { code })).json).toMatchObject({ approvals: 1 });
    expect((await lee("/vouch/approve", { code })).json).toMatchObject({ approvals: 2 });
  });

  it("counts a member once and refuses a non-member, an unknown code, and the user's own approval", async () => {
    const { patDevice, sam, kim } = await band();
    const code = await startRequest(patDevice);
    await sam("/vouch/approve", { code });
    expect((await sam("/vouch/approve", { code })).json).toMatchObject({ approvals: 1 });
    expect((await kim("/vouch/approve", { code })).status).toBe(400);
    expect((await sam("/vouch/approve", { code: "ZZZZZZZZ" })).status).toBe(400);
    const signedInPat = brandAuth(brand).browser();
    expect((await signedInPat("/vouch/approve", { code })).status).toBe(401);
  });

  it("gives an approver nothing that grants access", async () => {
    const { patDevice, sam, db } = await band();
    const before = sessionsOf(db);
    const code = await startRequest(patDevice);
    const approved = await sam("/vouch/approve", { code });
    expect(Object.keys(approved.json ?? {}).sort()).toEqual(["approvals", "required"]);
    // A different browser with only the code cannot read the request, nor register as the user.
    const stranger = brandAuth(brand).browser();
    expect((await stranger("/vouch/status")).status).toBe(400);
    expect((await stranger("/passkey/generate-register-options")).status).not.toBe(200);
    expect(sessionsOf(db)).toBe(before);
  });

  it("holds the device back until enough approvals arrive and the waiting period passes", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const { patDevice, sam, lee } = await band();
    const code = await startRequest(patDevice);
    expect((await patDevice("/passkey/generate-register-options")).status).not.toBe(200);

    await sam("/vouch/approve", { code });
    await lee("/vouch/approve", { code });
    // Approved, but the wait is not over.
    expect((await patDevice("/vouch/status")).json).toMatchObject({ ready: false });
    expect((await patDevice("/passkey/generate-register-options")).status).not.toBe(200);

    vi.setSystemTime(Date.now() + 3601 * 1000);
    expect((await patDevice("/vouch/status")).json).toMatchObject({ ready: true });
    expect((await patDevice("/passkey/generate-register-options")).status).toBe(200);
  });

  it("does not let the approved request's code register a passkey from another device", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const { patDevice, sam, lee } = await band();
    const code = await startRequest(patDevice);
    await sam("/vouch/approve", { code });
    await lee("/vouch/approve", { code });
    vi.setSystemTime(Date.now() + 3601 * 1000);
    const other = brandAuth(brand).browser();
    expect((await other("/passkey/generate-register-options")).status).not.toBe(200);
  });

  it("registers a new passkey on the starting device, leaves the email alone, and consumes the request", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const { patDevice, sam, lee, db } = await band();
    const code = await startRequest(patDevice);
    await sam("/vouch/approve", { code });
    await lee("/vouch/approve", { code });
    vi.setSystemTime(Date.now() + 3601 * 1000);

    const passkey = new SoftwarePasskey(brand.rootDomain);
    const options = await patDevice("/passkey/generate-register-options");
    expect(options.status).toBe(200);
    const done = await patDevice("/passkey/verify-registration", {
      response: passkey.register(String(options.json?.challenge), origin),
    });
    expect(done.status).toBe(200);

    expect(db.prepare('select email from "user" where email = ?').get("pat@example.com")).toEqual({
      email: "pat@example.com",
    });
    expect(db.prepare('select count(*) as n from "passkey"').get()).toEqual({ n: 1 });
    expect(db.prepare('select count(*) as n from "vouchRequest"').get()).toEqual({ n: 0 });
    expect(db.prepare('select count(*) as n from "vouchApproval"').get()).toEqual({ n: 0 });

    // The consumed request cannot be used again.
    expect((await patDevice("/passkey/generate-register-options")).status).not.toBe(200);
    const visitor = brandAuth(brand).browser();
    expect((await visitor("/vouch/status")).status).toBe(400);
  });

  it("expires a request", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const { patDevice, sam, lee } = await band();
    const code = await startRequest(patDevice);
    await sam("/vouch/approve", { code });
    await lee("/vouch/approve", { code });
    vi.setSystemTime(Date.now() + (3600 + 4 * 24 * 3600) * 1000);
    expect((await patDevice("/vouch/status")).status).toBe(400);
    expect((await patDevice("/passkey/generate-register-options")).status).not.toBe(200);
    expect((await sam("/vouch/approve", { code })).status).toBe(400);
  });

  it("answers an unknown email the same as a known one", async () => {
    const { patDevice } = await band();
    const ghost = await patDevice("/vouch/start", { email: "nobody@example.com" });
    expect(ghost.status).toBe(200);
    expect(Object.keys(ghost.json ?? {}).sort()).toEqual([
      "code",
      "required",
      "waitingPeriodSeconds",
    ]);
  });
});
