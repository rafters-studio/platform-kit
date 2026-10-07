import type { Sender, SenderRequest } from "@rafters/platform-contracts";

/** A Sender that keeps every request it is handed, so tests can read what auth sent. */
export function recordingSender(): Sender & { requests: SenderRequest[] } {
  const requests: SenderRequest[] = [];
  return {
    requests,
    async send(request) {
      requests.push(request);
    },
  };
}
