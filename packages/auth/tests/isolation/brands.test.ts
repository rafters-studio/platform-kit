import { describe, expect, it } from "vite-plus/test";
import { cookieHeader, twoBrands } from "./harness.ts";

describe("identities never cross brands", () => {
  it("rejects a session from brand A at brand B", async () => {
    const h = twoBrands();
    const browser = h.a.browser();
    await h.a.signIn(browser, "pat@example.com");
    const cookie = cookieHeader(browser.cookies());

    expect((await h.sessionAt(h.a, h.brandA, cookie))?.user.email).toBe("pat@example.com");
    expect(await h.sessionAt(h.b, h.brandB, cookie)).toBeNull();
  });

  it("rejects an app password from brand A at brand B", async () => {
    const h = twoBrands();
    const browser = h.a.browser();
    await h.a.signIn(browser, "pat@example.com");
    // The same person is a user at brand B too, so only the brand tells the two apart.
    await h.b.signIn(h.b.browser(), "pat@example.com");
    const made = await browser("/api-key/create", { name: "mail" });
    const key = (made.json as unknown as { key: string }).key;

    expect(await h.appPasswordAt(h.a, h.brandA, "pat@example.com", key)).toMatchObject({
      email: "pat@example.com",
    });
    expect(await h.appPasswordAt(h.b, h.brandB, "pat@example.com", key)).toBeNull();
  });

  it("makes the same email two different users at two brands", async () => {
    const h = twoBrands();
    const email = "pat@example.com";
    const inA = h.a.browser();
    const inB = h.b.browser();
    await h.a.signIn(inA, email);
    await h.b.signIn(inB, email);

    const userA = (await h.sessionAt(h.a, h.brandA, cookieHeader(inA.cookies())))?.user;
    const userB = (await h.sessionAt(h.b, h.brandB, cookieHeader(inB.cookies())))?.user;
    expect(userA?.email).toBe(email);
    expect(userB?.email).toBe(email);
    expect(userA?.id).not.toBe(userB?.id);
    expect(h.a.db.prepare(`select count(*) as n from "user"`).get()).toEqual({ n: 1 });
    expect(h.b.db.prepare(`select count(*) as n from "user"`).get()).toEqual({ n: 1 });
  });
});
