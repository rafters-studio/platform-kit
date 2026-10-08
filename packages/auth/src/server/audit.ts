import type { BetterAuthPlugin } from "better-auth";

/**
 * The models audited when a brand turns ledger on: users, sign-in methods, passkeys, app passwords and
 * organization credentials (the apikey model), sessions, organizations, memberships, and invitations.
 */
export const auditedModels = [
  "user",
  "account",
  "passkey",
  "apikey",
  "session",
  "organization",
  "member",
  "invitation",
] as const;

/**
 * The part of `@rafters/ledger/better-auth` auth uses. A brand with ledger on passes the module in
 * (`import * as ledger from "@rafters/ledger/better-auth"`), so auth itself never imports ledger and a
 * ledger-off brand runs plain better-auth.
 */
export interface LedgerModule {
  ledgerPlugin(config: { softDeleteUser: true; auditTables: readonly string[] }): BetterAuthPlugin;
}

/**
 * The ledger plugin for a brand with ledger on. With no `writeAuditEntry`, ledger writes each change and
 * its audit row together: both exist or neither does. The actor is the hook context's session user, then
 * the ledger context. Failed sign-ins change no data, so they write nothing.
 */
export function auditPlugin(ledger: LedgerModule): BetterAuthPlugin {
  return ledger.ledgerPlugin({ softDeleteUser: true, auditTables: auditedModels });
}
