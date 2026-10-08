import { apiKey } from "@better-auth/api-key";
import type { BetterAuthPlugin } from "better-auth";
import { APIError, createAuthEndpoint } from "better-auth/api";
import * as z from "zod";

/** What an app password may do: connect to a mailbox over IMAP. Every user key carries it. */
export const IMAP_PERMISSION = { imap: ["connect"] };

const email = z.string().trim().toLowerCase().pipe(z.email());

/** The api-key plugin, narrowed to the endpoints this package calls with a context. */
export type ApiKeys = BetterAuthPlugin & {
  endpoints: {
    createApiKey(input: never): Promise<Record<string, unknown>>;
    verifyApiKey(input: never): Promise<unknown>;
  };
};

/** The api-key configuration that organization credentials use. */
export const ORGANIZATION_CONFIG_ID = "organization";

/**
 * The brand's one api-key plugin, with two configurations. The default one is app passwords: a user
 * key, named, hashed at rest, carrying the IMAP permission, and never a session. Mail clients log in
 * once per fetch, so no rate limit applies. The `organization` one is organization credentials (see
 * organizationCredentials): keys owned by an organization, which authenticate no user.
 */
export function apiKeys(): ApiKeys {
  return apiKey([
    {
      configId: "default",
      enableSessionForAPIKeys: false,
      requireName: true,
      permissions: { defaultPermissions: IMAP_PERMISSION },
      rateLimit: { enabled: false },
    },
    {
      configId: ORGANIZATION_CONFIG_ID,
      references: "organization",
      enableSessionForAPIKeys: false,
      requireName: true,
      rateLimit: { enabled: false },
    },
  ]);
}

/**
 * The IMAP check, `auth.api.verifyAppPassword`, reachable only from the server (the
 * mail service), never over HTTP. It runs the api-key plugin's own verification with the IMAP
 * permission required, then checks the key belongs to the user with the given email. Like every
 * direct auth.api call under a dynamic base URL, the caller passes `headers` carrying the brand's host.
 */
export function appPasswords(keys: ApiKeys): BetterAuthPlugin {
  return {
    id: "app-password-imap",
    endpoints: {
      verifyAppPassword: createAuthEndpoint(
        "/app-password/verify",
        {
          method: "POST",
          body: z.object({ email, password: z.string().min(1) }),
          metadata: { SERVER_ONLY: true },
        },
        async (ctx) => {
          const found = await ctx.context.internalAdapter.findUserByEmail(ctx.body.email);
          // Called with a context, the endpoint returns its JSON body, though better-auth types it as a Response.
          const verified = (await keys.endpoints.verifyApiKey({
            body: { configId: "default", key: ctx.body.password, permissions: IMAP_PERMISSION },
            context: ctx.context,
          } as never)) as unknown as { valid: boolean; key: { referenceId: string } | null };
          if (!found || !verified.valid || verified.key?.referenceId !== found.user.id) {
            throw APIError.from("UNAUTHORIZED", {
              code: "INVALID_APP_PASSWORD",
              message: "Invalid app password",
            });
          }
          return ctx.json({ user: found.user });
        },
      ),
    },
  };
}
