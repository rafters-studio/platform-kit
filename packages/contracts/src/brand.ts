import { z } from "zod";

/** Everything a brand configures about auth. The one brand config schema; auth declares none of its own. */
export const brandConfig = z.object({
  /** Stable brand id, for example "bands". */
  id: z.string().regex(/^[a-z][a-z0-9-]*$/),
  /** The brand's root domain, for example "bands.app". */
  rootDomain: z.string().min(1),
  /** The address the brand's mail is sent from. */
  sending: z.object({ from: z.email() }),
  /** better-auth social provider ids the brand enables. */
  socialProviders: z.array(z.string().min(1)).default([]),
  /** Recovery channels beyond the primary email. */
  recovery: z
    .object({ backupEmail: z.boolean().default(false), phone: z.boolean().default(false) })
    .default({ backupEmail: false, phone: false }),
  /** Optional plugins, all off by default. */
  plugins: z
    .object({
      /** Vouching recovery: false, or its settings when on. */
      vouch: z
        .union([
          z.literal(false),
          z.object({ required: z.int().min(1), waitingPeriodSeconds: z.int().min(0) }),
        ])
        .default(false),
      /** Teams inside organizations. */
      teams: z.boolean().default(false),
    })
    .default({ vouch: false, teams: false }),
  /** Audit and events through @rafters/ledger. Off by default; every Rafters brand turns it on. */
  ledger: z.boolean().default(false),
  /** Permission vocabulary for roles: resource to actions, for example { mailbox: ["send"] }. */
  permissions: z.record(z.string().min(1), z.array(z.string().min(1)).min(1)),
  /** The brand's own native apps; a phone app names its URL scheme. */
  apps: z
    .array(z.object({ name: z.string().min(1), scheme: z.string().min(1).optional() }))
    .default([]),
  /** Regulations the brand follows, which account deletion must satisfy. */
  regulations: z.array(z.enum(["gdpr", "soc2", "hipaa"])).default([]),
});

export type BrandConfigInput = z.input<typeof brandConfig>;
export type BrandConfig = z.output<typeof brandConfig>;

/**
 * Parse a brand config, throwing one Error that names every failing path.
 * Call it at module scope so a bad config fails at deploy, not at a user's sign-in.
 */
export function parseBrandConfig(input: unknown): BrandConfig {
  const result = brandConfig.safeParse(input);
  if (result.success) return result.data;
  const lines = result.error.issues.map((issue) => {
    const path = issue.path.length > 0 ? issue.path.join(".") : "(root)";
    return `  ${path}: ${issue.message}`;
  });
  throw new Error(`invalid brand config:\n${lines.join("\n")}`);
}
