import { parseBrandConfig, type BrandConfigInput } from "@rafters/platform-contracts";
import type { BetterAuthClientPlugin } from "better-auth/client";
import { passkeyClient } from "@better-auth/passkey/client";
import {
  emailOTPClient,
  inferAdditionalFields,
  phoneNumberClient,
} from "better-auth/client/plugins";
import { userAdditionalFields } from "../shared/index.ts";

/** The client plugins matching the server plugins authOptions enables for this brand. */
export function clientPlugins(brandInput: BrandConfigInput): BetterAuthClientPlugin[] {
  const brand = parseBrandConfig(brandInput);
  return [
    inferAdditionalFields({ user: userAdditionalFields(brand) }),
    passkeyClient(),
    emailOTPClient(),
    ...(brand.recovery.phone ? [phoneNumberClient()] : []),
  ];
}
