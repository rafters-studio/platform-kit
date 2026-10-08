import assert from "node:assert/strict";
import { Given, Then, When } from "@cucumber/cucumber";
import { cookieHeader, twoBrands } from "../isolation/harness.ts";

type Brands = ReturnType<typeof twoBrands>;

interface World {
  h: Brands;
  email: string;
  cookie: string;
  password: string;
  presented: unknown;
  userA: { id: string; email: string } | undefined;
  userB: { id: string; email: string } | undefined;
}

const EMAIL = "pat@example.com";

async function sessionUser(
  h: Brands,
  which: "a" | "b",
  jarOwner: ReturnType<Brands["a"]["browser"]>,
) {
  const brand = which === "a" ? h.brandA : h.brandB;
  const session = await h.sessionAt(h[which], brand, cookieHeader(jarOwner.cookies()));
  return session?.user;
}

Given("a user signed in at brand A with a valid session", async function (this: World) {
  this.h = twoBrands();
  const browser = this.h.a.browser();
  await this.h.a.signIn(browser, EMAIL);
  this.cookie = cookieHeader(browser.cookies());
  const own = await this.h.sessionAt(this.h.a, this.h.brandA, this.cookie);
  assert.equal(own?.user.email, EMAIL);
});

When("that session is presented to brand B", async function (this: World) {
  this.presented = await this.h.sessionAt(this.h.b, this.h.brandB, this.cookie);
});

Then("brand B does not accept the session", function (this: World) {
  assert.equal(this.presented, null);
});

Given(
  "a user at brand A with an app password that authenticates at brand A",
  async function (this: World) {
    this.h = twoBrands();
    const browser = this.h.a.browser();
    await this.h.a.signIn(browser, EMAIL);
    await this.h.b.signIn(this.h.b.browser(), EMAIL);
    const made = await browser("/api-key/create", { name: "mail" });
    this.password = (made.json as unknown as { key: string }).key;
    const own = await this.h.appPasswordAt(this.h.a, this.h.brandA, EMAIL, this.password);
    assert.equal(own?.email, EMAIL);
  },
);

When("that app password is presented to brand B", async function (this: World) {
  this.presented = await this.h.appPasswordAt(this.h.b, this.h.brandB, EMAIL, this.password);
});

Then("brand B does not authenticate it", function (this: World) {
  assert.equal(this.presented, null);
});

Given("a person registers at brand A with an email address", async function (this: World) {
  this.h = twoBrands();
  this.email = EMAIL;
  const browser = this.h.a.browser();
  await this.h.a.signIn(browser, this.email);
  this.userA = await sessionUser(this.h, "a", browser);
});

When(
  "the same person registers at brand B with the same email address",
  async function (this: World) {
    const browser = this.h.b.browser();
    await this.h.b.signIn(browser, this.email);
    this.userB = await sessionUser(this.h, "b", browser);
  },
);

Then("brand A and brand B each hold their own user for that email", function (this: World) {
  assert.equal(this.userA?.email, this.email);
  assert.equal(this.userB?.email, this.email);
  assert.equal(this.h.a.db.prepare(`select count(*) as n from "user"`).get()?.n, 1);
  assert.equal(this.h.b.db.prepare(`select count(*) as n from "user"`).get()?.n, 1);
});

Then("the two users have different identities", function (this: World) {
  assert.ok(this.userA?.id);
  assert.ok(this.userB?.id);
  assert.notEqual(this.userA.id, this.userB.id);
});
