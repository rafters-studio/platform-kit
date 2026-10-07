import type { BrandConfig } from "@rafters/platform-contracts";

/** A better-auth additional field, as both the server options and the client plugin declare it. */
interface AdditionalField {
  type: "date" | "string";
  required: false;
  input: false;
}

/**
 * The user fields a brand's configuration adds, shared by the server options and the client plugins.
 * With ledger on, ledger's soft delete needs deletedAt and deletedBy on the user; nobody sets them through input.
 */
export function userAdditionalFields(brand: BrandConfig): Record<string, AdditionalField> {
  if (!brand.ledger) return {};
  return {
    deletedAt: { type: "date", required: false, input: false },
    deletedBy: { type: "string", required: false, input: false },
  };
}
