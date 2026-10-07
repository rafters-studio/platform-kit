import type { SenderRequest } from "@rafters/platform-contracts";
import { describe, expect, it } from "vite-plus/test";
import { render } from "../src/messages.ts";

const base = {
  brand: { id: "bandz", from: "hello@bandz.app" },
  recipient: { channel: "email", to: "pat@example.com" },
} as const;
const code = { code: "481516", expiresAt: "2026-10-07T12:00:00.000Z" };

function req(message: SenderRequest["message"]): SenderRequest {
  return { ...base, message };
}

describe("render", () => {
  for (const kind of ["sign-in-code", "verification-code", "recovery-code"] as const) {
    it(`${kind} carries the code`, () => {
      const out = render(req({ kind, data: code }));
      expect(out.subject.length).toBeGreaterThan(0);
      expect(out.text).toContain("481516");
      expect(out.html).toContain("481516");
    });
  }

  it("invitation carries the url and organization name", () => {
    const out = render(
      req({
        kind: "invitation",
        data: {
          organizationName: "Pat and Sam",
          role: "member",
          url: "https://bandz.app/invite/abc",
        },
      }),
    );
    for (const body of [out.subject, out.text, out.html]) expect(body).toContain("Pat and Sam");
    expect(out.text).toContain("https://bandz.app/invite/abc");
    expect(out.html).toContain("https://bandz.app/invite/abc");
  });

  it("recovery-notice carries the method", () => {
    const out = render(
      req({
        kind: "recovery-notice",
        data: { method: "backup-email", at: "2026-10-07T12:00:00.000Z" },
      }),
    );
    expect(out.text).toContain("backup-email");
    expect(out.html).toContain("backup-email");
  });

  it("escapes values in the html body", () => {
    const out = render(
      req({
        kind: "invitation",
        data: {
          organizationName: "<script>alert(1)</script>",
          role: "a&b",
          url: 'https://x.test/?a=1&b="2"',
        },
      }),
    );
    expect(out.html).not.toContain("<script>");
    expect(out.html).toContain("&lt;script&gt;");
    expect(out.html).toContain("a&amp;b");
    expect(out.html).toContain("&quot;");
  });
});
