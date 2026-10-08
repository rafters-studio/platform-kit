import {
  parseBrandConfig,
  senderRequest,
  type BrandConfigInput,
} from "@rafters/platform-contracts";
import { passkey } from "@better-auth/passkey";
import type { BetterAuthOptions, BetterAuthPlugin } from "better-auth";
import { socialProviderList } from "better-auth/social-providers";
import { bearer } from "better-auth/plugins/bearer";
import { emailOTP } from "better-auth/plugins/email-otp";
import { createAccessControl } from "better-auth/plugins/access";
import { organization } from "better-auth/plugins/organization";
import { APIError } from "better-auth/api";
import { uuidv7 } from "uuidv7";
import {
  accessStatements,
  defaultOrganizationRoles,
  staffOrganizationSlug,
  userAdditionalFields,
} from "../shared/index.ts";
import type { AuthEnv } from "./env.ts";
import { auditPlugin, type LedgerModule } from "./audit.ts";
import { apiKeys, appPasswords } from "./app-passwords.ts";
import { credentialCascade } from "./credential-cascade.ts";
import { organizationCredentials } from "./org-credentials.ts";
import { phoneRecovery } from "./phone.ts";
import { announceRecovery, backupEmail, recoveryNotice } from "./recovery.ts";
import { roleVocabulary } from "./roles.ts";
import { CODE_LIFETIME_SECONDS, sendEmailCode } from "./send.ts";
import { vouch, vouchRegistration } from "./vouch.ts";

export type { AuthEnv } from "./env.ts";
export { seedStaffOrganization, type SeedTarget } from "./roles.ts";

/**
 * Optional modules a brand hands in for the features it turns on, so a brand that leaves a feature
 * off never loads its module. With ledger on, pass `import * as ledger from "@rafters/ledger/better-auth"`
 * and hand authOptions the wrapped binding, `{ ...env, DB: ledger.ledgerD1(env.DB) }`, so a change and its audit row commit in one D1 batch;
 * with a native app that has a scheme, pass `import * as expo from "@better-auth/expo"`.
 */
export interface AuthDeps {
  expo?: { expo(): BetterAuthPlugin };
  ledger?: LedgerModule;
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

  const ac = createAccessControl(accessStatements(brand));
  const organizationRoles = Object.fromEntries(
    Object.entries(defaultOrganizationRoles(brand)).map(([name, permissions]) => [
      name,
      ac.newRole(permissions),
    ]),
  );

  const keys = apiKeys();
  const cascade = credentialCascade();
  const plugins: BetterAuthPlugin[] = [
    // One relying party per brand: a passkey made on any subdomain works on all of them.
    // With vouching on, the device that started an approved recovery request may register without a session.
    passkey({
      rpID: brand.rootDomain,
      ...(brand.plugins.vouch
        ? {
            registration: vouchRegistration(brand.plugins.vouch, (ctx, userId) =>
              announceRecovery(ctx, brand, env.SENDER, userId, "vouch"),
            ),
          }
        : {}),
    }),
    emailOTP({
      sendVerificationOTP: sendEmailCode(brand, env.SENDER),
      expiresIn: CODE_LIFETIME_SECONDS,
    }),
    // App passwords for apps that only take a username and password, and organization credentials for
    // services acting for an organization; a key never signs in to the brand.
    keys,
    appPasswords(keys),
    organizationCredentials(keys, brand),
    cascade.plugin,
    // Members only see an organization's members, invitations, and details. Roles beyond owner, admin,
    // and member are rows per organization, read from the database on every permission check.
    organization({
      ac,
      roles: organizationRoles,
      dynamicAccessControl: { enabled: true },
      teams: { enabled: brand.plugins.teams },
      organizationHooks: {
        afterDeleteOrganization: cascade.afterDeleteOrganization,
        // The staff organization is seeded by the platform; nobody can claim its slug first.
        beforeCreateOrganization: async ({ organization: input }) => {
          if (input.slug === staffOrganizationSlug(brand)) {
            throw APIError.from("BAD_REQUEST", {
              code: "SLUG_RESERVED",
              message: "That organization slug is reserved",
            });
          }
        },
      },
      // The request is checked against the contract, so a name with a line break never reaches the sender.
      sendInvitationEmail: async (data) => {
        await env.SENDER.send(
          senderRequest.parse({
            brand: { id: brand.id, from: brand.sending.from },
            recipient: { channel: "email", to: data.email },
            message: {
              kind: "invitation",
              data: {
                organizationName: data.organization.name,
                role: data.role,
                url: `https://${brand.rootDomain}/accept-invitation/${encodeURIComponent(data.id)}`,
              },
            },
          }),
        );
      },
    }),
    roleVocabulary(brand),
    // Every recovery tells every channel the user has and signs out their other sessions.
    recoveryNotice(brand, env.SENDER),
  ];
  if (brand.recovery.backupEmail) plugins.push(backupEmail(brand, env.SENDER));
  if (brand.recovery.phone) plugins.push(phoneRecovery(brand, env.SENDER));
  if (brand.plugins.vouch) plugins.push(vouch(brand.plugins.vouch));
  if (brand.ledger && deps.ledger) plugins.push(auditPlugin(deps.ledger));

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
