import { db } from '@/config/db'

/**
 * Unanswered-conversation notification candidates — Task 7.
 *
 * An open conversation is unanswered when the denormalized last turn is inbound
 * (`lastDirection = 'inbound'`) and that inbound is at least THRESHOLD old, with
 * no outbound message after the current inbound head. Closed/archived threads
 * and closed/lost leads are excluded.
 *
 * Writers never enqueue; the cron tick asks "what is unanswered right now?" and
 * `notifyEvent` absorbs duplicates via eventKey
 * `message.unanswered:{agency}:conversation:{id}:msg:{lastInboundMessageId}`.
 */

export type UnansweredCandidateRow = {
  conversationId: number
  agencyId: number
  leadId: number
  messageId: number
  lastInboundAt: Date
  firstName: string | null
  lastName: string | null
}

/** Bounds cost per cron tick; backlog drains across minutes. */
export const UNANSWERED_TICK_LIMIT = 200

/** Wall-clock threshold — locked product decision (Task 7). */
export const UNANSWERED_THRESHOLD_MS = 30 * 60 * 1000

/**
 * Candidates: open + non-terminal lead + lastDirection inbound + lastInboundAt
 * old enough + durable inbound head id + no outbound after that head.
 *
 * `thresholdCutoff` is `now - UNANSWERED_THRESHOLD_MS` (caller supplies it so
 * tests can pin the clock without patching Date.now).
 */
export function findUnansweredConversationsQuery(thresholdCutoff: Date, limit: number) {
  return db.raw(
    `
    SELECT
      cv.id AS "conversationId",
      cv."agencyId",
      cv."leadId",
      cv."lastInboundAt",
      c."firstName",
      c."lastName",
      m.id AS "messageId"
    FROM inbox_conversations cv
    INNER JOIN clients c ON c.id = cv."leadId"
    INNER JOIN LATERAL (
      SELECT im.id, im.sequence
        FROM inbox_messages im
       WHERE im."conversationId" = cv.id
         AND im.direction = 'inbound'
       ORDER BY im.sequence DESC
       LIMIT 1
    ) m ON true
    WHERE cv.state = 'open'
      AND cv."lastDirection" = 'inbound'
      AND cv."lastInboundAt" IS NOT NULL
      AND cv."lastInboundAt" <= ?
      AND c.status IS DISTINCT FROM 'closed'
      AND c.status IS DISTINCT FROM 'lost'
      AND NOT EXISTS (
        SELECT 1
          FROM inbox_messages o
         WHERE o."conversationId" = cv.id
           AND o.direction = 'outbound'
           AND o.sequence > m.sequence
      )
    ORDER BY cv."lastInboundAt" ASC, cv.id ASC
    LIMIT ?
  `,
    [thresholdCutoff, limit],
  )
}

function mapRows(res: { rows?: Record<string, unknown>[] }): UnansweredCandidateRow[] {
  return (res.rows ?? []).map((r) => ({
    conversationId: Number(r.conversationId),
    agencyId: Number(r.agencyId),
    leadId: Number(r.leadId),
    messageId: Number(r.messageId),
    lastInboundAt:
      r.lastInboundAt instanceof Date ? r.lastInboundAt : new Date(String(r.lastInboundAt)),
    firstName: (r.firstName as string | null) ?? null,
    lastName: (r.lastName as string | null) ?? null,
  }))
}

export async function findUnansweredConversations(
  thresholdCutoff: Date,
  limit = UNANSWERED_TICK_LIMIT,
): Promise<UnansweredCandidateRow[]> {
  const res = await findUnansweredConversationsQuery(thresholdCutoff, limit)
  return mapRows(res)
}
