import { senderRequest, type Sender } from "@rafters/platform-contracts";
import { render } from "../messages.ts";

/** Receives one rendered message, as a single string, per send. */
export type StdoutWrite = (line: string) => void;

/** A Sender that writes each rendered message to stdout. Defaults to console.log. */
export function stdoutSender(write: StdoutWrite = (line) => console.log(line)): Sender {
  return {
    async send(input) {
      const request = senderRequest.parse(input);
      const { subject, text } = render(request);
      write(
        `To: ${request.recipient.to} (${request.recipient.channel})\nSubject: ${subject}\n\n${text}`,
      );
    },
  };
}
