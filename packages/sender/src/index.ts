import { senderRequest, type Sender } from "@rafters/platform-contracts";
import { render } from "./messages.ts";

/** The part of Cloudflare's send_email binding this sender calls (env.EMAIL.send). */
export interface SendEmailBinding {
  send(message: {
    to: string;
    from: string;
    subject: string;
    text: string;
    html: string;
  }): Promise<unknown>;
}

/** A Sender that delivers email through the binding. */
export function emailSender(binding: SendEmailBinding): Sender {
  return {
    async send(input) {
      const request = senderRequest.parse(input);
      if (request.recipient.channel !== "email") {
        throw new Error(
          `emailSender delivers email only; got channel "${request.recipient.channel}". Use an sms-capable sender.`,
        );
      }
      const { subject, text, html } = render(request);
      await binding.send({
        to: request.recipient.to,
        from: request.brand.from,
        subject,
        text,
        html,
      });
    },
  };
}
