import type { BetterAuthPlugin } from "better-auth";
import { ORGANIZATION_CONFIG_ID } from "./app-passwords.ts";

/**
 * Deleting an owner removes the keys it owns. `apikey.referenceId` holds either a user id or an
 * organization id, so the column has no foreign key and the database cannot cascade; this does it.
 * A user's app passwords go with the user, and the user's deletion never touches organization
 * credentials. An organization's credentials go with the organization.
 *
 * `plugin` goes in the plugin list; `afterDeleteOrganization` goes in the organization plugin's
 * `organizationHooks`.
 */
export function credentialCascade() {
  let remove: ((configId: string, referenceId: string) => Promise<unknown>) | undefined;
  const removeKeys = async (configId: string, referenceId: string) => {
    if (remove === undefined) throw new Error("credentialCascade used before auth initialised");
    await remove(configId, referenceId);
  };
  const plugin: BetterAuthPlugin = {
    id: "credential-cascade",
    init(ctx) {
      remove = (configId, referenceId) =>
        ctx.adapter.deleteMany({
          model: "apikey",
          where: [
            { field: "configId", value: configId },
            { field: "referenceId", value: referenceId },
          ],
        });
      return {
        options: {
          databaseHooks: {
            user: { delete: { after: async (user) => removeKeys("default", user.id) } },
          },
        },
      };
    },
  };
  return {
    plugin,
    afterDeleteOrganization: async (data: { organization: { id: string } }) =>
      removeKeys(ORGANIZATION_CONFIG_ID, data.organization.id),
  };
}
