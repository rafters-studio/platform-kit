import type { BrandConfig } from "@rafters/platform-contracts";
import type { BetterAuthOptions, BetterAuthPlugin } from "better-auth";
import { APIError } from "better-auth/api";
import { userAdditionalFields } from "../shared/index.ts";

/**
 * The part of `@rafters/ledger` (the core entry, not `/better-auth`) a brand with `gdpr` hands in.
 * Ledger's GDPR helpers exist only with ledger on, so auth never imports them itself.
 */
export interface GdprModule {
  anonymizeJsonData(data: unknown, piiFields: string[]): unknown;
  DEFAULT_PII_FIELDS: string[];
}

/**
 * Check a brand's regulations against what deletion needs, at deploy time. gdpr, soc2, and hipaa all
 * work on the audit trail (gdpr erases personal fields from it, soc2 and hipaa keep it), so each needs
 * ledger on; gdpr also needs ledger's core module. Returns the module when the brand must erase.
 */
export function erasureModule(
  brand: BrandConfig,
  gdpr: GdprModule | undefined,
): GdprModule | undefined {
  if (brand.regulations.length > 0 && !brand.ledger) {
    throw new Error(
      `brand "${brand.id}" lists regulations (${brand.regulations.join(", ")}) that need the audit trail; turn ledger on`,
    );
  }
  if (!brand.regulations.includes("gdpr")) return undefined;
  if (gdpr === undefined) {
    throw new Error(
      `brand "${brand.id}" lists gdpr; pass ledger's core module: authOptions(brand, env, { ledger, gdpr })`,
    );
  }
  return gdpr;
}

interface Row {
  id: string;
  [field: string]: unknown;
}

/** Whether a member's role (one role, or several separated by commas) includes owner. */
function isOwner(role: unknown): boolean {
  return (
    typeof role === "string" &&
    role
      .split(",")
      .map((r) => r.trim())
      .includes("owner")
  );
}

const PURGED = "PURGED_USER";

/**
 * Account deletion. Returns the `user.deleteUser` options and a plugin; `authOptions` wires both.
 *
 * - A user who is the only owner of an organization cannot delete the account until the organization
 *   has another owner or is deleted.
 * - Deleting revokes the user's app passwords, whether better-auth deletes the row (ledger off) or
 *   ledger soft-deletes it (ledger on).
 * - With ledger on, nobody signs in to a soft-deleted user: creating a session for one is refused.
 * - With gdpr, the soft-deleted row is scrubbed of personal fields and the user's audit rows lose
 *   their personal field values. Ids stay, so the `auth.user.deleted` event from the outbox relay
 *   still names its subject.
 */
export function accountDeletion(brand: BrandConfig, gdpr: GdprModule | undefined) {
  type Adapter = Parameters<NonNullable<BetterAuthPlugin["init"]>>[0]["adapter"];
  let adapter: Adapter | undefined;
  const use = (): Adapter => {
    if (adapter === undefined) throw new Error("accountDeletion used before auth initialised");
    return adapter;
  };

  const personalFields = [
    "name",
    "email",
    "image",
    ...Object.keys(userAdditionalFields(brand)).filter(
      (name) => name !== "deletedAt" && name !== "deletedBy" && !name.endsWith("Verified"),
    ),
  ];

  async function refuseLastOwner(userId: string): Promise<void> {
    const db = use();
    const mine = await db.findMany<Row>({
      model: "member",
      where: [{ field: "userId", value: userId }],
    });
    for (const membership of mine.filter((m) => isOwner(m.role))) {
      const members = await db.findMany<Row>({
        model: "member",
        where: [{ field: "organizationId", value: String(membership.organizationId) }],
      });
      if (!members.some((m) => m.userId !== userId && isOwner(m.role))) {
        throw APIError.from("BAD_REQUEST", {
          code: "LAST_OWNER",
          message: "Hand the organization to another owner or delete it first",
        });
      }
    }
  }

  async function revokeAppPasswords(userId: string): Promise<void> {
    await use().deleteMany({
      model: "apikey",
      where: [
        { field: "configId", value: "default" },
        { field: "referenceId", value: userId },
      ],
    });
  }

  async function erase(userId: string, module: GdprModule): Promise<void> {
    const db = use();
    const found = await db.findOne({ model: "user", where: [{ field: "id", value: userId }] });
    // Hard-deleted (ledger off) or already gone: nothing is left to scrub.
    if (found === null) return;
    await db.update({
      model: "user",
      where: [{ field: "id", value: userId }],
      update: {
        name: "Deleted user",
        email: `deleted+${userId}@invalid`,
        image: null,
        ...Object.fromEntries(
          personalFields
            .filter((name) => name !== "name" && name !== "email" && name !== "image")
            .map((name) => [name, null]),
        ),
      },
    });
    const audit = await db.findMany<Row>({
      model: "ledgerAudit",
      where: [{ field: "subjectUserId", value: userId }],
    });
    for (const row of audit) {
      const clean = (value: unknown): string | null => {
        if (typeof value !== "string") return null;
        try {
          return JSON.stringify(
            module.anonymizeJsonData(JSON.parse(value) as unknown, module.DEFAULT_PII_FIELDS),
          );
        } catch {
          // Unreadable JSON cannot be proven clean, so it is dropped rather than kept.
          return null;
        }
      };
      await db.update({
        model: "ledgerAudit",
        where: [{ field: "id", value: row.id }],
        update: {
          oldData: clean(row.oldData),
          newData: clean(row.newData),
          userId: row.userId === userId ? PURGED : row.userId,
        },
      });
    }
  }

  const plugin: BetterAuthPlugin = {
    id: "account-deletion",
    init(ctx) {
      adapter = ctx.adapter;
      return {
        options: {
          databaseHooks: {
            session: {
              create: {
                // Ledger's soft delete keeps the user row, and better-auth's session resolution does not
                // know deletedAt, so sign-in is refused here for a deleted user.
                before: async (session) => {
                  if (!brand.ledger) return;
                  const user = await use().findOne<{ deletedAt?: unknown }>({
                    model: "user",
                    where: [{ field: "id", value: session.userId }],
                  });
                  if (user?.deletedAt) {
                    throw APIError.from("FORBIDDEN", {
                      code: "ACCOUNT_DELETED",
                      message: "This account was deleted",
                    });
                  }
                },
              },
            },
          },
        },
      };
    },
  };

  const deleteUser: NonNullable<NonNullable<BetterAuthOptions["user"]>["deleteUser"]> = {
    enabled: true,
    beforeDelete: async (user) => refuseLastOwner(user.id),
    afterDelete: async (user) => {
      await revokeAppPasswords(user.id);
      if (gdpr) await erase(user.id, gdpr);
    },
  };

  return { deleteUser, plugin };
}
