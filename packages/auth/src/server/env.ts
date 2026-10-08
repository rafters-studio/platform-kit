import type { AuthEvent, Sender } from "@rafters/platform-contracts";

/**
 * Worker bindings and secrets authOptions reads. Later issues add their own fields.
 * D1Database is the Workers runtime global (from @cloudflare/workers-types or `wrangler types`).
 */
export interface AuthEnv {
  DB: D1Database;
  BETTER_AUTH_SECRET: string;
  /** Delivers every message auth sends. Day one: a sender on Cloudflare's transactional send_email binding. */
  SENDER: Sender;
  /**
   * The brand's Cloudflare Queue producer for auth events. Read only with `ledger: true`: the relay
   * publishes change events to it and the sign-in endpoint hooks send sign-in-failed events to it.
   */
  EVENTS?: Queue<AuthEvent>;
  /**
   * Credentials for each social provider a brand lists in `socialProviders`, as `<ID>_CLIENT_ID` and
   * `<ID>_CLIENT_SECRET` with the id upper-cased and `-` as `_` (github: GITHUB_CLIENT_ID).
   */
  [credential: `${string}_CLIENT_ID` | `${string}_CLIENT_SECRET`]: string | undefined;
}
