import { parseBrandConfig, type BrandConfigInput } from "@rafters/platform-contracts";
import { passkey } from "@better-auth/passkey";
import type { BetterAuthOptions, BetterAuthPlugin } from "better-auth";
import { socialProviderList } from "better-auth/social-providers";
import { bearer } from "better-auth/plugins/bearer";
import { emailOTP } from "better-auth/plugins/email-otp";
import { uuidv7 } from "uuidv7";
import { userAdditionalFields } from "../shared/index.ts";
import type { AuthEnv } from "./env.ts";
import { CODE_LIFETIME_SECONDS, sendEmailCode } from "./send.ts";

export type { AuthEnv } from "./env.ts";

/**
 * Optional modules a brand hands in for the features it turns on, so a brand that leaves a feature
 * off never loads its module. With ledger on, pass `import * as ledger from "@rafters/ledger/better-auth"`;
 * with a native app that has a scheme, pass `import * as expo from "@better-auth/expo"`.
 */
export interface AuthDeps {
  expo?: { expo(): BetterAuthPlugin };
  ledger?: { ledgerPlugin(config: { softDeleteUser: true }): BetterAuthPlugin };
}

/** The brand's listed providers with their credentials from env; throws on an id better-auth lacks or a missing credential. */
function socialProviders(
  brand: { id: string; socialProviders: string[] },
  env: AuthEnv,
): NonNullable<BetterAuthOptions["socialProviders"]> {
  const known: readonly string[] = socialProviderList;
  const providers: Record<string, { clientId: string; clientSecret: string }> = {};
  for (const id of brand.socialProviders) {
    if (!known.includes(id)) {
      throw new Error(
        `brand "${brand.id}" lists social provider "${id}", which better-auth does not know`,
      );
    }
    const prefix = id.toUpperCase().replaceAll("-", "_");
    const clientId = env[`${prefix}_CLIENT_ID`];
    const clientSecret = env[`${prefix}_CLIENT_SECRET`];
    if (!clientId || !clientSecret) {
      throw new Error(
        `brand "${brand.id}" enables social provider "${id}"; set ${prefix}_CLIENT_ID and ${prefix}_CLIENT_SECRET`,
      );
    }
    providers[id] = { clientId, clientSecret };
  }
  return providers;
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

  const phoneApps = brand.apps.filter((app) => app.scheme !== undefined);
  if (phoneApps.length > 0 && deps.expo === undefined) {
    throw new Error(
      `brand "${brand.id}" lists phone apps with a scheme; pass the expo module: authOptions(brand, env, { expo })`,
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

  // Desktop and command-line apps carry a session token in an Authorization header, no cookie needed.
  if (brand.apps.length > 0) plugins.push(bearer());
  if (phoneApps.length > 0 && deps.expo) plugins.push(deps.expo.expo());

  return {
    appName: brand.id,
    // One deployment answers on the root domain and every subdomain; each request's own host is its base URL.
    baseURL: { allowedHosts: [brand.rootDomain, `*.${brand.rootDomain}`], protocol: "https" },
    trustedOrigins: [
      `https://${brand.rootDomain}`,
      `https://*.${brand.rootDomain}`,
      // A phone app's URL scheme is where the sign-in returns to.
      ...phoneApps.map((app) => `${app.scheme}://`),
    ],
    database: env.DB,
    secret: env.BETTER_AUTH_SECRET,
    socialProviders: socialProviders(brand, env),
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
