import { eventEnvelope, type AuthEvent } from "@rafters/platform-contracts";
import type { BetterAuthPlugin } from "better-auth";
import { createAuthMiddleware, isAPIError } from "better-auth/api";
import { uuidv7 } from "uuidv7";

/** One row of ledger's audit table, the outbox change events are published from. */
export interface AuditRow {
  id: string;
  tableName: string;
  recordId: string;
  action: string;
  oldData: string | null;
  newData: string | null;
  subjectUserId: string | null;
  createdAt: string | number;
}

const actions: Record<string, "created" | "updated" | "deleted"> = {
  INSERT: "created",
  UPDATE: "updated",
  SOFT_DELETE: "deleted",
  DELETE: "deleted",
};

function parse(json: string | null): Record<string, unknown> | null {
  if (json === null) return null;
  const value: unknown = JSON.parse(json);
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? Object.fromEntries(Object.entries(value))
    : null;
}

/**
 * Field names only. A create or delete changes every field of the row; an update changes the fields
 * whose stored value differs. Ledger writes a secret as "[REDACTED]" on both sides, so a secret field
 * of an updated row cannot be told apart and is listed (a thin event may over-report, never leak).
 */
function changedFields(
  action: string,
  before: Record<string, unknown> | null,
  after: Record<string, unknown> | null,
): string[] {
  if (action === "INSERT") return Object.keys(after ?? {});
  if (action === "DELETE") return Object.keys(before ?? {});
  const names = new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})]);
  return [...names].filter(
    (name) =>
      before?.[name] === "[REDACTED]" ||
      after?.[name] === "[REDACTED]" ||
      JSON.stringify(before?.[name]) !== JSON.stringify(after?.[name]),
  );
}

/**
 * The user the changed record belongs to; never the actor. Ledger writes it for a user row and for any
 * row with a userId. The rest belong to no user: an organization row is its own subject, an invitation
 * concerns its organization, and an apikey belongs to its referenceId (a user, or an organization for
 * an organization credential).
 */
function subjectOf(row: AuditRow, data: Record<string, unknown> | null): string | undefined {
  if (row.subjectUserId !== null) return row.subjectUserId;
  if (row.tableName === "organization") return row.recordId;
  const field = row.tableName === "invitation" ? "organizationId" : "referenceId";
  const value = data?.[field];
  return typeof value === "string" && value !== "" ? value : undefined;
}

/**
 * The thin change event for one audit row, parsed with the platform envelope; undefined when the row
 * names no subject or no known action, so one odd row never blocks the relay behind it. The event id
 * is the audit row's id, so a row sent twice after a failed publish is the same event twice.
 */
export function changeEvent(brandId: string, row: AuditRow): AuthEvent | undefined {
  const action = actions[row.action];
  if (action === undefined) return undefined;
  const before = parse(row.oldData);
  const after = parse(row.newData);
  const subject = subjectOf(row, after ?? before);
  if (subject === undefined) return undefined;
  const parsed = eventEnvelope.safeParse({
    id: row.id,
    type: `auth.${row.tableName}.${action}`,
    brand: brandId,
    subject,
    time: new Date(row.createdAt).toISOString(),
    data: { recordId: row.recordId, changedFields: changedFields(row.action, before, after) },
  });
  return parsed.success ? parsed.data : undefined;
}

/** A keyed hash of an attempted address: HMAC-SHA256 under the brand secret, lower-case hex. */
export async function addressHash(secret: string, address: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(address.trim().toLowerCase()),
  );
  return [...new Uint8Array(mac)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

const ATTEMPTS = 3;
const FIRST_DELAY_MS = 250;

/** Send one event to the queue, retrying with doubling delays; throws the last error when every attempt fails. */
export async function sendWithRetries(queue: Queue<AuthEvent>, event: AuthEvent): Promise<void> {
  let failure: unknown;
  for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, FIRST_DELAY_MS * 2 ** (attempt - 1)));
    try {
      await queue.send(event, { contentType: "json" });
      return;
    } catch (error) {
      failure = error;
    }
  }
  throw failure;
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined;
}

/**
 * Sign-in-failed events, from after-hooks on the sign-in endpoints. Best effort and never in the
 * response path: the send, with its retries, is handed to the context's background runner (set
 * `advanced.backgroundTasks.handler` to `waitUntil`), and a failure there is dropped. They write no
 * ledger entry and never pass through the outbox. The subject is the user the attempted address or
 * passkey matches; an address matching no user is carried only as a keyed hash.
 */
export function signInFailedEvents(
  brandId: string,
  secret: string,
  queue: Queue<AuthEvent>,
): BetterAuthPlugin {
  return {
    id: "sign-in-failed-events",
    hooks: {
      after: [
        {
          matcher: (context) =>
            context.path === "/sign-in/email-otp" ||
            context.path === "/passkey/verify-authentication",
          handler: createAuthMiddleware(async (ctx) => {
            if (!isAPIError(ctx.context.returned)) return;
            const body: unknown = ctx.body;
            const fields = typeof body === "object" && body !== null ? body : {};
            const announce = async (): Promise<void> => {
              let subject: string | undefined;
              let hash: string | undefined;
              let method: "email-otp" | "passkey";
              if (ctx.path === "/passkey/verify-authentication") {
                method = "passkey";
                const response = "response" in fields ? fields.response : undefined;
                const id =
                  typeof response === "object" && response !== null && "id" in response
                    ? text(response.id)
                    : undefined;
                if (id === undefined) return;
                const found = await ctx.context.adapter.findOne<{ userId: string }>({
                  model: "passkey",
                  where: [{ field: "credentialID", value: id }],
                });
                subject = found?.userId;
              } else {
                method = "email-otp";
                const address = "email" in fields ? text(fields.email) : undefined;
                if (address === undefined) return;
                const found = await ctx.context.internalAdapter.findUserByEmail(address);
                subject = found?.user.id;
                if (subject === undefined) hash = await addressHash(secret, address);
              }
              const parsed = eventEnvelope.safeParse({
                id: uuidv7(),
                type: "auth.sign-in.failed",
                brand: brandId,
                time: new Date().toISOString(),
                ...(subject === undefined ? {} : { subject }),
                data: { method, ...(hash === undefined ? {} : { addressHash: hash }) },
              });
              if (parsed.success) await sendWithRetries(queue, parsed.data);
            };
            ctx.context.runInBackground(announce());
          }),
        },
      ],
    },
  };
}
