import { describe, expect, it, vi } from "vite-plus/test";
import { emailSender } from "../src/index.ts";
import { senderContract } from "./contract.ts";

const valid = {
  brand: { id: "bandz", from: "hello@bandz.app" },
  recipient: { channel: "email", to: "pat@example.com" },
  message: {
    kind: "sign-in-code",
    data: { code: "481516", expiresAt: "2026-10-07T12:00:00.000Z" },
  },
} as const;

describe("emailSender", () => {
  it("makes one binding call with to, from, subject, text, html", async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    await emailSender({ send }).send(valid);
    expect(send).toHaveBeenCalledTimes(1);
    const arg = send.mock.calls[0]?.[0];
    expect(arg.to).toBe("pat@example.com");
    expect(arg.from).toBe("hello@bandz.app");
    expect(arg.subject).toBeTruthy();
    expect(arg.text).toContain("481516");
    expect(arg.html).toContain("481516");
  });

  it("rejects an invalid request without calling the binding", async () => {
    const send = vi.fn();
    const bad = { ...valid, brand: { id: "bandz", from: "nope" } } as unknown as typeof valid;
    await expect(emailSender({ send }).send(bad)).rejects.toThrow();
    expect(send).not.toHaveBeenCalled();
  });

  it("rejects sms and names the channel", async () => {
    const send = vi.fn();
    const sms = { ...valid, recipient: { channel: "sms", to: "+15551234567" } } as const;
    await expect(emailSender({ send }).send(sms)).rejects.toThrow(/sms/);
    expect(send).not.toHaveBeenCalled();
  });

  it("lets a binding error reach the caller", async () => {
    const send = vi.fn().mockRejectedValue(new Error("binding down"));
    await expect(emailSender({ send }).send(valid)).rejects.toThrow("binding down");
  });
});

senderContract("emailSender", () => {
  const send = vi.fn().mockResolvedValue(undefined);
  return { sender: emailSender({ send }), delivered: () => send.mock.calls.length };
});
