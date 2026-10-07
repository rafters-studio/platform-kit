import { z } from "zod";

/** Who a message goes to. The channel decides what a valid address is. */
export const recipient = z.discriminatedUnion("channel", [
  z.object({ channel: z.literal("email"), to: z.email() }),
  // E.164: a plus sign, then up to 15 digits with no leading zero.
  z.object({ channel: z.literal("sms"), to: z.string().regex(/^\+[1-9]\d{1,14}$/) }),
]);

// No control characters (CR, LF, and the rest): the organization name lands in a mail subject.
const singleLine = z
  .string()
  .min(1)
  // oxlint-disable-next-line no-control-regex
  .regex(/^[^\u0000-\u001f\u007f-\u009f\u2028\u2029]+$/, "must not contain control characters");

// Only https: a javascript: url would become a live link in the html body.
const httpsUrl = z.url().refine((value) => URL.parse(value)?.protocol === "https:", {
  message: "must be an https url",
});

const code = z.object({ code: z.string().min(1), expiresAt: z.iso.datetime() });

/** What a message says. Each kind has its own data. */
export const message = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("sign-in-code"), data: code }),
  z.object({ kind: z.literal("verification-code"), data: code }),
  z.object({ kind: z.literal("recovery-code"), data: code }),
  z.object({
    kind: z.literal("invitation"),
    data: z.object({ organizationName: singleLine, role: singleLine, url: httpsUrl }),
  }),
  z.object({
    kind: z.literal("recovery-notice"),
    data: z.object({
      method: z.enum(["email", "backup-email", "phone", "vouch"]),
      at: z.iso.datetime(),
    }),
  }),
]);

/** What a caller hands a sender. The sender chooses provider, template, and delivery. */
export const senderRequest = z.object({
  brand: z.object({ id: z.string().min(1), from: z.email() }),
  recipient,
  message,
});

export type Recipient = z.infer<typeof recipient>;
export type Message = z.infer<typeof message>;
export type SenderRequest = z.infer<typeof senderRequest>;

/** Every sender implements this, whatever it sends through. */
export interface Sender {
  send(request: SenderRequest): Promise<void>;
}
