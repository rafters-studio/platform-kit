import { senderRequest, type BrandConfig, type Sender } from "@rafters/platform-contracts";
import type { BetterAuthPlugin } from "better-auth";
import { APIError, createAuthEndpoint, sessionMiddleware } from "better-auth/api";
import { setSessionCookie } from "better-auth/cookies";
import * as z from "zod";
import { CODE_LIFETIME_SECONDS } from "./send.ts";

/** Wrong guesses allowed against one code before it is thrown away. */
const ALLOWED_ATTEMPTS = 3;

const email = z.string().trim().toLowerCase().pipe(z.email());
const code = z.string().min(1);

type CodeKind = "verification-code" | "recovery-code";

/** A six digit code from the platform's random source. */
function newCode(): string {
  const limit = 4_294_000_000; // largest multiple of 1,000,000 under 2^32, so every digit string is equally likely
  const word = new Uint32Array(1);
  do crypto.getRandomValues(word);
  while ((word[0] ?? limit) >= limit);
  return String((word[0] ?? 0) % 1_000_000).padStart(6, "0");
}

/** The stored code is `<code>:<wrong guesses so far>`. */
function split(value: string): [string, number] {
  const at = value.lastIndexOf(":");
  return [value.slice(0, at), Number(value.slice(at + 1))];
}

/**
 * The backup email recovery channel, as a better-auth plugin. A user adds a backup address and
 * verifies it with a code sent there; only a verified address ever receives a recovery code. A user
 * who lost their passkeys asks for a recovery code, signs in with it, and registers a new passkey on
 * that session. Nothing here asks for an identity document.
 */
export function backupEmail(brand: BrandConfig, sender: Sender): BetterAuthPlugin {
  async function deliver(to: string, kind: CodeKind, value: string): Promise<void> {
    const expiresAt = new Date(Date.now() + CODE_LIFETIME_SECONDS * 1000).toISOString();
    await sender.send(
      senderRequest.parse({
        brand: { id: brand.id, from: brand.sending.from },
        recipient: { channel: "email", to },
        message: { kind, data: { code: value, expiresAt } },
      }),
    );
  }

  return {
    id: "backup-email",
    endpoints: {
      addBackupEmail: createAuthEndpoint(
        "/backup-email/add",
        { method: "POST", body: z.object({ email }), use: [sessionMiddleware] },
        async (ctx) => {
          const user = ctx.context.session.user;
          if (ctx.body.email === user.email.toLowerCase()) {
            throw APIError.from("BAD_REQUEST", {
              code: "BACKUP_EMAIL_IS_PRIMARY",
              message: "The backup email must differ from the primary email",
            });
          }
          const { internalAdapter } = ctx.context;
          await internalAdapter.updateUser(user.id, {
            backupEmail: ctx.body.email,
            backupEmailVerified: false,
          });
          const value = newCode();
          const identifier = `backup-email-verify:${user.id}`;
          await internalAdapter.deleteVerificationByIdentifier(identifier);
          await internalAdapter.createVerificationValue({
            identifier,
            value: `${value}:0`,
            expiresAt: new Date(Date.now() + CODE_LIFETIME_SECONDS * 1000),
          });
          await deliver(ctx.body.email, "verification-code", value);
          return ctx.json({ success: true });
        },
      ),
      verifyBackupEmail: createAuthEndpoint(
        "/backup-email/verify",
        { method: "POST", body: z.object({ code }), use: [sessionMiddleware] },
        async (ctx) => {
          const user = ctx.context.session.user;
          const identifier = `backup-email-verify:${user.id}`;
          await consume(ctx.context.internalAdapter, identifier, ctx.body.code);
          await ctx.context.internalAdapter.updateUser(user.id, { backupEmailVerified: true });
          return ctx.json({ success: true });
        },
      ),
      removeBackupEmail: createAuthEndpoint(
        "/backup-email/remove",
        { method: "POST", use: [sessionMiddleware] },
        async (ctx) => {
          const user = ctx.context.session.user;
          const { internalAdapter } = ctx.context;
          await internalAdapter.updateUser(user.id, {
            backupEmail: null,
            backupEmailVerified: false,
          });
          await internalAdapter.deleteVerificationByIdentifier(`backup-email-verify:${user.id}`);
          await internalAdapter.deleteVerificationByIdentifier(`backup-email-recovery:${user.id}`);
          return ctx.json({ success: true });
        },
      ),
      sendBackupEmailRecoveryCode: createAuthEndpoint(
        "/recovery/backup-email/send",
        { method: "POST", body: z.object({ email }) },
        async (ctx) => {
          // The same answer whether or not the account exists or has a verified backup, so this
          // endpoint cannot be used to find out who has an account here.
          const found = await ctx.context.internalAdapter.findUserByEmail(ctx.body.email);
          const user = found?.user as
            | { id: string; backupEmail?: string | null; backupEmailVerified?: boolean }
            | undefined;
          if (user?.backupEmail && user.backupEmailVerified) {
            const value = newCode();
            const identifier = `backup-email-recovery:${user.id}`;
            await ctx.context.internalAdapter.deleteVerificationByIdentifier(identifier);
            await ctx.context.internalAdapter.createVerificationValue({
              identifier,
              value: `${value}:0`,
              expiresAt: new Date(Date.now() + CODE_LIFETIME_SECONDS * 1000),
            });
            await deliver(user.backupEmail, "recovery-code", value);
          }
          return ctx.json({ success: true });
        },
      ),
      signInWithBackupEmailCode: createAuthEndpoint(
        "/recovery/backup-email/sign-in",
        { method: "POST", body: z.object({ email, code }) },
        async (ctx) => {
          const { internalAdapter } = ctx.context;
          const found = await internalAdapter.findUserByEmail(ctx.body.email);
          const user = found?.user as { id: string; backupEmailVerified?: boolean } | undefined;
          if (!found || !user || !user.backupEmailVerified) throw invalidCode();
          await consume(internalAdapter, `backup-email-recovery:${user.id}`, ctx.body.code);
          const session = await internalAdapter.createSession(user.id);
          await setSessionCookie(ctx, { session, user: found.user });
          return ctx.json({ token: session.token });
        },
      ),
    },
  };
}

function invalidCode(): APIError {
  return APIError.from("BAD_REQUEST", { code: "INVALID_CODE", message: "Invalid or expired code" });
}

type Verifications = {
  findVerificationValue(
    identifier: string,
  ): Promise<{ value: string; expiresAt: Date } | null | undefined>;
  deleteVerificationByIdentifier(identifier: string): Promise<void>;
  updateVerificationByIdentifier(identifier: string, data: { value: string }): Promise<unknown>;
};

/** Check a code against the stored one: single use, expiring, and burned after too many wrong guesses. */
async function consume(store: Verifications, identifier: string, given: string): Promise<void> {
  const stored = await store.findVerificationValue(identifier);
  if (!stored) throw invalidCode();
  if (stored.expiresAt < new Date()) {
    await store.deleteVerificationByIdentifier(identifier);
    throw invalidCode();
  }
  const [expected, attempts] = split(stored.value);
  if (attempts >= ALLOWED_ATTEMPTS) {
    await store.deleteVerificationByIdentifier(identifier);
    throw invalidCode();
  }
  if (expected !== given) {
    await store.updateVerificationByIdentifier(identifier, {
      value: `${expected}:${attempts + 1}`,
    });
    throw invalidCode();
  }
  await store.deleteVerificationByIdentifier(identifier);
}
