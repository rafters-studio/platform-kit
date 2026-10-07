import { apiKey } from "@better-auth/api-key";
import type { BetterAuthPlugin } from "better-auth";
import { APIError, createAuthEndpoint } from "better-auth/api";
import * as z from "zod";

/** What an app password may do: connect to a mailbox over IMAP. Every user key carries it. */
export const IMAP_PERMISSION = { imap: ["connect"] };

const email = z.string().trim().toLowerCase().pipe(z.email());

/**
 * App passwords as two better-auth plugins. The first is better-auth's api-key plugin set up for app
 * passwords: a user key, named, hashed at rest, carrying the IMAP permission, and never a session.
 * Mail clients log in once per fetch, so no rate limit applies.
 *
 * The second is the IMAP check, `auth.api.verifyAppPassword`, reachable only from the server (the
 * mail service), never over HTTP. It runs the api-key plugin's own verification with the IMAP
 * permission required, then checks the key belongs to the user with the given email. Like every
 * direct auth.api call under a dynamic base URL, the caller passes `headers` carrying the brand's host.
 */
export function appPasswords(): BetterAuthPlugin[] {
  const keys = apiKey({
    enableSessionForAPIKeys: false,
    requireName: true,
    permissions: { defaultPermissions: IMAP_PERMISSION },
    rateLimit: { enabled: false },
  });
  const check: BetterAuthPlugin = {
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
            body: { key: ctx.body.password, permissions: IMAP_PERMISSION },
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
  return [keys, check];
}
