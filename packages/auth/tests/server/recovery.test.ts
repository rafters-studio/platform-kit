import type { BrandConfigInput } from "@rafters/platform-contracts";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { CODE_LIFETIME_SECONDS } from "../../src/server/send.ts";
import { brandAuth } from "../helpers/brand-auth.ts";
import { SoftwarePasskey } from "../helpers/webauthn.ts";

const brand: BrandConfigInput = {
  id: "bands",
  rootDomain: "bands.app",
  sending: { from: "hello@bands.app" },
  permissions: { budget: ["read"] },
  recovery: { backupEmail: true },
};
const origin = `https://${brand.rootDomain}`;

/** Ask for a code on the backup email and return the one the sender received, with its message kind. */
function lastCode(sender: ReturnType<typeof brandAuth>["sender"]) {
  const request = sender.requests.at(-1);
  const message = request?.message;
  if (!message || !("code" in message.data)) throw new Error("the last message carries no code");
  return { kind: message.kind, to: request?.recipient.to, code: message.data.code };
}

async function withVerifiedBackup() {
  const harness = brandAuth(brand);
  const owner = harness.browser();
  await harness.signIn(owner, "pat@example.com");
  expect((await owner("/backup-email/add", { email: "pat@backup.example" })).status).toBe(200);
  const verification = lastCode(harness.sender);
  expect(verification).toMatchObject({ kind: "verification-code", to: "pat@backup.example" });
  expect((await owner("/backup-email/verify", { code: verification.code })).status).toBe(200);
  return { ...harness, owner };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("backup email recovery", () => {
  it("adds a backup email, verifies it, and removes it", async () => {
    const { owner, sender } = await withVerifiedBackup();
    expect((await owner("/get-session")).json?.user).toMatchObject({
      backupEmail: "pat@backup.example",
      backupEmailVerified: true,
    });
    expect((await owner("/backup-email/remove", {})).status).toBe(200);
    expect((await owner("/get-session")).json?.user).toMatchObject({
      backupEmail: null,
      backupEmailVerified: false,
    });
    const before = sender.requests.length;
    const fresh = brandAuth(brand).browser();
    await fresh("/recovery/backup-email/send", { email: "pat@example.com" });
    expect(sender.requests.length).toBe(before);
  });

  it("sends no recovery code to a backup email that is not verified", async () => {
    const { sender, browser, signIn } = brandAuth(brand);
    const owner = browser();
    await signIn(owner, "pat@example.com");
    await owner("/backup-email/add", { email: "pat@backup.example" });
    const before = sender.requests.length;

    const stranger = browser();
    expect(
      (await stranger("/recovery/backup-email/send", { email: "pat@example.com" })).status,
    ).toBe(200);
    expect(sender.requests.length).toBe(before);
    expect(sender.requests.some((r) => r.message.kind === "recovery-code")).toBe(false);
  });

  it("refuses a wrong verification code and leaves the backup unverified", async () => {
    const { sender, browser, signIn, db } = brandAuth(brand);
    const owner = browser();
    await signIn(owner, "pat@example.com");
    await owner("/backup-email/add", { email: "pat@backup.example" });
    const good = lastCode(sender).code;
    const wrong = good === "000000" ? "000001" : "000000";
    expect((await owner("/backup-email/verify", { code: wrong })).status).not.toBe(200);
    expect(db.prepare('select "backupEmailVerified" as v from "user"').get()).toEqual({ v: 0 });
  });

  it("signs a user with no passkey in with a code sent to the backup email, then registers a passkey", async () => {
    const { sender, browser } = await withVerifiedBackup();
    const lost = browser();
    expect((await lost("/recovery/backup-email/send", { email: "pat@example.com" })).status).toBe(
      200,
    );
    const recovery = lastCode(sender);
    expect(recovery).toMatchObject({ kind: "recovery-code", to: "pat@backup.example" });

    expect(
      (
        await lost("/recovery/backup-email/sign-in", {
          email: "pat@example.com",
          code: recovery.code,
        })
      ).status,
    ).toBe(200);
    expect((await lost("/get-session")).json?.user).toMatchObject({ email: "pat@example.com" });

    const passkey = new SoftwarePasskey(brand.rootDomain);
    const options = await lost("/passkey/generate-register-options");
    expect(options.status).toBe(200);
    const registered = await lost("/passkey/verify-registration", {
      response: passkey.register(String(options.json?.challenge), origin),
    });
    expect(registered.status).toBe(200);

    const visitor = browser();
    const challenge = await visitor("/passkey/generate-authenticate-options");
    const signedIn = await visitor("/passkey/verify-authentication", {
      response: passkey.authenticate(String(challenge.json?.challenge), origin),
    });
    expect(signedIn.status).toBe(200);
  });

  it("refuses a recovery code twice and a wrong one", async () => {
    const { sender, browser } = await withVerifiedBackup();
    const lost = browser();
    await lost("/recovery/backup-email/send", { email: "pat@example.com" });
    const { code } = lastCode(sender);
    const wrong = code === "000000" ? "000001" : "000000";
    expect(
      (await lost("/recovery/backup-email/sign-in", { email: "pat@example.com", code: wrong }))
        .status,
    ).not.toBe(200);
    expect(
      (await lost("/recovery/backup-email/sign-in", { email: "pat@example.com", code })).status,
    ).toBe(200);
    expect(
      (await browser()("/recovery/backup-email/sign-in", { email: "pat@example.com", code }))
        .status,
    ).not.toBe(200);
  });

  it("answers a wrong recovery code with INVALID_CODE", async () => {
    const { sender, browser } = await withVerifiedBackup();
    const lost = browser();
    await lost("/recovery/backup-email/send", { email: "pat@example.com" });
    const { code } = lastCode(sender);
    const wrong = code === "000000" ? "000001" : "000000";
    const refused = await lost("/recovery/backup-email/sign-in", {
      email: "pat@example.com",
      code: wrong,
    });
    expect(refused.status).toBe(400);
    expect(refused.json).toMatchObject({ code: "INVALID_CODE" });
  });

  it("refuses the correct recovery code after three wrong guesses", async () => {
    const { sender, browser } = await withVerifiedBackup();
    const lost = browser();
    await lost("/recovery/backup-email/send", { email: "pat@example.com" });
    const { code } = lastCode(sender);
    const wrong = code === "000000" ? "000001" : "000000";
    for (let guess = 0; guess < 3; guess += 1) {
      const refused = await lost("/recovery/backup-email/sign-in", {
        email: "pat@example.com",
        code: wrong,
      });
      expect(refused.json).toMatchObject({ code: "INVALID_CODE" });
    }
    const late = await lost("/recovery/backup-email/sign-in", { email: "pat@example.com", code });
    expect(late.status).toBe(400);
    expect(late.json).toMatchObject({ code: "INVALID_CODE" });
    expect((await lost("/get-session")).json).toBeNull();
  });

  it("refuses an expired recovery code", async () => {
    const { sender, browser } = await withVerifiedBackup();
    const lost = browser();
    await lost("/recovery/backup-email/send", { email: "pat@example.com" });
    const { code } = lastCode(sender);
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.now() + (CODE_LIFETIME_SECONDS + 1) * 1000);
    const refused = await lost("/recovery/backup-email/sign-in", {
      email: "pat@example.com",
      code,
    });
    expect(refused.status).toBe(400);
    expect(refused.json).toMatchObject({ code: "INVALID_CODE" });
    expect((await lost("/get-session")).json).toBeNull();
  });

  it("refuses an expired verification code and leaves the backup unverified", async () => {
    const { sender, browser, signIn, db } = brandAuth(brand);
    const owner = browser();
    await signIn(owner, "pat@example.com");
    await owner("/backup-email/add", { email: "pat@backup.example" });
    const { code } = lastCode(sender);
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.now() + (CODE_LIFETIME_SECONDS + 1) * 1000);
    const refused = await owner("/backup-email/verify", { code });
    expect(refused.json).toMatchObject({ code: "INVALID_CODE" });
    expect(db.prepare('select "backupEmailVerified" as v from "user"').get()).toEqual({ v: 0 });
  });

  it("refuses a backup email equal to the primary with BACKUP_EMAIL_IS_PRIMARY", async () => {
    const { sender, browser, signIn, db } = brandAuth(brand);
    const owner = browser();
    await signIn(owner, "pat@example.com");
    const before = sender.requests.length;
    const refused = await owner("/backup-email/add", { email: "Pat@Example.com" });
    expect(refused.status).toBe(400);
    expect(refused.json).toMatchObject({ code: "BACKUP_EMAIL_IS_PRIMARY" });
    expect(sender.requests.length).toBe(before);
    expect(db.prepare('select "backupEmail" as v from "user"').get()).toEqual({ v: null });
  });

  it("asks for no identity documents anywhere in the sender requests or endpoints", async () => {
    const { auth, sender } = await withVerifiedBackup();
    const paths = Object.keys(auth.api).join(" ").toLowerCase();
    expect(paths).not.toMatch(/document|passport|license|identity/);
    expect(JSON.stringify(sender.requests).toLowerCase()).not.toMatch(/document|passport|license/);
  });

  it("does not add the backup email endpoints when the brand leaves it off", async () => {
    const { browser } = brandAuth({ ...brand, recovery: { backupEmail: false } });
    expect((await browser()("/recovery/backup-email/send", { email: "a@b.example" })).status).toBe(
      404,
    );
  });
});
