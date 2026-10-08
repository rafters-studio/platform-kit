import { cpSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { BrandConfigInput } from "@rafters/platform-contracts";
import { betterAuth } from "better-auth";
import { brand as testBrand, createAuth } from "../../../../fixtures/test-brand/src/index.ts";
import { describe, expect, it } from "vite-plus/test";
import { authOptions, type AuthEnv } from "../../src/server/index.ts";
import { migratedDatabase } from "../helpers/database.ts";
import { recordingSender } from "../helpers/sender.ts";

const fixture = resolve(import.meta.dirname, "../../../../fixtures/test-brand");

/** Env for a brand: the sender recorded, the database built from the shipped migrations. */
function envFor(brand: BrandConfigInput) {
  const sender = recordingSender();
  const db = migratedDatabase(brand);
  const env: AuthEnv = {
    DB: db as unknown as AuthEnv["DB"],
    BETTER_AUTH_SECRET: "test-secret-0123456789abcdef0123456789",
    SENDER: sender,
  };
  return { env, sender, db };
}

/** Sign `email` in over HTTP with an email code and return the session's user. */
async function signIn(
  auth: ReturnType<typeof createAuth>,
  brand: BrandConfigInput,
  sender: ReturnType<typeof recordingSender>,
  email: string,
) {
  const origin = `https://${brand.rootDomain}`;
  const post = (path: string, body: unknown, cookie = "") =>
    auth.handler(
      new Request(`${origin}/api/auth${path}`, {
        method: "POST",
        headers: { origin, "content-type": "application/json", ...(cookie ? { cookie } : {}) },
        body: JSON.stringify(body),
      }),
    );
  expect((await post("/email-otp/send-verification-otp", { email, type: "sign-in" })).status).toBe(
    200,
  );
  const message = sender.requests[0]?.message;
  const otp = message?.kind === "sign-in-code" ? message.data.code : "";
  const signedIn = await post("/sign-in/email-otp", { email, otp });
  expect(signedIn.status).toBe(200);
  const cookie = signedIn.headers
    .getSetCookie()
    .map((header) => header.split(";")[0])
    .join("; ");
  const session = await auth.handler(
    new Request(`${origin}/api/auth/get-session`, { headers: { origin, cookie } }),
  );
  return ((await session.json()) as { user: { email: string } } | null)?.user;
}

describe("a brand runs auth from configuration alone", () => {
  it("signs a user in with the test brand's configuration and nothing else", async () => {
    const { env, sender } = envFor(testBrand);
    const user = await signIn(createAuth(env), testBrand, sender, "pat@example.com");
    expect(user?.email).toBe("pat@example.com");
    expect(sender.requests[0]).toMatchObject({ brand: { id: testBrand.id } });
  });

  it("runs identical auth code for two brands that differ only in configuration", async () => {
    const other: BrandConfigInput = {
      id: "otherbrand",
      rootDomain: "otherbrand.example",
      sending: { from: "hello@otherbrand.example" },
      permissions: { budget: ["read"] },
    };
    const first = envFor(testBrand);
    const second = envFor(other);
    // The same call the fixture makes, with only the configuration changed.
    const build = (brand: BrandConfigInput, env: AuthEnv) => betterAuth(authOptions(brand, env));

    const a = await signIn(build(testBrand, first.env), testBrand, first.sender, "pat@example.com");
    const b = await signIn(build(other, second.env), other, second.sender, "pat@example.com");
    expect(a?.email).toBe("pat@example.com");
    expect(b?.email).toBe("pat@example.com");
    expect(first.sender.requests[0]?.brand.id).toBe("testbrand");
    expect(second.sender.requests[0]?.brand.id).toBe("otherbrand");
  });
});

describe("a brand adopts a platform patch by changing only the version", () => {
  /** The fixture copied somewhere else, with the platform-auth requirement set to `range`. */
  function adopt(range: string): string {
    const dir = mkdtempSync(join(tmpdir(), "test-brand-"));
    cpSync(fixture, dir, { recursive: true, filter: (path) => !path.includes("node_modules") });
    const file = join(dir, "package.json");
    const manifest = JSON.parse(readFileSync(file, "utf8")) as {
      dependencies: Record<string, string>;
    };
    manifest.dependencies["@rafters/platform-auth"] = range;
    writeFileSync(file, `${JSON.stringify(manifest, null, 2)}\n`);
    return dir;
  }

  /** Every file under `dir`, relative, with its text. */
  function files(dir: string): Map<string, string> {
    const found = new Map<string, string>();
    for (const entry of readdirSync(dir, { recursive: true, withFileTypes: true })) {
      if (!entry.isFile()) continue;
      const path = join(entry.parentPath, entry.name);
      found.set(path.slice(dir.length), readFileSync(path, "utf8"));
    }
    return found;
  }

  it("changes one line of one file, the version, and no source", () => {
    const before = files(adopt("0.1.1"));
    const after = files(adopt("0.1.2"));

    expect([...after.keys()].toSorted()).toEqual([...before.keys()].toSorted());
    const changed = [...after].filter(([path, text]) => before.get(path) !== text);
    expect(changed.map(([path]) => path)).toEqual(["/package.json"]);
    const [, text] = changed[0] ?? ["", ""];
    const old = (before.get("/package.json") ?? "").split("\n");
    const lines = text.split("\n").filter((line, index) => line !== old[index]);
    expect(lines).toEqual([`    "@rafters/platform-auth": "0.1.2",`]);
  });

  it("holds no auth logic: its source imports only the package and better-auth and defines no hooks", () => {
    const source = files(join(fixture, "src"));
    expect([...source.keys()]).toEqual(["/index.ts"]);
    const text = source.get("/index.ts") ?? "";

    const imports = [...text.matchAll(/from "([^"]+)"/g)].map((match) => match[1]);
    expect(imports.toSorted()).toEqual(["@rafters/platform-auth/server", "better-auth"]);
    expect(text).not.toMatch(/\b(plugins|hooks|databaseHooks|advanced|trustedOrigins)\b/);
    expect(text.match(/\bfunction\b|=>/g)).toHaveLength(1);
    expect(text.match(/betterAuth\(authOptions\(brand, env\)\)/g)).toHaveLength(1);
  });
});
