import { parseBrandConfig, type BrandConfigInput } from "@rafters/platform-contracts";
import type { BetterAuthOptions, BetterAuthPlugin } from "better-auth";
import { uuidv7 } from "uuidv7";
import { userAdditionalFields } from "../shared/index.ts";
import type { AuthEnv } from "./env.ts";

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

  const plugins: BetterAuthPlugin[] = [];
  if (brand.ledger && deps.ledger) plugins.push(deps.ledger.ledgerPlugin({ softDeleteUser: true }));

  return {
    appName: brand.id,
    database: env.DB,
    secret: env.BETTER_AUTH_SECRET,
    user: { additionalFields: userAdditionalFields(brand) },
    advanced: { database: { generateId: () => uuidv7() } },
    plugins,
  };
}
