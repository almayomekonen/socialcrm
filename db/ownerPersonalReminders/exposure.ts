import { db } from '@/config/db'

/**
 * Measured platform exposure for one Meta billing month (architecture v1.3 §1.3,
 * v1.4 §1.3). BEST EFFORT, never a guarantee: other senders on the shared number
 * take no lock here, and a lost status webhook is not counted. Conservative where
 * it can be: every category is counted, and sends in flight or of unknown
 * outcome are counted even though they may never be billed.
 *
 *   delivered or read in the month          (owner_whatsapp_message_status)
 * + sent in the month, no later status yet
 * + in flight / unknown with no status row: personal reminders, assistant
 *   replies, lead_followup_alert deliveries
 *
 * Sender guidance replies leave no row before Meta's webhook, so they are counted
 * only once Meta reports them (a documented gap).
 */
export async function platformExposure(startMs: number, endMs: number): Promise<number> {
  const start = new Date(startMs)
  const end = new Date(endMs)
  const { rows } = await db.raw(
    `SELECT
       (SELECT count(*) FROM owner_whatsapp_message_status
         WHERE COALESCE("deliveredAt", "readAt") >= :start AND COALESCE("deliveredAt", "readAt") < :end)
     + (SELECT count(*) FROM owner_whatsapp_message_status
         WHERE "sentAt" >= :start AND "sentAt" < :end AND "deliveredAt" IS NULL AND "readAt" IS NULL AND "failedAt" IS NULL)
     + (SELECT count(*) FROM owner_personal_reminders r
         WHERE r.status IN ('dispatching', 'unknown') AND r."dispatchedAt" >= :start AND r."dispatchedAt" < :end
           AND (r.wamid IS NULL OR NOT EXISTS (SELECT 1 FROM owner_whatsapp_message_status s WHERE s.wamid = r.wamid)))
     + (SELECT count(*) FROM wa_assistant_jobs j
         WHERE j."replyState" IN ('sending', 'unknown') AND j."updatedAt" >= :start AND j."updatedAt" < :end
           AND (j."replyWamid" IS NULL OR NOT EXISTS (SELECT 1 FROM owner_whatsapp_message_status s WHERE s.wamid = j."replyWamid")))
     + (SELECT count(*) FROM owner_whatsapp_reminder_deliveries d
         WHERE d.status IN ('sending', 'unknown') AND d."updatedAt" >= :start AND d."updatedAt" < :end
           AND (d.wamid IS NULL OR NOT EXISTS (SELECT 1 FROM owner_whatsapp_message_status s WHERE s.wamid = d.wamid)))
     AS n`,
    { start, end },
  )
  return Number(rows[0].n)
}
