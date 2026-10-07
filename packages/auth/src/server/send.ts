import {
  senderRequest,
  type BrandConfig,
  type Message,
  type Sender,
} from "@rafters/platform-contracts";

/** How long an email code stays valid, in seconds. better-auth's default, set here so the message can state it. */
export const CODE_LIFETIME_SECONDS = 300;

type OtpType = "sign-in" | "email-verification" | "forget-password" | "change-email";

/**
 * email OTP's sendVerificationOTP: one SenderRequest, checked against the contract, handed to the sender.
 * Auth never picks a provider, template, or transport; the sender does.
 */
export function sendEmailCode(brand: BrandConfig, sender: Sender) {
  return async (data: { email: string; otp: string; type: OtpType }): Promise<void> => {
    if (data.type === "forget-password") {
      throw new Error("platform auth has no passwords, so it sends no password reset codes");
    }
    const kind: Message["kind"] = data.type === "sign-in" ? "sign-in-code" : "verification-code";
    const expiresAt = new Date(Date.now() + CODE_LIFETIME_SECONDS * 1000).toISOString();
    const request = senderRequest.parse({
      brand: { id: brand.id, from: brand.sending.from },
      recipient: { channel: "email", to: data.email },
      message: { kind, data: { code: data.otp, expiresAt } },
    });
    await sender.send(request);
  };
}
