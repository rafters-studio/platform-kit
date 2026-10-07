import { parseBrandConfig, type BrandConfigInput } from "@rafters/platform-contracts";
import type { BetterAuthClientPlugin } from "better-auth/client";
import { apiKeyClient } from "@better-auth/api-key/client";
import { passkeyClient } from "@better-auth/passkey/client";
import {
  emailOTPClient,
  inferAdditionalFields,
  organizationClient,
} from "better-auth/client/plugins";
import { userAdditionalFields } from "../shared/index.ts";
import { vouchClient } from "./vouch.ts";

/** The client plugins matching the server plugins authOptions enables for this brand. */
export function clientPlugins(brandInput: BrandConfigInput): BetterAuthClientPlugin[] {
  const brand = parseBrandConfig(brandInput);
  const plugins: BetterAuthClientPlugin[] = [
    inferAdditionalFields({ user: userAdditionalFields(brand) }),
    passkeyClient(),
    emailOTPClient(),
    organizationClient(),
    apiKeyClient(),
  ];
  if (brand.plugins.vouch) plugins.push(vouchClient());
  return plugins;
}
