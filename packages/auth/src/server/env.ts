/**
 * Worker bindings and secrets authOptions reads. Later issues add their own fields.
 * D1Database is the Workers runtime global (from @cloudflare/workers-types or `wrangler types`).
 */
export interface AuthEnv {
  DB: D1Database;
  BETTER_AUTH_SECRET: string;
}
