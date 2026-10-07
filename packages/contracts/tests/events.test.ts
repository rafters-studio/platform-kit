import { describe, expect, it } from "vite-plus/test";
import { eventEnvelope } from "../src/events.ts";

const v7 = "01a113d1-ccfd-74d3-b35e-8f2f88ac4b2f";
const base = { id: v7, brand: "bands", time: "2026-10-07T12:00:00.000Z" };
const created = {
  ...base,
  type: "auth.user.created",
  subject: "01a113d1-0000-7000-8000-000000000001",
  data: { recordId: "01a113d1-0000-7000-8000-000000000001", changedFields: ["email"] },
};
const hash = "a".repeat(64);

describe("eventEnvelope accepts", () => {
  it("a valid auth.user.created event", () => {
    expect(eventEnvelope.safeParse(created).success).toBe(true);
  });

  it("an organization-level event whose subject is the organization", () => {
    const event = {
      ...created,
      type: "auth.organization.created",
      subject: "01a113d1-0000-7000-8000-0000000000aa",
      data: { recordId: "01a113d1-0000-7000-8000-0000000000aa", changedFields: ["name"] },
    };
    expect(eventEnvelope.safeParse(event).success).toBe(true);
  });

  it("a sign-in-failed event with a subject", () => {
    const event = {
      ...base,
      type: "auth.sign-in.failed",
      subject: "01a113d1-0000-7000-8000-000000000001",
      data: { method: "email-otp" },
    };
    expect(eventEnvelope.safeParse(event).success).toBe(true);
  });

  it("a sign-in-failed event with only an addressHash", () => {
    const event = {
      ...base,
      type: "auth.sign-in.failed",
      data: { method: "email-otp", addressHash: hash },
    };
    expect(eventEnvelope.safeParse(event).success).toBe(true);
  });
});

describe("eventEnvelope rejects", () => {
  it("a version-4 UUID id", () => {
    expect(
      eventEnvelope.safeParse({ ...created, id: "1b4e28ba-2fa1-41d2-883f-0016d3cca427" }).success,
    ).toBe(false);
  });

  it("an unknown type", () => {
    expect(eventEnvelope.safeParse({ ...created, type: "auth.user.renamed" }).success).toBe(false);
  });

  it("a change event with no subject", () => {
    const { subject: _subject, ...noSubject } = created;
    expect(eventEnvelope.safeParse(noSubject).success).toBe(false);
  });

  it("a sign-in-failed event with neither a subject nor an addressHash", () => {
    const event = { ...base, type: "auth.sign-in.failed", data: { method: "passkey" } };
    expect(eventEnvelope.safeParse(event).success).toBe(false);
  });

  it("a change event whose data carries a field value", () => {
    const event = { ...created, data: { ...created.data, email: "pat@example.com" } };
    expect(eventEnvelope.safeParse(event).success).toBe(false);
  });

  it("a time that is not ISO 8601", () => {
    expect(eventEnvelope.safeParse({ ...created, time: "yesterday at noon" }).success).toBe(false);
  });
});
