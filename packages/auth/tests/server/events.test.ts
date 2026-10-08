import { AsyncLocalStorage } from "node:async_hooks";
import type { DatabaseSync } from "node:sqlite";
import { runWithLedgerContext } from "@rafters/ledger";
import * as ledger from "@rafters/ledger/better-auth";
import { eventEnvelope, type AuthEvent, type BrandConfigInput } from "@rafters/platform-contracts";
import { betterAuth } from "better-auth";
import { describe, expect, it } from "vite-plus/test";
import { addressHash } from "../../src/server/events.ts";
import { authOptions, relayAuditEvents, type AuthEnv } from "../../src/server/index.ts";
import { migratedDatabase } from "../helpers/database.ts";
import { recordingSender } from "../helpers/sender.ts";

Object.assign(globalThis, { AsyncLocalStorage });

const brand: BrandConfigInput = {
  id: "bandz",
  rootDomain: "bandz.app",
  sending: { from: "hello@bandz.app" },
  permissions: { budget: ["read"] },
  ledger: true,
};
const secret = "test-secret-0123456789abcdef0123456789";

/** A D1 look-alike over node:sqlite, enough for the relay's statements. */
function d1(db: DatabaseSync): D1Database {
  const statement = (sql: string, values: unknown[] = []) => ({
    bind: (...next: unknown[]) => statement(sql, next),
    first: async () => db.prepare(sql).get(...(values as never[])) ?? null,
    all: async () => ({ results: db.prepare(sql).all(...(values as never[])) }),
    run: async () => db.prepare(sql).run(...(values as never[])),
  });
  return { prepare: (sql: string) => statement(sql) } as unknown as D1Database;
}

/** A queue that can be made unavailable. */
function queue() {
  const sent: AuthEvent[] = [];
  const state = { down: false };
  const q = {
    send: async (body: AuthEvent) => {
      if (state.down) throw new Error("queue unavailable");
      sent.push(body);
    },
    sendBatch: async (messages: { body: AuthEvent }[]) => {
      if (state.down) throw new Error("queue unavailable");
      sent.push(...messages.map((m) => m.body));
    },
  } as unknown as Queue<AuthEvent>;
  return { q, sent, state };
}

function setup() {
  const db = migratedDatabase(brand);
  const events = queue();
  const sender = recordingSender();
  const background: Promise<unknown>[] = [];
  const env: AuthEnv = {
    DB: {} as AuthEnv["DB"],
    BETTER_AUTH_SECRET: secret,
    SENDER: sender,
    EVENTS: events.q,
  };
  const options = authOptions(brand, env, { ledger });
  const auth = betterAuth({
    ...options,
    database: db,
    advanced: {
      ...options.advanced,
      backgroundTasks: { handler: (p: Promise<unknown>) => void background.push(p) },
    },
  });
  const relayEnv = { DB: d1(db), EVENTS: events.q };
  const settle = async () => {
    await Promise.allSettled(background.splice(0));
  };
  return { db, auth, events, sender, relayEnv, settle };
}

const user = { name: "Pat", email: "pat@example.com", emailVerified: true };
const ctx = { userId: "actor", ip: null, userAgent: null, endpoint: null };

describe("change events from the audit outbox", () => {
  it("creating a user produces exactly one thin user-created event for that user and brand", async () => {
    const { auth, events, relayEnv } = setup();
    const { adapter } = await auth.$context;
    const created = await runWithLedgerContext(ctx, () =>
      adapter.create<Record<string, unknown>>({ model: "user", data: user }),
    );
    await relayAuditEvents("bandz", relayEnv);
    expect(events.sent).toHaveLength(1);
    const [event] = events.sent;
    expect(eventEnvelope.safeParse(event).success).toBe(true);
    expect(event?.type).toBe("auth.user.created");
    expect(event?.brand).toBe("bandz");
    expect(event?.subject).toBe(created.id);
    expect(event?.data).toMatchObject({ recordId: created.id });
    expect(JSON.stringify(event)).not.toContain("pat@example.com");
  });

  it("names the subject, not the actor, and lists only the fields that changed on an update", async () => {
    const { auth, events, relayEnv } = setup();
    const { adapter } = await auth.$context;
    const created = await runWithLedgerContext(ctx, () =>
      adapter.create<Record<string, unknown>>({ model: "user", data: user }),
    );
    await runWithLedgerContext(ctx, () =>
      adapter.update({
        model: "user",
        where: [{ field: "id", value: String(created.id) }],
        update: { name: "Pat Two" },
      }),
    );
    await relayAuditEvents("bandz", relayEnv);
    const updated = events.sent.find((e) => e.type === "auth.user.updated");
    expect(updated?.subject).toBe(created.id);
    expect(updated?.subject).not.toBe("actor");
    expect(updated?.type === "auth.user.updated" && updated.data.changedFields).toContain("name");
    expect(updated?.type === "auth.user.updated" && updated.data.changedFields).not.toContain(
      "email",
    );
  });

  it("announces an organization and its invitation under the organization", async () => {
    const { auth, events, relayEnv } = setup();
    const { adapter } = await auth.$context;
    const owner = await runWithLedgerContext(ctx, () =>
      adapter.create<Record<string, unknown>>({ model: "user", data: user }),
    );
    await runWithLedgerContext(ctx, async () => {
      const org = await adapter.create<Record<string, unknown>>({
        model: "organization",
        data: { name: "Band", slug: "band", createdAt: new Date() },
      });
      await adapter.create({
        model: "invitation",
        forceAllowId: true,
        data: {
          id: "invitation-1",
          organizationId: String(org.id),
          email: "new@example.com",
          role: "member",
          status: "pending",
          expiresAt: new Date(Date.now() + 3_600_000),
          createdAt: new Date(),
          inviterId: String(owner.id),
        },
      });
    });
    await relayAuditEvents("bandz", relayEnv);
    const org = events.sent.find((e) => e.type === "auth.organization.created");
    const invitation = events.sent.find((e) => e.type === "auth.invitation.created");
    expect(org?.subject).toBeDefined();
    expect(invitation?.subject).toBe(org?.subject);
  });

  it("sends each row once across runs and resends them when the queue was unavailable", async () => {
    const { auth, events, relayEnv } = setup();
    const { adapter } = await auth.$context;
    await runWithLedgerContext(ctx, () => adapter.create({ model: "user", data: user }));

    events.state.down = true;
    await expect(relayAuditEvents("bandz", relayEnv)).rejects.toThrow("queue unavailable");
    expect(events.sent).toHaveLength(0);

    events.state.down = false;
    await relayAuditEvents("bandz", relayEnv);
    expect(events.sent).toHaveLength(1);
    await relayAuditEvents("bandz", relayEnv);
    expect(events.sent).toHaveLength(1);
  });

  it("produces no event for a change that failed to record", async () => {
    const { auth, db, events, relayEnv } = setup();
    const { adapter } = await auth.$context;
    db.exec(
      `create trigger refuse before insert on ledger_audit_log begin select raise(abort, 'no'); end`,
    );
    await expect(adapter.create({ model: "user", data: user })).rejects.toThrow();
    await relayAuditEvents("bandz", relayEnv);
    expect(events.sent).toHaveLength(0);
  });

  it("leaves the audit table untouched", async () => {
    const { auth, db, relayEnv } = setup();
    const { adapter } = await auth.$context;
    await runWithLedgerContext(ctx, () => adapter.create({ model: "user", data: user }));
    const count = () =>
      (db.prepare(`select count(*) as n from ledger_audit_log`).get() as { n: number }).n;
    const before = count();
    await relayAuditEvents("bandz", relayEnv);
    expect(count()).toBe(before);
  });
});

async function failedSignIn(email: string, serverUp = true) {
  const made = setup();
  made.events.state.down = !serverUp;
  const { auth } = made;
  const send = (path: string, body: unknown) =>
    auth.handler(
      new Request(`https://bandz.app/api/auth${path}`, {
        method: "POST",
        headers: { origin: "https://bandz.app", "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
    );
  return { ...made, send, email };
}

describe("sign-in-failed events", () => {
  it("announces a failed sign-in for an existing user with the user as subject, and writes no ledger entry", async () => {
    const { auth, db, events, send, settle } = await failedSignIn("pat@example.com");
    const { adapter } = await auth.$context;
    const created = await runWithLedgerContext(ctx, () =>
      adapter.create<Record<string, unknown>>({ model: "user", data: user }),
    );
    const before = (db.prepare(`select count(*) as n from ledger_audit_log`).get() as { n: number })
      .n;
    const response = await send("/sign-in/email-otp", { email: "pat@example.com", otp: "000000" });
    expect(response.status).toBeGreaterThanOrEqual(400);
    await settle();
    expect(events.sent).toHaveLength(1);
    const [event] = events.sent;
    expect(eventEnvelope.safeParse(event).success).toBe(true);
    expect(event?.type).toBe("auth.sign-in.failed");
    expect(event?.subject).toBe(created.id);
    expect(
      (db.prepare(`select count(*) as n from ledger_audit_log`).get() as { n: number }).n,
    ).toBe(before);
  });

  it("carries only a keyed hash of an address that matches no user", async () => {
    const { events, send, settle } = await failedSignIn("nobody@example.com");
    await send("/sign-in/email-otp", { email: "Nobody@Example.com", otp: "000000" });
    await settle();
    const [event] = events.sent;
    expect(event?.subject).toBeUndefined();
    expect(event?.type === "auth.sign-in.failed" && event.data.addressHash).toBe(
      await addressHash(secret, "nobody@example.com"),
    );
    expect(JSON.stringify(event)).not.toContain("nobody@example.com");
    expect(await addressHash("another-secret", "nobody@example.com")).not.toBe(
      await addressHash(secret, "nobody@example.com"),
    );
  });

  it("announces nothing for a successful sign-in", async () => {
    const { events, send, settle, sender } = await failedSignIn("pat@example.com");
    await send("/email-otp/send-verification-otp", { email: "pat@example.com", type: "sign-in" });
    const request = sender.requests[0];
    const code = request?.message.kind === "sign-in-code" ? request.message.data.code : "";
    const ok = await send("/sign-in/email-otp", { email: "pat@example.com", otp: code });
    expect(ok.status).toBe(200);
    await settle();
    expect(events.sent).toHaveLength(0);
  });

  it("answers the sign-in while the queue is unavailable", async () => {
    const { events, send, settle } = await failedSignIn("pat@example.com", false);
    const response = await send("/sign-in/email-otp", { email: "pat@example.com", otp: "000000" });
    expect(response.status).toBeGreaterThanOrEqual(400);
    await settle();
    expect(events.sent).toHaveLength(0);
  });
});

describe("a brand with ledger off", () => {
  it("adds no event hooks", () => {
    const events = queue();
    const options = authOptions(
      { ...brand, ledger: false },
      {
        DB: {} as AuthEnv["DB"],
        BETTER_AUTH_SECRET: secret,
        SENDER: recordingSender(),
        EVENTS: events.q,
      },
    );
    expect((options.plugins ?? []).map((p) => p.id)).not.toContain("sign-in-failed-events");
  });

  it("installs no cursor table", () => {
    const db = migratedDatabase({ ...brand, ledger: false });
    const names = db
      .prepare(`select name from sqlite_master where type = 'table'`)
      .all()
      .map((row) => String(row.name));
    expect(names).not.toContain("auth_event_cursor");
  });
});
