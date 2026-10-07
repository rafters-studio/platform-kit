import { parseBrandConfig, type BrandConfigInput } from "@rafters/platform-contracts";
import type { BetterAuthClientPlugin } from "better-auth/client";
import { inferAdditionalFields } from "better-auth/client/plugins";
import { userAdditionalFields } from "../shared/index.ts";

/** The client plugins matching the server plugins authOptions enables for this brand. */
export function clientPlugins(brandInput: BrandConfigInput): BetterAuthClientPlugin[] {
  const brand = parseBrandConfig(brandInput);
  return [inferAdditionalFields({ user: userAdditionalFields(brand) })];
}
