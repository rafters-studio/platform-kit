import type { BetterAuthClientPlugin } from "better-auth/client";
import type { vouch } from "../server/vouch.ts";

/** The client for the vouching endpoints: start, status, lookup, and approve. Matches the server `vouch` plugin. */
export const vouchClient = () =>
  ({
    id: "vouch",
    $InferServerPlugin: {} as ReturnType<typeof vouch>,
  }) satisfies BetterAuthClientPlugin;
