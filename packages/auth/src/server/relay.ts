import type { AuthEvent } from "@rafters/platform-contracts";
import { changeEvent, type AuditRow } from "./events.ts";

const CURSOR = "audit";
const BATCH = 100;

/** What the relay needs: the brand's database (with ledger's audit table) and its event queue. */
export interface RelayEnv {
  DB: D1Database;
  EVENTS: Queue<AuthEvent>;
}

/**
 * Publish the audit rows written since the last run to the brand's queue as thin change events, oldest
 * first, and move the cursor past each batch only after the queue took it. A failed publish throws with
 * the cursor where it was, so the next run sends those rows again; subscribers are idempotent and the
 * event id is the audit row's id. Call it from the brand's scheduled handler. Rows that name no subject
 * are skipped and counted. `ledger_audit_log` itself is only read.
 */
export async function relayAuditEvents(
  brandId: string,
  env: RelayEnv,
): Promise<{ sent: number; skipped: number }> {
  let sent = 0;
  let skipped = 0;
  for (;;) {
    const cursor = await env.DB.prepare(`select lastAuditId from auth_event_cursor where id = ?`)
      .bind(CURSOR)
      .first<{ lastAuditId: string }>();
    const { results } = await env.DB.prepare(
      `select id, tableName, recordId, action, oldData, newData, subjectUserId, createdAt
         from ledger_audit_log where id > ? order by id limit ?`,
    )
      .bind(cursor?.lastAuditId ?? "", BATCH)
      .all<AuditRow>();
    const last = results.at(-1);
    if (last === undefined) return { sent, skipped };

    const events = results.flatMap((row) => changeEvent(brandId, row) ?? []);
    if (events.length > 0) {
      await env.EVENTS.sendBatch(events.map((body) => ({ body, contentType: "json" as const })));
    }
    await env.DB.prepare(
      `insert into auth_event_cursor (id, lastAuditId) values (?, ?)
         on conflict(id) do update set lastAuditId = excluded.lastAuditId`,
    )
      .bind(CURSOR, last.id)
      .run();
    sent += events.length;
    skipped += results.length - events.length;
    if (results.length < BATCH) return { sent, skipped };
  }
}
