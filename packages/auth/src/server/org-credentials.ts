import type { BrandConfig } from "@rafters/platform-contracts";
import type { BetterAuthPlugin } from "better-auth";
import { APIError, createAuthEndpoint, sessionMiddleware } from "better-auth/api";
import * as z from "zod";
import { accessStatements } from "../shared/index.ts";
import { ORGANIZATION_CONFIG_ID, type ApiKeys } from "./app-passwords.ts";
import { outsideVocabulary } from "./roles.ts";

const permissions = z.record(z.string(), z.array(z.string()));

/**
 * Organization credentials: api keys owned by an organization, for services acting on its behalf. A
 * key belongs to the organization, so it keeps working when the member who made it leaves.
 *
 * Creating one is `POST /organization-credential/create`: a signed-in member whose role holds
 * `apiKey:create` names it and gives it permissions from the brand's vocabulary (better-auth only
 * lets the server set a key's permissions, so this endpoint is the server). Listing and revoking are
 * the api-key plugin's own `/api-key/list?organizationId=` and `/api-key/delete`, gated on the
 * `apiKey` role permissions.
 *
 * `auth.api.verifyOrganizationCredential` is the service-side check, reachable only from the server:
 * it answers with the organization the credential belongs to, and refuses a credential that is
 * unknown, revoked, or lacks a permission the call requires. Like every direct auth.api call under a
 * dynamic base URL, the caller passes `headers` carrying the brand's host.
 */
export function organizationCredentials(
  keys: ApiKeys,
  brand: Pick<BrandConfig, "permissions">,
): BetterAuthPlugin {
  const vocabulary = accessStatements(brand);
  return {
    id: "organization-credentials",
    endpoints: {
      createOrganizationCredential: createAuthEndpoint(
        "/organization-credential/create",
        {
          method: "POST",
          body: z.object({
            organizationId: z.string().min(1),
            name: z.string().min(1),
            permissions,
          }),
          use: [sessionMiddleware],
        },
        async (ctx) => {
          const outside = outsideVocabulary(vocabulary, ctx.body.permissions);
          if (outside !== undefined) {
            throw APIError.from("BAD_REQUEST", {
              code: "PERMISSION_OUTSIDE_VOCABULARY",
              message: `"${outside}" is not in this brand's permission vocabulary`,
            });
          }
          // Called with a context, the endpoint returns its JSON body, though better-auth types it as a Response.
          return ctx.json(
            await keys.endpoints.createApiKey({
              body: {
                configId: ORGANIZATION_CONFIG_ID,
                organizationId: ctx.body.organizationId,
                userId: ctx.context.session.user.id,
                name: ctx.body.name,
                permissions: ctx.body.permissions,
              },
              context: ctx.context,
            } as never),
          );
        },
      ),
      verifyOrganizationCredential: createAuthEndpoint(
        "/organization-credential/verify",
        {
          method: "POST",
          body: z.object({ key: z.string().min(1), permissions: permissions.optional() }),
          metadata: { SERVER_ONLY: true },
        },
        async (ctx) => {
          const verified = (await keys.endpoints.verifyApiKey({
            body: { configId: ORGANIZATION_CONFIG_ID, ...ctx.body },
            context: ctx.context,
          } as never)) as unknown as {
            valid: boolean;
            key: { id: string; referenceId: string; permissions: unknown } | null;
          };
          // A key's owner is an id, not a foreign key, so a deleted organization's credentials stop here.
          const organization =
            verified.valid && verified.key !== null
              ? await ctx.context.adapter.findOne({
                  model: "organization",
                  where: [{ field: "id", value: verified.key.referenceId }],
                })
              : null;
          if (!verified.valid || verified.key === null || organization === null) {
            throw APIError.from("UNAUTHORIZED", {
              code: "INVALID_ORGANIZATION_CREDENTIAL",
              message: "Invalid organization credential",
            });
          }
          return ctx.json({
            organizationId: verified.key.referenceId,
            keyId: verified.key.id,
            permissions: verified.key.permissions,
          });
        },
      ),
    },
  };
}
