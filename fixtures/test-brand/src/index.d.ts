import { type AuthEnv } from "@rafters/platform-auth/server";
/** The whole brand: its identity, its domain, who mail comes from, and what its roles may do. */
export declare const brand: {
  id: string;
  rootDomain: string;
  sending: {
    from: string;
  };
  permissions: {
    project: string[];
  };
};
/** `env.SENDER` is the day-one sender binding; `env.DB` is the brand's D1 database. */
export declare const createAuth: (env: AuthEnv) => import("better-auth").Auth<any>;
