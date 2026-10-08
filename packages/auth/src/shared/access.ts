import type { BrandConfig } from "@rafters/platform-contracts";

/** Resources mapped to the actions that exist on them. */
export type Statements = Record<string, string[]>;

/** A role's permissions: resources mapped to the actions it grants. */
export type RolePermissions = Record<string, string[]>;

/**
 * What every brand has, whatever it configures: the organization plugin's own resources (its routes
 * check them) and the resources the seven default staff roles are written over.
 */
const PLATFORM_STATEMENTS: Statements = {
  organization: ["read", "update", "delete"],
  member: ["create", "update", "delete"],
  invitation: ["create", "cancel"],
  team: ["create", "update", "delete"],
  ac: ["create", "read", "update", "delete"],
  apiKey: ["create", "read", "update", "delete"],
  user: ["read", "update", "delete", "recover"],
  setting: ["read", "update"],
  subscription: ["read", "update"],
  invoice: ["read", "update"],
  audit: ["read"],
  event: ["read"],
  integration: ["read", "update"],
  credential: ["read", "update"],
  subscriber: ["read", "update"],
  content: ["read", "remove"],
  abuse: ["read", "resolve"],
  ban: ["create", "delete"],
};

function union(...parts: Statements[]): Statements {
  const merged: Statements = {};
  for (const part of parts) {
    for (const [resource, actions] of Object.entries(part)) {
      merged[resource] = [...new Set([...(merged[resource] ?? []), ...actions])];
    }
  }
  return merged;
}

/**
 * The brand's permission vocabulary: its configured `permissions` together with the platform's own
 * resources. Dynamic roles may grant these and nothing else.
 */
export function accessStatements(brand: Pick<BrandConfig, "permissions">): Statements {
  return union(PLATFORM_STATEMENTS, brand.permissions);
}

/** Pick whole resources, or only some of a resource's actions, out of the vocabulary. */
function pick(statements: Statements, picks: Record<string, string[] | true>): RolePermissions {
  const role: RolePermissions = {};
  for (const [resource, actions] of Object.entries(picks)) {
    role[resource] = actions === true ? [...(statements[resource] ?? [])] : actions;
  }
  return role;
}

/** The names of the seven default staff roles. */
export const STAFF_ROLE_NAMES = [
  "super",
  "manager",
  "support",
  "billing",
  "auditor",
  "developer",
  "moderator",
] as const;

export type StaffRoleName = (typeof STAFF_ROLE_NAMES)[number];

/**
 * The seven default staff roles, as FR-PLATFORM-AUTH-123 describes them. A brand's staff
 * organization is seeded with these as rows, and the brand changes, removes, or adds to them at runtime.
 */
export function defaultStaffRoles(
  brand: Pick<BrandConfig, "permissions">,
): Record<StaffRoleName, RolePermissions> {
  const all = accessStatements(brand);
  return {
    // Everything, staff roles included (ac).
    super: pick(all, Object.fromEntries(Object.keys(all).map((resource) => [resource, true]))),
    manager: pick(all, {
      user: true,
      organization: ["read", "update"],
      setting: true,
    }),
    support: pick(all, {
      user: ["read", "recover"],
      organization: ["read"],
      audit: true,
    }),
    billing: pick(all, { subscription: true, invoice: true }),
    auditor: pick(all, { audit: true, event: true }),
    developer: pick(all, { integration: true, credential: true, subscriber: true }),
    moderator: pick(all, { content: true, abuse: true, ban: true }),
  };
}

/**
 * The roles every organization has besides its database rows. An owner holds the whole vocabulary,
 * an admin runs the organization, its roles, and its credentials, a member can read roles.
 */
export function defaultOrganizationRoles(
  brand: Pick<BrandConfig, "permissions">,
): Record<"owner" | "admin" | "member", RolePermissions> {
  const all = accessStatements(brand);
  return {
    owner: pick(all, Object.fromEntries(Object.keys(all).map((resource) => [resource, true]))),
    admin: pick(all, {
      organization: ["update"],
      member: true,
      invitation: true,
      team: true,
      ac: true,
      apiKey: true,
    }),
    member: pick(all, { organization: [], member: [], invitation: [], team: [], ac: ["read"] }),
  };
}

/** The slug of a brand's staff organization. Nobody else may create an organization with it. */
export function staffOrganizationSlug(brand: Pick<BrandConfig, "id">): string {
  return `${brand.id}-staff`;
}
