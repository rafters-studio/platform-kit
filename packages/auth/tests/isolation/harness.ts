import type { BrandConfigInput } from "@rafters/platform-contracts";
import { brandAuth } from "../helpers/brand-auth.ts";

export const brandA: BrandConfigInput = {
  id: "bandz",
  rootDomain: "bandz.app",
  sending: { from: "hello@bandz.app" },
  permissions: { budget: ["read"] },
};

export const brandB: BrandConfigInput = {
  id: "smugglr",
  rootDomain: "smugglr.app",
  sending: { from: "hello@smugglr.app" },
  permissions: { budget: ["read"] },
};

type Brand = ReturnType<typeof brandAuth>;

/** What a brand's server sees for a request to its own root domain. */
function headersFor(brand: BrandConfigInput, extra: Record<string, string>): Headers {
  return new Headers({ host: String(brand.rootDomain), "x-forwarded-proto": "https", ...extra });
}

/**
 * Two brands built from the same package: separate databases and separate secrets, nothing shared.
 * The NFR-PLATFORM-AUTH-101 suite reuses it.
 */
export function twoBrands() {
  const a = brandAuth(
    brandA,
    {},
    { ledger: false, secret: "secret-of-brand-a-0123456789abcdef0123" },
  );
  const b = brandAuth(
    brandB,
    {},
    { ledger: false, secret: "secret-of-brand-b-0123456789abcdef0123" },
  );

  /** The session `cookie` resolves to at `brand`, as a service behind that brand reads it. */
  async function sessionAt(which: Brand, brand: BrandConfigInput, cookie: string) {
    return which.auth.api.getSession({ headers: headersFor(brand, { cookie }) });
  }

  /** The user an app password authenticates at `which`, or null when it is refused. */
  async function appPasswordAt(
    which: Brand,
    brand: BrandConfigInput,
    email: string,
    password: string,
  ) {
    const api = which.auth.api as unknown as {
      verifyAppPassword(input: {
        body: { email: string; password: string };
        headers: Headers;
      }): Promise<{ user: { id: string; email: string } }>;
    };
    return api
      .verifyAppPassword({ body: { email, password }, headers: headersFor(brand, {}) })
      .then(
        (result) => result.user,
        () => null,
      );
  }

  return { a, b, brandA, brandB, sessionAt, appPasswordAt };
}

/** The Cookie header a browser would send for the cookies in its jar. */
export function cookieHeader(jar: Map<string, { value: string }>): string {
  return [...jar].map(([key, cookie]) => `${key.split("@")[0]}=${cookie.value}`).join("; ");
}
