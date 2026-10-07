import { z } from "zod";

/** "auth.<model>.<action>" for each identity model (FR-PLATFORM-AUTH-112). */
export const changeEventType = z.enum([
  "auth.user.created",
  "auth.user.updated",
  "auth.user.deleted",
  "auth.account.created",
  "auth.account.updated",
  "auth.account.deleted",
  "auth.passkey.created",
  "auth.passkey.updated",
  "auth.passkey.deleted",
  "auth.apikey.created",
  "auth.apikey.updated",
  "auth.apikey.deleted",
  "auth.session.created",
  "auth.session.updated",
  "auth.session.deleted",
  "auth.organization.created",
  "auth.organization.updated",
  "auth.organization.deleted",
  "auth.member.created",
  "auth.member.updated",
  "auth.member.deleted",
  "auth.invitation.created",
  "auth.invitation.updated",
  "auth.invitation.deleted",
]);

const base = {
  id: z.uuid({ version: "v7" }),
  brand: z.string().min(1),
  time: z.iso.datetime(),
};

/**
 * Thin: what changed and whom it concerns, never field values; subscribers fetch current state.
 * The subject is the user the record belongs to, or the organization for organization-level
 * records (an organization row, an invitation to an address with no account). Never the actor.
 */
const changeEvent = z.object({
  ...base,
  type: changeEventType,
  subject: z.string().min(1),
  data: z.strictObject({
    recordId: z.string().min(1),
    changedFields: z.array(z.string().min(1)),
  }),
});

const signInFailedEvent = z.object({
  ...base,
  type: z.literal("auth.sign-in.failed"),
  /** Absent when the attempted address has no account. */
  subject: z.string().min(1).optional(),
  data: z.strictObject({
    method: z.enum(["passkey", "email-otp", "social"]),
    /** Keyed hash of the attempted address, 64 hex characters; never the address itself. */
    addressHash: z
      .string()
      .regex(/^[0-9a-f]{64}$/)
      .optional(),
  }),
});

/** Every event platform announces. A sign-in-failed event carries a subject or an addressHash. */
export const eventEnvelope = z
  .discriminatedUnion("type", [changeEvent, signInFailedEvent])
  .refine(
    (e) =>
      e.type !== "auth.sign-in.failed" ||
      e.subject !== undefined ||
      e.data.addressHash !== undefined,
    { message: "a sign-in-failed event needs a subject or an addressHash", path: ["subject"] },
  );

export type ChangeEventType = z.infer<typeof changeEventType>;
export type AuthEvent = z.infer<typeof eventEnvelope>;
