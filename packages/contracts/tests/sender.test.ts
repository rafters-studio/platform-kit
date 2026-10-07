import { describe, expect, it } from "vite-plus/test";
import { senderRequest } from "../src/sender.ts";

const brand = { id: "bands", from: "hello@bands.app" };
const email = { channel: "email", to: "pat@example.com" } as const;
const code = { code: "481516", expiresAt: "2026-10-07T12:00:00.000Z" };

const messages = [
  { kind: "sign-in-code", data: code },
  { kind: "verification-code", data: code },
  { kind: "recovery-code", data: code },
  {
    kind: "invitation",
    data: { organizationName: "Pat and Sam", role: "member", url: "https://bands.app/invite/abc" },
  },
  { kind: "recovery-notice", data: { method: "backup-email", at: "2026-10-07T12:00:00.000Z" } },
];

describe("senderRequest", () => {
  it.each(messages)("accepts a $kind request", (message) => {
    expect(senderRequest.safeParse({ brand, recipient: email, message }).success).toBe(true);
  });

  it("accepts an sms recipient in E.164 form", () => {
    const request = {
      brand,
      recipient: { channel: "sms", to: "+14155550123" },
      message: messages[0],
    };
    expect(senderRequest.safeParse(request).success).toBe(true);
  });

  it("rejects an email recipient that is not an address", () => {
    const request = {
      brand,
      recipient: { channel: "email", to: "not-an-address" },
      message: messages[0],
    };
    expect(senderRequest.safeParse(request).success).toBe(false);
  });

  it("rejects an sms recipient that is not E.164", () => {
    const request = {
      brand,
      recipient: { channel: "sms", to: "415-555-0123" },
      message: messages[0],
    };
    expect(senderRequest.safeParse(request).success).toBe(false);
  });

  it("rejects an unknown kind", () => {
    const request = { brand, recipient: email, message: { kind: "newsletter", data: {} } };
    expect(senderRequest.safeParse(request).success).toBe(false);
  });

  it("rejects a kind whose data is missing a required field", () => {
    const request = {
      brand,
      recipient: email,
      message: {
        kind: "invitation",
        data: { organizationName: "Pat and Sam", url: "https://bands.app/i" },
      },
    };
    expect(senderRequest.safeParse(request).success).toBe(false);
  });
});
