import type { BetterAuthPlugin, GenericEndpointContext } from "better-auth";
import { APIError, createAuthEndpoint, sessionMiddleware } from "better-auth/api";
import * as z from "zod";

/** What the brand's `plugins.vouch` carries when vouching is on. */
export interface VouchSettings {
  required: number;
  waitingPeriodSeconds: number;
}

/** A request stays open this long after its waiting period ends. */
const WINDOW_AFTER_READY_SECONDS = 3 * 24 * 60 * 60;
/** The cookie only the starting device holds. Host-only, so it is never sent to another subdomain. */
const DEVICE_COOKIE = "vouch_request";
/** No 0, O, 1, I, or L: a code read aloud or typed from a screen survives. */
const CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
const CODE_LENGTH = 8;

interface RequestRow {
  id: string;
  userId: string;
  code: string;
  secretHash: string;
  createdAt: Date;
  readyAt: Date;
  expiresAt: Date;
}

interface MemberRow {
  organizationId: string;
  userId: string;
}

const email = z.string().trim().toLowerCase().pipe(z.email());
const code = z.string().trim().toUpperCase().min(1);

function randomBelow(limit: number): number {
  const ceiling = 4_294_967_296 - (4_294_967_296 % limit);
  const word = new Uint32Array(1);
  do crypto.getRandomValues(word);
  while ((word[0] ?? ceiling) >= ceiling);
  return (word[0] ?? 0) % limit;
}

function newCode(): string {
  let out = "";
  for (let i = 0; i < CODE_LENGTH; i++) out += CODE_ALPHABET[randomBelow(CODE_ALPHABET.length)];
  return out;
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function denied(): APIError {
  return APIError.from("BAD_REQUEST", {
    code: "INVALID_VOUCH_REQUEST",
    message: "No such recovery request",
  });
}

/** The request this device started, if it holds the matching secret and the request is still open. */
async function deviceRequest(ctx: GenericEndpointContext): Promise<RequestRow | null> {
  const cookie = ctx.getCookie(DEVICE_COOKIE);
  const dot = cookie?.indexOf(".") ?? -1;
  if (!cookie || dot < 1) return null;
  const row = await ctx.context.adapter.findOne<RequestRow>({
    model: "vouchRequest",
    where: [{ field: "id", value: cookie.slice(0, dot) }],
  });
  if (!row || row.expiresAt < new Date()) return null;
  if ((await sha256Hex(cookie.slice(dot + 1))) !== row.secretHash) return null;
  return row;
}

async function approvalCount(ctx: GenericEndpointContext, requestId: string): Promise<number> {
  return ctx.context.adapter.count({
    model: "vouchApproval",
    where: [{ field: "requestId", value: requestId }],
  });
}

async function readyDeviceRequest(
  ctx: GenericEndpointContext,
  settings: VouchSettings,
): Promise<RequestRow | null> {
  const row = await deviceRequest(ctx);
  if (!row || row.readyAt > new Date()) return null;
  return (await approvalCount(ctx, row.id)) >= settings.required ? row : null;
}

async function discard(ctx: GenericEndpointContext, requestId: string): Promise<void> {
  const { adapter } = ctx.context;
  await adapter.deleteMany({
    model: "vouchApproval",
    where: [{ field: "requestId", value: requestId }],
  });
  await adapter.delete({ model: "vouchRequest", where: [{ field: "id", value: requestId }] });
}

/**
 * The passkey plugin's registration options with vouching on: the device that started a request,
 * and only that device, registers a passkey for the user once the request is approved and its wait
 * is over. Completing it consumes the request. A signed-in user registers as before.
 */
export function vouchRegistration(settings: VouchSettings) {
  return {
    requireSession: false,
    resolveUser: async ({ ctx }: { ctx: GenericEndpointContext }) => {
      const row = await readyDeviceRequest(ctx, settings);
      if (!row) {
        throw APIError.from("UNAUTHORIZED", {
          code: "VOUCH_NOT_READY",
          message: "This device has no approved recovery request",
        });
      }
      const user = await ctx.context.internalAdapter.findUserById(row.userId);
      if (!user) throw denied();
      return { id: user.id, name: user.email, displayName: user.email };
    },
    afterVerification: async ({
      ctx,
      user,
    }: {
      ctx: GenericEndpointContext;
      user: { id: string };
    }) => {
      const row = await readyDeviceRequest(ctx, settings);
      if (row && row.userId === user.id) {
        await discard(ctx, row.id);
        ctx.setCookie(DEVICE_COOKIE, "", { maxAge: 0, path: "/" });
      }
    },
  };
}

/**
 * Vouching recovery, as a better-auth plugin. A user who lost every other channel starts a request
 * on their own device, which keeps a secret and shows a short request code. Members of the user's
 * organization approve that request by its code. Approvers receive nothing that grants access: the
 * code alone does nothing, and completing needs the starting device's secret. It restores a
 * sign-in method only; the user's email is never touched.
 */
export function vouch(settings: VouchSettings): BetterAuthPlugin {
  return {
    id: "vouch",
    schema: {
      vouchRequest: {
        fields: {
          userId: { type: "string", references: { model: "user", field: "id" } },
          code: { type: "string", unique: true },
          secretHash: { type: "string" },
          createdAt: { type: "date" },
          readyAt: { type: "date" },
          expiresAt: { type: "date" },
        },
      },
      vouchApproval: {
        fields: {
          requestId: { type: "string", references: { model: "vouchRequest", field: "id" } },
          memberUserId: { type: "string", references: { model: "user", field: "id" } },
          createdAt: { type: "date" },
        },
      },
    },
    endpoints: {
      startVouch: createAuthEndpoint(
        "/vouch/start",
        { method: "POST", body: z.object({ email }) },
        async (ctx) => {
          const now = Date.now();
          const secret = crypto.randomUUID() + crypto.randomUUID();
          const found = await ctx.context.internalAdapter.findUserByEmail(ctx.body.email);
          let requestCode = newCode();
          // The response body is the same for an unknown address as for a known one. The device cookie is only set for a known user, so response headers and later /vouch/status calls can still differ.
          if (found) {
            const row = await ctx.context.adapter.create<Record<string, unknown>, RequestRow>({
              model: "vouchRequest",
              data: {
                userId: found.user.id,
                code: requestCode,
                secretHash: await sha256Hex(secret),
                createdAt: new Date(now),
                readyAt: new Date(now + settings.waitingPeriodSeconds * 1000),
                expiresAt: new Date(
                  now + (settings.waitingPeriodSeconds + WINDOW_AFTER_READY_SECONDS) * 1000,
                ),
              },
            });
            requestCode = row.code;
            ctx.setCookie(DEVICE_COOKIE, `${row.id}.${secret}`, {
              httpOnly: true,
              secure: true,
              sameSite: "strict",
              path: "/",
              maxAge: settings.waitingPeriodSeconds + WINDOW_AFTER_READY_SECONDS,
            });
          }
          return ctx.json({
            code: requestCode,
            required: settings.required,
            waitingPeriodSeconds: settings.waitingPeriodSeconds,
          });
        },
      ),
      vouchStatus: createAuthEndpoint("/vouch/status", { method: "GET" }, async (ctx) => {
        const row = await deviceRequest(ctx);
        if (!row) throw denied();
        const approvals = await approvalCount(ctx, row.id);
        return ctx.json({
          code: row.code,
          approvals,
          required: settings.required,
          readyAt: row.readyAt.toISOString(),
          ready: approvals >= settings.required && row.readyAt <= new Date(),
        });
      }),
      lookupVouch: createAuthEndpoint(
        "/vouch/request",
        { method: "GET", query: z.object({ code }), use: [sessionMiddleware] },
        async (ctx) => {
          const found = await findForMember(ctx, ctx.query.code);
          return ctx.json({
            name: found.requester.name,
            email: found.requester.email,
            startedAt: found.row.createdAt.toISOString(),
            approvals: await approvalCount(ctx, found.row.id),
            required: settings.required,
          });
        },
      ),
      approveVouch: createAuthEndpoint(
        "/vouch/approve",
        { method: "POST", body: z.object({ code }), use: [sessionMiddleware] },
        async (ctx) => {
          const found = await findForMember(ctx, ctx.body.code);
          const memberUserId = ctx.context.session.user.id;
          const { adapter } = ctx.context;
          // One approval per member: a second one from the same member changes nothing.
          const existing = await adapter.findOne({
            model: "vouchApproval",
            where: [
              { field: "requestId", value: found.row.id },
              { field: "memberUserId", value: memberUserId },
            ],
          });
          if (!existing) {
            await adapter.create({
              model: "vouchApproval",
              data: { requestId: found.row.id, memberUserId, createdAt: new Date() },
            });
          }
          // Nothing usable goes back to the approver: no session, token, or code.
          return ctx.json({
            approvals: await approvalCount(ctx, found.row.id),
            required: settings.required,
          });
        },
      ),
    },
  };
}

/** The open request with this code, for a signed-in member who shares an organization with its user. */
async function findForMember(
  ctx: GenericEndpointContext & { context: { session: { user: { id: string } } } },
  requestCode: string,
): Promise<{ row: RequestRow; requester: { name: string; email: string } }> {
  const { adapter, internalAdapter } = ctx.context;
  const row = await adapter.findOne<RequestRow>({
    model: "vouchRequest",
    where: [{ field: "code", value: requestCode }],
  });
  const approver = ctx.context.session.user.id;
  if (!row || row.expiresAt < new Date() || row.userId === approver) throw denied();
  const theirs = await adapter.findMany<MemberRow>({
    model: "member",
    where: [{ field: "userId", value: row.userId }],
  });
  const shared =
    theirs.length === 0
      ? null
      : await adapter.findOne<MemberRow>({
          model: "member",
          where: [
            { field: "userId", value: approver },
            {
              field: "organizationId",
              operator: "in",
              value: theirs.map((member) => member.organizationId),
            },
          ],
        });
  // The same answer for a wrong code and for a member of some other organization.
  if (!shared) throw denied();
  const requester = await internalAdapter.findUserById(row.userId);
  if (!requester) throw denied();
  return { row, requester: { name: requester.name, email: requester.email } };
}
