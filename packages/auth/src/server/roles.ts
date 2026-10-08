import type { BrandConfig } from "@rafters/platform-contracts";
import type { BetterAuthPlugin } from "better-auth";
import { APIError, createAuthMiddleware } from "better-auth/api";
import {
  accessStatements,
  defaultStaffRoles,
  staffOrganizationSlug,
  type Statements,
} from "../shared/index.ts";

function isPermissionBody(value: unknown): value is Record<string, string[]> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The first permission in `requested` that the vocabulary does not have, as `resource:action`. */
export function outsideVocabulary(statements: Statements, requested: unknown): string | undefined {
  if (!isPermissionBody(requested)) return undefined;
  for (const [resource, actions] of Object.entries(requested)) {
    const known = Object.hasOwn(statements, resource) ? statements[resource] : undefined;
    if (known === undefined) return resource;
    for (const action of Array.isArray(actions) ? actions : []) {
      if (!known.includes(action)) return `${resource}:${action}`;
    }
  }
  return undefined;
}

/** The permission a create-role request carries at the top level, or an update-role request under `data`. */
function requestedPermission(body: unknown): unknown {
  if (typeof body !== "object" || body === null) return undefined;
  if ("permission" in body) return body.permission;
  if ("data" in body && typeof body.data === "object" && body.data !== null) {
    return "permission" in body.data ? body.data.permission : undefined;
  }
  return undefined;
}

/**
 * Refuses a role that grants a permission outside the brand's vocabulary. better-auth checks the
 * resource of a dynamic role but not its actions, so this checks both, before the role is written.
 */
export function roleVocabulary(brand: Pick<BrandConfig, "permissions">): BetterAuthPlugin {
  const statements = accessStatements(brand);
  return {
    id: "role-vocabulary",
    hooks: {
      before: [
        {
          matcher: (context) =>
            context.path === "/organization/create-role" ||
            context.path === "/organization/update-role",
          handler: createAuthMiddleware(async (ctx) => {
            const requested = requestedPermission(ctx.body);
            const outside = outsideVocabulary(statements, requested);
            if (outside !== undefined) {
              throw APIError.from("BAD_REQUEST", {
                code: "PERMISSION_OUTSIDE_VOCABULARY",
                message: `"${outside}" is not in this brand's permission vocabulary`,
              });
            }
          }),
        },
      ],
    },
  };
}

/** What seeding needs from `betterAuth(...)`: its context, whose adapter reads and writes the tables. */
export interface SeedTarget {
  $context: Promise<{
    adapter: {
      findOne(query: {
        model: string;
        where: { field: string; value: string }[];
      }): Promise<unknown>;
      create(query: { model: string; data: Record<string, unknown> }): Promise<unknown>;
    };
  }>;
}

/**
 * Create the brand's staff organization with the seven default staff roles as rows. Call it once at
 * setup, for example from the brand's first-run or deploy step. Does nothing when the staff
 * organization exists, so roles a brand has changed or removed are never put back. Returns whether it seeded.
 */
export async function seedStaffOrganization(
  auth: SeedTarget,
  brand: Pick<BrandConfig, "id" | "permissions">,
): Promise<boolean> {
  const { adapter } = await auth.$context;
  const slug = staffOrganizationSlug(brand);
  const existing = await adapter.findOne({
    model: "organization",
    where: [{ field: "slug", value: slug }],
  });
  if (existing) return false;

  const organization = await adapter.create({
    model: "organization",
    data: { name: `${brand.id} staff`, slug, createdAt: new Date() },
  });
  const organizationId =
    typeof organization === "object" && organization !== null && "id" in organization
      ? String(organization.id)
      : undefined;
  if (organizationId === undefined)
    throw new Error("the staff organization was created without an id");
  for (const [role, permission] of Object.entries(defaultStaffRoles(brand))) {
    await adapter.create({
      model: "organizationRole",
      data: {
        organizationId,
        role,
        permission: JSON.stringify(permission),
        createdAt: new Date(),
      },
    });
  }
  return true;
}
