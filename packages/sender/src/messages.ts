import type { SenderRequest } from "@rafters/platform-contracts";

const escapeMap: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

function esc(value: string): string {
  return value.replace(/[&<>"']/g, (c) => escapeMap[c] ?? c);
}

function html(paragraphs: string[]): string {
  return `<!doctype html><html><body>${paragraphs.map((p) => `<p>${p}</p>`).join("")}</body></html>`;
}

function codeMessage(
  subject: string,
  purpose: string,
  data: { code: string; expiresAt: string },
): { subject: string; text: string; html: string } {
  return {
    subject,
    text: `${purpose}\n\nYour code is ${data.code}\n\nIt expires at ${data.expiresAt}.`,
    html: html([
      esc(purpose),
      `Your code is <strong>${esc(data.code)}</strong>`,
      `It expires at ${esc(data.expiresAt)}.`,
    ]),
  };
}

/** Subject, plain text, and simple HTML for one request. Pure: no I/O. */
export function render(request: SenderRequest): { subject: string; text: string; html: string } {
  const { message } = request;
  switch (message.kind) {
    case "sign-in-code":
      return codeMessage("Your sign-in code", "Use this code to sign in.", message.data);
    case "verification-code":
      return codeMessage(
        "Your verification code",
        "Use this code to verify your address.",
        message.data,
      );
    case "recovery-code":
      return codeMessage(
        "Your recovery code",
        "Use this code to recover your account.",
        message.data,
      );
    case "invitation": {
      const { organizationName, role, url } = message.data;
      return {
        subject: `You are invited to ${organizationName}`,
        text: `You have been invited to join ${organizationName} as ${role}.\n\nAccept the invitation: ${url}`,
        html: html([
          `You have been invited to join ${esc(organizationName)} as ${esc(role)}.`,
          `<a href="${esc(url)}">Accept the invitation</a>`,
          esc(url),
        ]),
      };
    }
    case "recovery-notice": {
      const { method, at } = message.data;
      return {
        subject: "Your account was recovered",
        text: `Your account was recovered by ${method} at ${at}.\n\nIf this was not you, contact support now.`,
        html: html([
          `Your account was recovered by ${esc(method)} at ${esc(at)}.`,
          "If this was not you, contact support now.",
        ]),
      };
    }
  }
}
