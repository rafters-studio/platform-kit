import { describe, expect, it } from "vite-plus/test";
import { senderRequest } from "../src/sender.ts";

const brand = { id: "bandz", from: "hello@bandz.app" };
const email = { channel: "email", to: "pat@example.com" } as const;
const code = { code: "481516", expiresAt: "2026-10-07T12:00:00.000Z" };

const messages = [
  { kind: "sign-in-code", data: code },
  { kind: "verification-code", data: code },
  { kind: "recovery-code", data: code },
  {
    kind: "invitation",
    data: { organizationName: "Pat and Sam", role: "member", url: "https://bandz.app/invite/abc" },
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
        data: { organizationName: "Pat and Sam", url: "https://bandz.app/i" },
      },
    };
    expect(senderRequest.safeParse(request).success).toBe(false);
  });

  const invitation = (data: Record<string, string>) => ({
    brand,
    recipient: email,
    message: {
      kind: "invitation",
      data: { organizationName: "Duo", role: "member", url: "https://bandz.app/i/1", ...data },
    },
  });

  it.each(["javascript:alert(1)", "http://bandz.app/i/1"])(
    "rejects an invitation whose url is %s",
    (url) => {
      expect(senderRequest.safeParse(invitation({ url })).success).toBe(false);
    },
  );

  it.each(["organizationName", "role"])("rejects a CR or LF in an invitation %s", (field) => {
    for (const bad of ["a\r\nBcc: x@y.z", "a\nb", "a\rb", "a\u0000b"]) {
      expect(senderRequest.safeParse(invitation({ [field]: bad })).success).toBe(false);
    }
  });
});
