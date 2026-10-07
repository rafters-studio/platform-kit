import type { BrandConfigInput } from "@rafters/platform-contracts";
import { describe, expect, it } from "vite-plus/test";
import { brandAuth } from "../helpers/brand-auth.ts";
import { SoftwarePasskey } from "../helpers/webauthn.ts";

const brand: BrandConfigInput = {
  id: "bandz",
  rootDomain: "bandz.app",
  sending: { from: "hello@bandz.app" },
  permissions: { budget: ["read"] },
};

const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/** The id a signed-in request reads, the way a service reads it: through better-auth's getSession. */
async function idFor(auth: ReturnType<typeof brandAuth>["auth"], cookie: string) {
  const session = await auth.api.getSession({
    headers: new Headers({ cookie, host: "bandz.app", "x-forwarded-proto": "https" }),
  });
  return session?.user.id;
}

const cookieOf = (jar: Map<string, { value: string }>) =>
  [...jar].map(([key, cookie]) => `${key.split("@")[0]}=${cookie.value}`).join("; ");

describe("the user id", () => {
  it("is readable from a signed-in request as a UUIDv7", async () => {
    const { auth, browser, signIn } = brandAuth(brand);
    const fetch = browser();
    await signIn(fetch, "pat@example.com");

    const id = await idFor(auth, cookieOf(fetch.cookies()));
    expect(id).toMatch(UUID_V7);
  });

  it("is absent for a request with no session", async () => {
    const { auth } = brandAuth(brand);
    expect(await idFor(auth, "")).toBeUndefined();
  });

  it("does not change across sign-ins, devices, or sign-in methods", async () => {
    const { auth, browser, signIn, requestCode } = brandAuth(brand);
    const origin = `https://${brand.rootDomain}`;
    const passkey = new SoftwarePasskey(brand.rootDomain);

    const phone = browser();
    await signIn(phone, "pat@example.com");
    const id = await idFor(auth, cookieOf(phone.cookies()));
    expect(id).toMatch(UUID_V7);

    const registration = await phone("/passkey/generate-register-options");
    const registered = await phone("/passkey/verify-registration", {
      response: passkey.register(String(registration.json?.challenge), origin),
    });
    expect(registered.status).toBe(200);

    // Another device, same method: a new sign-in.
    const laptop = browser();
    await signIn(laptop, "pat@example.com");
    expect(await idFor(auth, cookieOf(laptop.cookies()))).toBe(id);

    // Another sign-in on the same device after signing out.
    await phone("/sign-out", {});
    const code = await requestCode(phone, "pat@example.com");
    expect(
      (await phone("/sign-in/email-otp", { email: "pat@example.com", otp: code })).status,
    ).toBe(200);
    expect(await idFor(auth, cookieOf(phone.cookies()))).toBe(id);

    // Another method: the passkey.
    const tablet = browser();
    const challenge = await tablet("/passkey/generate-authenticate-options");
    const signedIn = await tablet("/passkey/verify-authentication", {
      response: passkey.authenticate(String(challenge.json?.challenge), origin),
    });
    expect(signedIn.status).toBe(200);
    expect(await idFor(auth, cookieOf(tablet.cookies()))).toBe(id);
  });

  describe.each([{ ledger: false }, { ledger: true }])(
    "a deleted user with ledger $ledger",
    (options) => {
      it("keeps its id from being given to another user", async () => {
        const { auth, db, browser, signIn } = brandAuth(
          { ...brand, ledger: options.ledger },
          {},
          options,
        );
        const first = browser();
        await signIn(first, "pat@example.com");
        const deletedId = await idFor(auth, cookieOf(first.cookies()));
        expect(deletedId).toMatch(UUID_V7);

        // Ledger on soft-deletes: the row stays and keeps its id. Ledger off removes the row.
        if (options.ledger) {
          db.prepare(`update "user" set "deletedAt" = ? where "id" = ?`).run(
            new Date().toISOString(),
            String(deletedId),
          );
        } else {
          db.prepare(`delete from "user" where "id" = ?`).run(String(deletedId));
        }
        const row = db.prepare(`select "id" from "user" where "id" = ?`).get(String(deletedId));
        expect(row !== undefined).toBe(options.ledger);

        // Every user who joins afterwards gets an id of their own.
        const ids = new Set<string | undefined>();
        for (const email of ["a@example.com", "b@example.com", "c@example.com"]) {
          const fetch = browser();
          await signIn(fetch, email);
          ids.add(await idFor(auth, cookieOf(fetch.cookies())));
        }
        expect(ids.size).toBe(3);
        expect(ids.has(deletedId)).toBe(false);
      });
    },
  );
});
