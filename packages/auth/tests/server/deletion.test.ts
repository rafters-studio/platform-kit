import type { BrandConfigInput } from "@rafters/platform-contracts";
import { describe, expect, it } from "vite-plus/test";
import * as gdpr from "@rafters/ledger";
import * as ledger from "@rafters/ledger/better-auth";
import { changeEvent, type AuditRow } from "../../src/server/events.ts";
import { authOptions, type AuthEnv } from "../../src/server/index.ts";
import { brandAuth } from "../helpers/brand-auth.ts";

const brand: BrandConfigInput = {
  id: "bandz",
  rootDomain: "bandz.app",
  sending: { from: "hello@bandz.app" },
  permissions: { budget: ["read"] },
};

async function setup(input: BrandConfigInput = brand, ledgerOn = false) {
  const harness = brandAuth(input, {}, { ledger: ledgerOn });
  const pat = harness.browser();
  await harness.signIn(pat, "pat@example.com");
  const count = (sql: string) => (harness.db.prepare(sql).get() as { n: number }).n;
  return { ...harness, pat, count };
}

describe("account deletion", () => {
  it("lets a user delete the account, and the user can no longer sign in", async () => {
    const { pat, db, requestCode, browser } = await setup();
    expect((await pat("/delete-user", {})).status).toBe(200);
    expect(db.prepare(`select count(*) as n from user`).get()).toEqual({ n: 0 });
    expect((await pat("/get-session")).json).toBeNull();
    // A fresh browser asking for a code gets a brand-new account, not the deleted one.
    await requestCode(browser(), "pat@example.com");
    expect(db.prepare(`select count(*) as n from user`).get()).toEqual({ n: 0 });
  });

  it("revokes the user's app passwords and leaves other users' alone", async () => {
    const { pat, signIn, browser, count } = await setup();
    const sam = browser();
    await signIn(sam, "sam@example.com");
    await pat("/api-key/create", { name: "mail" });
    await sam("/api-key/create", { name: "mail" });
    expect(count(`select count(*) as n from apikey`)).toBe(2);
    expect((await pat("/delete-user", {})).status).toBe(200);
    expect(count(`select count(*) as n from apikey`)).toBe(1);
  });

  it("refuses the last owner of an organization until it has another owner or is deleted", async () => {
    const { pat, signIn, browser, db, count } = await setup();
    const sam = browser();
    await signIn(sam, "sam@example.com");
    const org = await pat("/organization/create", { name: "Duo", slug: "duo" });
    const orgId = String(org.json?.id);

    const refused = await pat("/delete-user", {});
    expect(refused.status).toBe(400);
    expect(refused.json?.code).toBe("LAST_OWNER");
    expect(count(`select count(*) as n from user where email = 'pat@example.com'`)).toBe(1);

    // A second owner frees the first.
    const samId = (
      db.prepare(`select id from user where email = 'sam@example.com'`).get() as {
        id: string;
      }
    ).id;
    db.prepare(
      `insert into member (id, organizationId, userId, role, createdAt) values (?, ?, ?, 'owner', ?)`,
    ).run("m-sam", orgId, samId, Date.now());
    expect((await pat("/delete-user", {})).status).toBe(200);
    expect(count(`select count(*) as n from user where email = 'pat@example.com'`)).toBe(0);
  });

  it("lets a last owner delete once the organization is deleted", async () => {
    const { pat } = await setup();
    const org = await pat("/organization/create", { name: "Solo", slug: "solo" });
    expect((await pat("/delete-user", {})).status).toBe(400);
    expect((await pat("/organization/delete", { organizationId: org.json?.id })).status).toBe(200);
    expect((await pat("/delete-user", {})).status).toBe(200);
  });
});

describe("account deletion with ledger on", () => {
  const audited: BrandConfigInput = { ...brand, ledger: true };

  it("keeps the row but refuses every later sign-in, and revokes app passwords", async () => {
    const { pat, db, sender, browser, count } = await setup(audited, true);
    await pat("/api-key/create", { name: "mail" });
    expect((await pat("/delete-user", {})).status).toBe(200);
    expect(count(`select count(*) as n from user where deletedAt is not null`)).toBe(1);
    expect(count(`select count(*) as n from apikey`)).toBe(0);

    const again = browser();
    const before = sender.requests.length;
    await again("/email-otp/send-verification-otp", { email: "pat@example.com", type: "sign-in" });
    const request = sender.requests[before];
    const code = request?.message.kind === "sign-in-code" ? request.message.data.code : "";
    const attempt = await again("/sign-in/email-otp", { email: "pat@example.com", otp: code });
    expect(attempt.status).toBe(403);
    expect(attempt.json?.code).toBe("ACCOUNT_DELETED");
    expect(count(`select count(*) as n from session`)).toBe(0);
    expect(db.prepare(`select count(*) as n from user`).get()).toEqual({ n: 1 });
  });

  it("writes a deletion the outbox relay announces as a user-deleted event for that user", async () => {
    const { pat, db } = await setup(audited, true);
    await pat("/delete-user", {});
    const rows = db
      .prepare(
        `select id, tableName, recordId, action, oldData, newData, subjectUserId, createdAt
           from ledger_audit_log where tableName = 'user' and action = 'SOFT_DELETE'`,
      )
      .all() as unknown as AuditRow[];
    expect(rows).toHaveLength(1);
    const event = changeEvent("bandz", rows[0] as AuditRow);
    expect(event?.type).toBe("auth.user.deleted");
    expect(event?.subject).toBe(rows[0]?.recordId);
  });

  it("without gdpr keeps the user row and the audit trail as they were", async () => {
    const { pat, db } = await setup(audited, true);
    await pat("/delete-user", {});
    expect(db.prepare(`select name, email from user`).get()).toEqual({
      name: "",
      email: "pat@example.com",
    });
    const trail = db.prepare(`select oldData, newData from ledger_audit_log`).all();
    expect(JSON.stringify(trail)).toContain("pat@example.com");
  });

  it("with gdpr erases the person from the user row and the audit trail, and the event still names the subject", async () => {
    const { pat, db } = await setup({ ...audited, regulations: ["gdpr"] }, true);
    await pat("/delete-user", {});
    const user = db.prepare(`select id, name, email, deletedAt from user`).get() as {
      id: string;
      name: string;
      email: string;
      deletedAt: unknown;
    };
    expect(user.name).toBe("Deleted user");
    expect(user.email).not.toContain("pat@example.com");
    expect(user.deletedAt).not.toBeNull();
    const trail = JSON.stringify(
      db.prepare(`select userId, oldData, newData from ledger_audit_log`).all(),
    );
    expect(trail).not.toContain("pat@example.com");
    const row = db
      .prepare(
        `select id, tableName, recordId, action, oldData, newData, subjectUserId, createdAt
           from ledger_audit_log where tableName = 'user' and action = 'SOFT_DELETE'`,
      )
      .get() as unknown as AuditRow;
    expect(changeEvent("bandz", row)?.subject).toBe(user.id);
  });
});

describe("regulations at deploy time", () => {
  const env: AuthEnv = {
    DB: {} as AuthEnv["DB"],
    BETTER_AUTH_SECRET: "test-secret-0123456789abcdef0123456789",
    SENDER: { send: async () => ({}) } as unknown as AuthEnv["SENDER"],
  };

  it("refuses regulations that need the audit trail while ledger is off", () => {
    for (const regulations of [["gdpr"], ["soc2"], ["hipaa"]] as const) {
      expect(() => authOptions({ ...brand, regulations: [...regulations] }, env)).toThrow(/ledger/);
    }
  });

  it("refuses gdpr without ledger's core module", () => {
    expect(() =>
      authOptions({ ...brand, ledger: true, regulations: ["gdpr"] }, env, { ledger }),
    ).toThrow(/gdpr/);
    expect(() =>
      authOptions({ ...brand, ledger: true, regulations: ["gdpr"] }, env, { ledger, gdpr }),
    ).not.toThrow();
  });
});
