import { senderRequest, type BrandConfigInput } from "@rafters/platform-contracts";
import { betterAuth } from "better-auth";
import { expect } from "vite-plus/test";
import { authOptions, type AuthEnv } from "../../src/server/index.ts";
import { migratedDatabase } from "./database.ts";
import { recordingSender } from "./sender.ts";

interface Cookie {
  value: string;
  domain: string;
  /** Set without a Domain attribute: sent back only to the host that set it. */
  hostOnly: boolean;
}

export type BrandFetch = (
  path: string,
  body?: unknown,
) => Promise<{ status: number; json: Record<string, unknown> | null }>;

/** One brand's auth on a database built from the shipped migrations, driven over HTTP like a browser. */
export function brandAuth(brand: BrandConfigInput, credentials: Record<string, string> = {}) {
  const sender = recordingSender();
  const env: AuthEnv = {
    ...credentials,
    DB: {} as AuthEnv["DB"],
    BETTER_AUTH_SECRET: "test-secret-0123456789abcdef0123456789",
    SENDER: sender,
  };
  const auth = betterAuth({
    ...authOptions(brand, env),
    database: migratedDatabase({ ledger: false }),
  });

  /**
   * A browser: one cookie jar for every host it visits, keeping each cookie's Domain the way a browser
   * does. Call it at the root domain, or use `.at(host)` for a subdomain sharing the same jar; `origin`
   * overrides the page origin a request claims, as a script on another site would send.
   */
  function browser(): BrandFetch & {
    at(host: string, origin?: string): BrandFetch;
    cookies(): Map<string, Cookie>;
  } {
    const jar = new Map<string, Cookie>();
    const sends = (cookie: Cookie, host: string) =>
      cookie.hostOnly
        ? host === cookie.domain
        : host === cookie.domain || host.endsWith(`.${cookie.domain}`);

    const at = (host: string, origin = `https://${host}`): BrandFetch => {
      return async (path, body) => {
        const headers = new Headers({ origin });
        const cookies = [...jar].filter(([, cookie]) => sends(cookie, host));
        if (cookies.length > 0) {
          headers.set(
            "cookie",
            cookies.map(([key, cookie]) => `${key.split("@")[0]}=${cookie.value}`).join("; "),
          );
        }
        if (body !== undefined) headers.set("content-type", "application/json");
        const response = await auth.handler(
          new Request(`https://${host}/api/auth${path}`, {
            method: body === undefined ? "GET" : "POST",
            headers,
            body: body === undefined ? undefined : JSON.stringify(body),
          }),
        );
        for (const header of response.headers.getSetCookie()) {
          const [pair = "", ...attributes] = header.split(";").map((part) => part.trim());
          const index = pair.indexOf("=");
          const name = pair.slice(0, index);
          const value = pair.slice(index + 1);
          const domainAttribute = attributes.find((part) =>
            part.toLowerCase().startsWith("domain="),
          );
          const domain = domainAttribute
            ? domainAttribute.slice(7).replace(/^\./, "").toLowerCase()
            : host;
          const key = `${name}@${domain}`;
          if (value === "" || attributes.some((part) => part.toLowerCase() === "max-age=0"))
            jar.delete(key);
          else jar.set(key, { value, domain, hostOnly: domainAttribute === undefined });
        }
        const text = await response.text();
        return {
          status: response.status,
          json: text ? (JSON.parse(text) as Record<string, unknown>) : null,
        };
      };
    };

    return Object.assign(at(String(brand.rootDomain)), { at, cookies: () => jar });
  }

  /** Ask for a sign-in code and return the one the sender received. */
  async function requestCode(fetch: BrandFetch, email: string): Promise<string> {
    const before = sender.requests.length;
    const sent = await fetch("/email-otp/send-verification-otp", { email, type: "sign-in" });
    expect(sent.status).toBe(200);
    const request = sender.requests[before];
    expect(senderRequest.safeParse(request).success).toBe(true);
    expect(request?.message.kind).toBe("sign-in-code");
    return request?.message.kind === "sign-in-code" ? request.message.data.code : "";
  }

  /** Sign a new or existing user in with an email code through this browser. */
  async function signIn(fetch: BrandFetch, email: string): Promise<void> {
    const code = await requestCode(fetch, email);
    expect((await fetch("/sign-in/email-otp", { email, otp: code })).status).toBe(200);
  }

  return { sender, browser, requestCode, signIn };
}
