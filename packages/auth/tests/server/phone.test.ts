import type { BrandConfigInput } from "@rafters/platform-contracts";
import { describe, expect, it } from "vite-plus/test";
import { brandAuth } from "../helpers/brand-auth.ts";

const brand: BrandConfigInput = {
  id: "bands",
  rootDomain: "bands.app",
  sending: { from: "hello@bands.app" },
  permissions: { budget: ["read"] },
  recovery: { phone: true },
};
const number = "+15551234567";

function lastText(sender: ReturnType<typeof brandAuth>["sender"]) {
  const request = sender.requests.at(-1);
  const message = request?.message;
  if (!message || !("code" in message.data)) throw new Error("the last message carries no code");
  return { kind: message.kind, recipient: request?.recipient, code: message.data.code };
}

async function withVerifiedPhone() {
  const harness = brandAuth(brand);
  const owner = harness.browser();
  await harness.signIn(owner, "pat@example.com");
  expect((await owner("/phone-number/send-otp", { phoneNumber: number })).status).toBe(200);
  const text = lastText(harness.sender);
  expect(text).toMatchObject({
    kind: "verification-code",
    recipient: { channel: "sms", to: number },
  });
  const verified = await owner("/phone-number/verify", {
    phoneNumber: number,
    code: text.code,
    updatePhoneNumber: true,
  });
  expect(verified.status).toBe(200);
  return { ...harness, owner };
}

describe("phone number recovery", () => {
  it("adds and verifies a phone number after sign-up", async () => {
    const { owner } = await withVerifiedPhone();
    expect((await owner("/get-session")).json?.user).toMatchObject({
      phoneNumber: number,
      phoneNumberVerified: true,
    });
  });

  it("never asks for a phone number at sign-up", async () => {
    const { signIn, browser, db } = brandAuth(brand);
    await signIn(browser(), "pat@example.com");
    expect(
      db.prepare('select "phoneNumber" as p, "phoneNumberVerified" as v from "user"').get(),
    ).toEqual({
      p: null,
      v: 0,
    });
  });

  it("recovers with a code sent by text to a verified phone", async () => {
    const { sender, browser } = await withVerifiedPhone();
    const stranger = browser();
    expect((await stranger("/phone-number/send-otp", { phoneNumber: number })).status).toBe(200);
    const text = lastText(sender);
    expect(text).toMatchObject({
      kind: "recovery-code",
      recipient: { channel: "sms", to: number },
    });
    const signedIn = await stranger("/phone-number/verify", {
      phoneNumber: number,
      code: text.code,
    });
    expect(signedIn.status).toBe(200);
    expect((await stranger("/get-session")).json?.user).toMatchObject({ email: "pat@example.com" });
  });

  it("refuses a wrong code and signs nobody in", async () => {
    const { sender, browser } = await withVerifiedPhone();
    const stranger = browser();
    await stranger("/phone-number/send-otp", { phoneNumber: number });
    const good = lastText(sender).code;
    const wrong = good === "000000" ? "000001" : "000000";
    expect(
      (await stranger("/phone-number/verify", { phoneNumber: number, code: wrong })).status,
    ).not.toBe(200);
    expect((await stranger("/get-session")).json).toBeNull();
  });

  it("creates no account from a phone number alone", async () => {
    const { sender, browser, db } = brandAuth(brand);
    const stranger = browser();
    await stranger("/phone-number/send-otp", { phoneNumber: number });
    const code = lastText(sender).code;
    expect((await stranger("/phone-number/verify", { phoneNumber: number, code })).status).not.toBe(
      200,
    );
    expect(db.prepare('select count(*) as n from "user"').get()).toEqual({ n: 0 });
  });

  it("refuses a number that is not E.164 and sends nothing", async () => {
    const { sender, browser } = brandAuth(brand);
    expect((await browser()("/phone-number/send-otp", { phoneNumber: "555-1234" })).status).toBe(
      400,
    );
    expect(sender.requests).toEqual([]);
  });

  it("is off for a brand that does not offer it", async () => {
    const { browser } = brandAuth({ ...brand, recovery: {} });
    expect((await browser()("/phone-number/send-otp", { phoneNumber: number })).status).toBe(404);
  });
});
