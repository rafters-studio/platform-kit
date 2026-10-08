import { authOptions, type AuthEnv } from "@rafters/platform-auth/server";
import { betterAuth } from "better-auth";

/** The whole brand: its identity, its domain, who mail comes from, and what its roles may do. */
export const brand = {
  id: "testbrand",
  rootDomain: "testbrand.example",
  sending: { from: "hello@testbrand.example" },
  permissions: { project: ["read", "edit"] },
};

/** `env.SENDER` is the day-one sender binding; `env.DB` is the brand's D1 database. */
export const createAuth = (env: AuthEnv) => betterAuth(authOptions(brand, env));
