import type { BrandConfig } from "@rafters/platform-contracts";

/** A better-auth additional field, as both the server options and the client plugin declare it. */
interface AdditionalField {
  type: "boolean" | "date" | "string";
  required: false;
  input: false;
}

/**
 * The user fields a brand's configuration adds, shared by the server options and the client plugins.
 * A field is declared only when its need is on, so the options and the installed migrations describe the same
 * schema: recovery.backupEmail adds the backup address and whether it is verified, and ledger adds the deletedAt
 * and deletedBy its soft delete writes. Nobody sets them through input.
 */
export function userAdditionalFields(brand: BrandConfig): Record<string, AdditionalField> {
  return {
    ...(brand.recovery.backupEmail && {
      backupEmail: { type: "string", required: false, input: false },
      backupEmailVerified: { type: "boolean", required: false, input: false },
    }),
    ...(brand.ledger && {
      deletedAt: { type: "date", required: false, input: false },
      deletedBy: { type: "string", required: false, input: false },
    }),
  };
}

export * from "./access.ts";
