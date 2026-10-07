import { parseBrandConfig, type BrandConfigInput } from "@rafters/platform-contracts";
import { passkey } from "@better-auth/passkey";
import type { BetterAuthOptions, BetterAuthPlugin } from "better-auth";
import { emailOTP } from "better-auth/plugins/email-otp";
import { uuidv7 } from "uuidv7";
import { userAdditionalFields } from "../shared/index.ts";
import type { AuthEnv } from "./env.ts";
import { CODE_LIFETIME_SECONDS, sendEmailCode } from "./send.ts";

export type { AuthEnv } from "./env.ts";

/**
 * Optional modules a brand hands in for the features it turns on, so a brand that leaves a feature
 * off never loads its module. With ledger on, pass `import * as ledger from "@rafters/ledger/better-auth"`.
 */
export interface AuthDeps {
  ledger?: { ledgerPlugin(config: { softDeleteUser: true }): BetterAuthPlugin };
}

/**
 * The better-auth options for one brand. Validates the brand config first and throws, naming every
 * failing field, before building anything; call it at module scope so a bad config fails at deploy.
 * Returns plain options: the brand passes them to betterAuth() itself.
 */
export function authOptions(
  brandInput: BrandConfigInput,
  env: AuthEnv,
  deps: AuthDeps = {},
): BetterAuthOptions {
  const brand = parseBrandConfig(brandInput);
  if (brand.ledger && deps.ledger === undefined) {
    throw new Error(
      `brand "${brand.id}" turns ledger on; pass the ledger module: authOptions(brand, env, { ledger })`,
    );
  }

  const plugins: BetterAuthPlugin[] = [
    // One relying party per brand: a passkey made on any subdomain works on all of them.
    passkey({ rpID: brand.rootDomain }),
    emailOTP({
      sendVerificationOTP: sendEmailCode(brand, env.SENDER),
      expiresIn: CODE_LIFETIME_SECONDS,
    }),
  ];
  if (brand.ledger && deps.ledger) plugins.push(deps.ledger.ledgerPlugin({ softDeleteUser: true }));

  return {
    appName: brand.id,
    // One deployment answers on the root domain and every subdomain; each request's own host is its base URL.
    baseURL: { allowedHosts: [brand.rootDomain, `*.${brand.rootDomain}`], protocol: "https" },
    trustedOrigins: [`https://${brand.rootDomain}`, `https://*.${brand.rootDomain}`],
    database: env.DB,
    secret: env.BETTER_AUTH_SECRET,
    user: { additionalFields: userAdditionalFields(brand) },
    advanced: {
      database: { generateId: () => uuidv7() },
      // The session cookie lives on the root domain, so signing in on one product signs in on all of them.
      crossSubDomainCookies: { enabled: true, domain: brand.rootDomain },
      // Set explicitly: better-auth turns the origin check off under a test runner when this is unset,
      // and trusting every subdomain is only safe if requests from other sites are refused everywhere.
      disableOriginCheck: false,
    },
    plugins,
  };
}
