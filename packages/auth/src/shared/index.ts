import type { BrandConfig } from "@rafters/platform-contracts";

/** A better-auth additional field, as both the server options and the client plugin declare it. */
interface AdditionalField {
  type: "boolean" | "date" | "string";
  required: false;
  input: false;
}

/**
 * The user fields a brand's configuration adds, shared by the server options and the client plugins.
 * Every brand has the backup address and whether it is verified; with ledger on, ledger's soft delete needs deletedAt and deletedBy on the user; nobody sets them through input.
 */
export function userAdditionalFields(brand: BrandConfig): Record<string, AdditionalField> {
  return {
    // Always declared, because the migration adds the columns for every brand; only a brand that
    // turns recovery.backupEmail on gets the endpoints that fill them.
    backupEmail: { type: "string", required: false, input: false },
    backupEmailVerified: { type: "boolean", required: false, input: false },
    ...(brand.ledger && {
      deletedAt: { type: "date", required: false, input: false },
      deletedBy: { type: "string", required: false, input: false },
    }),
  };
}
