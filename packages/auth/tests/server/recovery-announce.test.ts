import type { BrandConfigInput } from "@rafters/platform-contracts";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { brandAuth } from "../helpers/brand-auth.ts";
import { SoftwarePasskey } from "../helpers/webauthn.ts";

const brand: BrandConfigInput = {
  id: "bandz",
  rootDomain: "bandz.app",
  sending: { from: "hello@bandz.app" },
  permissions: { budget: ["read"] },
  recovery: { backupEmail: true, phone: true },
  plugins: { vouch: { required: 1, waitingPeriodSeconds: 60 } },
};
const origin = `https://${brand.rootDomain}`;
const number = "+15551234567";

afterEach(() => {
  vi.useRealTimers();
});

function codeOf(sender: ReturnType<typeof brandAuth>["sender"]): string {
  const message = sender.requests.at(-1)?.message;
  if (!message || !("code" in message.data)) throw new Error("the last message carries no code");
  return message.data.code;
}

/** Pat has a primary email, a verified backup email, and a verified phone, signed in on two devices. */
async function pat() {
  const harness = brandAuth(brand);
  const first = harness.browser();
  const second = harness.browser();
  await harness.signIn(first, "pat@example.com");
  await harness.signIn(second, "pat@example.com");
  await first("/backup-email/add", { email: "pat@backup.example" });
  await first("/backup-email/verify", { code: codeOf(harness.sender) });
  await first("/phone-number/send-otp", { phoneNumber: number });
  await first("/phone-number/verify", {
    phoneNumber: number,
    code: codeOf(harness.sender),
    updatePhoneNumber: true,
  });
  const before = harness.sender.requests.length;
  return { ...harness, first, second, before };
}

function notices(h: Awaited<ReturnType<typeof pat>>) {
  return h.sender.requests
    .slice(h.before)
    .filter((request) => request.message.kind === "recovery-notice")
    .map((request) => ({ to: request.recipient, message: request.message }));
}

async function expectAnnounced(h: Awaited<ReturnType<typeof pat>>, method: string) {
  const sent = notices(h);
  expect(sent.map((n) => n.to)).toEqual([
    { channel: "email", to: "pat@example.com" },
    { channel: "email", to: "pat@backup.example" },
    { channel: "sms", to: number },
  ]);
  for (const { message } of sent) {
    expect(message).toMatchObject({ kind: "recovery-notice", data: { method } });
  }
  expect((await h.first("/get-session")).json).toBeNull();
  expect((await h.second("/get-session")).json).toBeNull();
}

describe("recovery is announced", () => {
  it("by backup email: every channel is told and other sessions end", async () => {
    const h = await pat();
    const lost = h.browser();
    await lost("/recovery/backup-email/send", { email: "pat@example.com" });
    const signedIn = await lost("/recovery/backup-email/sign-in", {
      email: "pat@example.com",
      code: codeOf(h.sender),
    });
    expect(signedIn.status).toBe(200);
    expect((await lost("/get-session")).json?.user).toMatchObject({ email: "pat@example.com" });
    await expectAnnounced(h, "backup-email");
  });

  it("by phone: every channel is told and other sessions end", async () => {
    const h = await pat();
    const lost = h.browser();
    await lost("/phone-number/send-otp", { phoneNumber: number });
    const signedIn = await lost("/phone-number/verify", {
      phoneNumber: number,
      code: codeOf(h.sender),
    });
    expect(signedIn.status).toBe(200);
    expect((await lost("/get-session")).json?.user).toMatchObject({ email: "pat@example.com" });
    await expectAnnounced(h, "phone");
  });

  it("by email code when the user has a passkey: every channel is told and other sessions end", async () => {
    const h = await pat();
    const passkey = new SoftwarePasskey(brand.rootDomain);
    const options = await h.first("/passkey/generate-register-options");
    await h.first("/passkey/verify-registration", {
      response: passkey.register(String(options.json?.challenge), origin),
    });
    const before = h.sender.requests.length;
    const lost = h.browser();
    await h.signIn(lost, "pat@example.com");
    expect(before).toBeLessThan(h.sender.requests.length);
    expect((await lost("/get-session")).json?.user).toMatchObject({ email: "pat@example.com" });
    await expectAnnounced({ ...h, before }, "email");
  });

  it("by vouch: every channel is told and other sessions end", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const h = await pat();
    const sam = h.browser();
    await h.signIn(sam, "sam@example.com");
    const org = await h.first("/organization/create", { name: "Band", slug: "band" });
    const invited = await h.first("/organization/invite-member", {
      email: "sam@example.com",
      role: "member",
      organizationId: String(org.json?.id),
    });
    await sam("/organization/accept-invitation", {
      invitationId: (invited.json as { id: string }).id,
    });
    const device = h.browser();
    const code = String((await device("/vouch/start", { email: "pat@example.com" })).json?.code);
    await sam("/vouch/approve", { code });
    vi.setSystemTime(Date.now() + 61 * 1000);
    const passkey = new SoftwarePasskey(brand.rootDomain);
    const options = await device("/passkey/generate-register-options");
    const done = await device("/passkey/verify-registration", {
      response: passkey.register(String(options.json?.challenge), origin),
    });
    expect(done.status).toBe(200);
    await expectAnnounced(h, "vouch");
  });

  it("does not announce a first sign-in or a phone number being added", async () => {
    const h = await pat();
    expect(notices(h)).toEqual([]);
    const fresh = h.browser();
    await h.signIn(fresh, "new@example.com");
    expect(h.sender.requests.some((r) => r.message.kind === "recovery-notice")).toBe(false);
    expect((await h.first("/get-session")).json?.user).toMatchObject({ email: "pat@example.com" });
  });
});
