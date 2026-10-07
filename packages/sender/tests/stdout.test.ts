import { describe, expect, it, vi } from "vite-plus/test";
import { stdoutSender } from "../src/index.ts";
import { senderContract } from "./contract.ts";

const valid = {
  brand: { id: "bandz", from: "hello@bandz.app" },
  recipient: { channel: "email", to: "pat@example.com" },
  message: {
    kind: "sign-in-code",
    data: { code: "481516", expiresAt: "2026-10-07T12:00:00.000Z" },
  },
} as const;

describe("stdoutSender", () => {
  it("writes one text-only string with recipient, subject, and code", async () => {
    const write = vi.fn();
    await stdoutSender(write).send(valid);
    expect(write).toHaveBeenCalledTimes(1);
    const line = write.mock.calls[0]?.[0] as string;
    expect(line).toContain("To: pat@example.com (email)");
    expect(line).toContain("Subject: Your sign-in code");
    expect(line).toContain("481516");
    expect(line).not.toContain("<html");
    expect(line).not.toContain("<p>");
  });

  it("accepts sms", async () => {
    const write = vi.fn();
    const sms = { ...valid, recipient: { channel: "sms", to: "+15551234567" } } as const;
    await stdoutSender(write).send(sms);
    expect(write).toHaveBeenCalledTimes(1);
    expect(write.mock.calls[0]?.[0]).toContain("To: +15551234567 (sms)");
  });

  it("rejects an invalid request without writing", async () => {
    const write = vi.fn();
    const bad = { ...valid, brand: { id: "bandz", from: "nope" } } as unknown as typeof valid;
    await expect(stdoutSender(write).send(bad)).rejects.toThrow();
    expect(write).not.toHaveBeenCalled();
  });

  it("lets a write error reach the caller", async () => {
    const write = vi.fn(() => {
      throw new Error("pipe closed");
    });
    await expect(stdoutSender(write).send(valid)).rejects.toThrow("pipe closed");
  });

  it("writes through console.log by default", async () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      await stdoutSender().send(valid);
      expect(spy).toHaveBeenCalledTimes(1);
    } finally {
      spy.mockRestore();
    }
  });
});

senderContract("stdoutSender", () => {
  const write = vi.fn();
  return { sender: stdoutSender(write), delivered: () => write.mock.calls.length };
});
