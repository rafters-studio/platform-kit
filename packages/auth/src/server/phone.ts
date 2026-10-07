import { senderRequest, type BrandConfig, type Sender } from "@rafters/platform-contracts";
import type { GenericEndpointContext } from "better-auth";
import { phoneNumber } from "better-auth/plugins/phone-number";
import { CODE_LIFETIME_SECONDS } from "./send.ts";

/** E.164: a plus sign, then up to 15 digits with no leading zero. The same shape the sender contract accepts. */
const E164 = /^\+[1-9]\d{1,14}$/;

/**
 * better-auth's phone-number plugin, set up for recovery only. A user adds a number after sign-up
 * and verifies it with a code; a user who lost their passkeys asks for a code to a verified number
 * and signs in with it. Each text goes to the brand's sender as one SenderRequest on channel `sms`;
 * auth never knows which provider carries it. Sign-up never asks for a number, and nothing here
 * creates a user from one.
 */
export function phoneRecovery(brand: BrandConfig, sender: Sender) {
  return phoneNumber({
    expiresIn: CODE_LIFETIME_SECONDS,
    phoneNumberValidator: (number) => E164.test(number),
    async sendOTP({ phoneNumber: to, code }, ctx?: GenericEndpointContext) {
      // A number only ever lands on a user once verified, so a number that belongs to a user is a
      // recovery; any other number is being verified for the first time.
      const owner = await ctx?.context.adapter.findOne({
        model: "user",
        where: [{ field: "phoneNumber", value: to }],
      });
      const expiresAt = new Date(Date.now() + CODE_LIFETIME_SECONDS * 1000).toISOString();
      await sender.send(
        senderRequest.parse({
          brand: { id: brand.id, from: brand.sending.from },
          recipient: { channel: "sms", to },
          message: {
            kind: owner ? "recovery-code" : "verification-code",
            data: { code, expiresAt },
          },
        }),
      );
    },
  });
}
