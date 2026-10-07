import type { Sender } from "@rafters/platform-contracts";
import { senderRequest } from "@rafters/platform-contracts";
import { describe, expect, it } from "vite-plus/test";

const base = {
  brand: { id: "bandz", from: "hello@bandz.app" },
  recipient: { channel: "email", to: "pat@example.com" },
} as const;

const expiresAt = "2026-10-07T12:00:00.000Z";

const messages = [
  { kind: "sign-in-code", data: { code: "481516", expiresAt } },
  { kind: "verification-code", data: { code: "481516", expiresAt } },
  { kind: "recovery-code", data: { code: "481516", expiresAt } },
  {
    kind: "invitation",
    data: { organizationName: "Bandz", role: "member", url: "https://bandz.app/join/abc" },
  },
  { kind: "recovery-notice", data: { method: "email", at: expiresAt } },
] as const;

/** Shared behavior every Sender adapter must show. */
export function senderContract(
  name: string,
  make: () => { sender: Sender; delivered: () => number },
): void {
  describe(`${name} satisfies the Sender contract`, () => {
    for (const message of messages) {
      it(`delivers a ${message.kind} once`, async () => {
        const { sender, delivered } = make();
        const request = { ...base, message };
        senderRequest.parse(request);
        const before = delivered();
        await expect(sender.send(request as never)).resolves.toBeUndefined();
        expect(delivered()).toBe(before + 1);
      });
    }

    it("rejects an invalid request without delivering", async () => {
      const { sender, delivered } = make();
      const bad = { ...base, brand: { id: "bandz", from: "nope" }, message: messages[0] };
      expect(senderRequest.safeParse(bad).success).toBe(false);
      const before = delivered();
      await expect(sender.send(bad as never)).rejects.toThrow();
      expect(delivered()).toBe(before);
    });
  });
}
