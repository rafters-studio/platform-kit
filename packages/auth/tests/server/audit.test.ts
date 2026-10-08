import { spawnSync } from "node:child_process";
import { AsyncLocalStorage } from "node:async_hooks";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runWithLedgerContext } from "@rafters/ledger";
import type { BrandConfigInput } from "@rafters/platform-contracts";
import { describe, expect, it } from "vite-plus/test";
import { auditedModels } from "../../src/server/audit.ts";
import { brandAuth } from "../helpers/brand-auth.ts";

const brand: BrandConfigInput = {
  id: "bandz",
  rootDomain: "bandz.app",
  sending: { from: "hello@bandz.app" },
  permissions: { budget: ["read"] },
  ledger: true,
};
// Workers has AsyncLocalStorage as a global (nodejs_compat); ledger reads the global, so the test runtime gets it too.
Object.assign(globalThis, { AsyncLocalStorage });

const now = new Date();
const later = new Date(now.getTime() + 3_600_000);

/** Rows for each audited model, keyed to a user and an organization already written. */
const rows = (userId: string, organizationId: string): Record<string, Record<string, unknown>> => ({
  account: {
    id: "account-1",
    accountId: "provider-1",
    providerId: "github",
    userId,
    createdAt: now,
    updatedAt: now,
  },
  passkey: {
    id: "passkey-1",
    publicKey: "public",
    userId,
    credentialID: "credential-1",
    counter: 0,
    deviceType: "singleDevice",
    backedUp: false,
    createdAt: now,
  },
  session: {
    id: "session-1",
    token: "token-1",
    userId,
    expiresAt: later,
    createdAt: now,
    updatedAt: now,
  },
  member: { id: "member-1", organizationId, userId, role: "member", createdAt: now },
  invitation: {
    id: "invitation-1",
    organizationId,
    email: "new@example.com",
    role: "member",
    status: "pending",
    expiresAt: later,
    createdAt: now,
    inviterId: userId,
  },
});

function setup() {
  const made = brandAuth(brand, {}, { ledger: true });
  const audit = () =>
    made.db
      .prepare(
        `select tableName, recordId, action, userId, oldData, newData from ledger_audit_log order by rowid`,
      )
      .all() as {
      tableName: string;
      recordId: string;
      action: string;
      userId: string | null;
      oldData: string | null;
      newData: string | null;
    }[];
  return { ...made, audit };
}

describe("auditing identity changes through ledger", () => {
  it("names the models the requirement lists", () => {
    expect([...auditedModels].sort()).toEqual(
      [
        "user",
        "account",
        "passkey",
        "apikey",
        "session",
        "organization",
        "member",
        "invitation",
      ].sort(),
    );
  });

  it("writes a ledger entry naming the actor for each create, update, and delete of each kind of identity data", async () => {
    const { auth, audit } = setup();
    const { adapter } = await auth.$context;
    const actor = "01980000-0000-7000-8000-000000000001";

    await runWithLedgerContext(
      { userId: actor, ip: null, userAgent: null, endpoint: null },
      async () => {
        const user = await adapter.create<Record<string, unknown>>({
          model: "user",
          data: { name: "Pat", email: "pat@example.com", emailVerified: true },
        });
        const organization = await adapter.create<Record<string, unknown>>({
          model: "organization",
          data: { name: "Band", slug: "band", createdAt: now },
        });
        const userId = String(user.id);
        const byModel = rows(userId, String(organization.id));
        const apikey = {
          id: "apikey-1",
          configId: "default",
          referenceId: userId,
          key: "secret-key-value",
          createdAt: now,
          updatedAt: now,
        };
        const all: Record<string, Record<string, unknown>> = {
          user: { id: userId },
          organization: { id: String(organization.id) },
          apikey,
          ...byModel,
        };
        for (const model of auditedModels) {
          const data = all[model];
          if (model !== "user" && model !== "organization") {
            await adapter.create({ model, data: data ?? {}, forceAllowId: true });
          }
        }
        const update: Record<string, Record<string, unknown>> = {
          user: { name: "Pat Two" },
          account: { scope: "read" },
          passkey: { name: "Phone" },
          apikey: { name: "Deploy" },
          session: { userAgent: "test" },
          organization: { name: "Band Two" },
          member: { role: "admin" },
          invitation: { status: "canceled" },
        };
        for (const model of auditedModels) {
          const id = String(all[model]?.id);
          await adapter.update({
            model,
            where: [{ field: "id", value: id }],
            update: update[model] ?? {},
          });
        }
        for (const model of [...auditedModels].reverse()) {
          const id = String(all[model]?.id);
          await adapter.delete({ model, where: [{ field: "id", value: id }] });
        }
      },
    );

    const entries = audit();
    for (const model of auditedModels) {
      const own = entries.filter((entry) => entry.tableName === model);
      expect(
        own.map((entry) => entry.action),
        model,
      ).toEqual(["INSERT", "UPDATE", "DELETE"]);
      expect(
        own.map((entry) => entry.userId),
        model,
      ).toEqual([actor, actor, actor]);
    }
  });

  it("does not store a secret in the entry", async () => {
    const { auth, audit } = setup();
    const { adapter } = await auth.$context;
    await runWithLedgerContext(
      { userId: "actor", ip: null, userAgent: null, endpoint: null },
      async () => {
        const user = await adapter.create<Record<string, unknown>>({
          model: "user",
          data: { name: "Pat", email: "pat@example.com", emailVerified: true },
        });
        await adapter.create({
          model: "apikey",
          forceAllowId: true,
          data: {
            id: "apikey-1",
            configId: "default",
            referenceId: String(user.id),
            key: "secret-key-value",
            createdAt: now,
            updatedAt: now,
          },
        });
      },
    );
    expect(JSON.stringify(audit())).not.toContain("secret-key-value");
  });

  it("writes a change and its entry together: when the entry cannot be written, the change does not happen", async () => {
    const { auth, db, audit } = setup();
    const { adapter } = await auth.$context;
    db.exec(`drop table ledger_audit_log`);
    await expect(
      adapter.create({
        model: "user",
        data: { name: "Pat", email: "pat@example.com", emailVerified: true },
      }),
    ).rejects.toThrow();
    expect((db.prepare(`select count(*) as n from "user"`).get() as { n: number }).n).toBe(0);
    expect(() => audit()).toThrow();
  });

  it("writes no entry for a failed sign-in", async () => {
    const { browser, requestCode, audit } = setup();
    const fetch = browser();
    await requestCode(fetch, "pat@example.com");
    const before = audit().length;
    const failed = await fetch("/sign-in/email-otp", { email: "pat@example.com", otp: "000000" });
    expect(failed.status).toBeGreaterThanOrEqual(400);
    expect(audit().length).toBe(before);
  });
});

describe("a brand with ledger off", () => {
  it("loads no @rafters/ledger module", () => {
    const dir = mkdtempSync(join(tmpdir(), "platform-auth-noledger-"));
    const hooks = join(dir, "hooks.mjs");
    writeFileSync(
      hooks,
      `export async function resolve(specifier, context, next) {
  if (specifier.includes("@rafters/ledger")) console.error("LOADED " + specifier);
  const result = await next(specifier, context);
  if (result.url.includes("@rafters+ledger") || result.url.includes("/@rafters/ledger/")) console.error("LOADED " + result.url);
  return result;
}`,
    );
    const register = join(dir, "register.mjs");
    writeFileSync(
      register,
      `import { register } from "node:module";\nregister(${JSON.stringify(`file://${hooks}`)});`,
    );
    const script = join(dir, "run.ts");
    const entry = join(import.meta.dirname, "../../src/server/index.ts");
    writeFileSync(
      script,
      `import { authOptions } from ${JSON.stringify(entry)};
const options = authOptions(
  { id: "bandz", rootDomain: "bandz.app", sending: { from: "hello@bandz.app" }, permissions: { budget: ["read"] } },
  { DB: {}, BETTER_AUTH_SECRET: "test-secret-0123456789abcdef0123456789", SENDER: { send: async () => {} } },
);
console.log((options.plugins ?? []).map((plugin) => plugin.id).join(","));`,
    );
    const result = spawnSync(process.execPath, ["--import", register, script], {
      encoding: "utf8",
      cwd: join(import.meta.dirname, "../.."),
    });
    expect(result.status, result.stderr).toBe(0);
    expect(result.stderr).not.toContain("LOADED");
    expect(result.stdout).not.toContain("ledger");
  });

  it("installs no audit table", () => {
    const { db } = brandAuth({ ...brand, ledger: false });
    const names = db
      .prepare(`select name from sqlite_master where type = 'table'`)
      .all()
      .map((row) => String(row.name));
    expect(names).not.toContain("ledger_audit_log");
  });
});
