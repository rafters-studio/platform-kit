import type { Sender } from "@rafters/platform-contracts";

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
   * Credentials for each social provider a brand lists in `socialProviders`, as `<ID>_CLIENT_ID` and
   * `<ID>_CLIENT_SECRET` with the id upper-cased and `-` as `_` (github: GITHUB_CLIENT_ID).
   */
  [credential: `${string}_CLIENT_ID` | `${string}_CLIENT_SECRET`]: string | undefined;
}
