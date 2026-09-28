import { db } from '@/config/db'
import { humanOutboundSql } from '@/lib/inbox/humanReply'
import { notHistorySql } from '@/lib/inbox/messageTimeline'

/**
 * "A customer is waiting for a person" — the two questions the notification
 * tick asks every minute. Writers never enqueue; `notifyEvent` absorbs repeats
 * through each type's eventKey.
 *
 * WHAT COUNTS AS AN ANSWER is `humanOutboundSql` (lib/inbox/humanReply.ts): a
 * reply from SocialCRM or from the WhatsApp Business app. An AI or questionnaire
 * message is not one. That is the change this module exists for: the AI's
 * "a representative will get back to you" used to silence the very reminder
 * that should follow it.
 *
 * Imported history never counts on either side, and nothing older than
 * UNANSWERED_RECENCY_MS is considered, so a deploy or a history import cannot
 * fire a burst of reminders about week-old chats.
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

export type HandoffCandidateRow = {
  conversationId: number
  agencyId: number
  leadId: number | null
  escalatedAt: Date
  firstName: string | null
  lastName: string | null
}

/** Bounds cost per cron tick; backlog drains across minutes. */
export const UNANSWERED_TICK_LIMIT = 200

/** Wall-clock threshold — locked product decision (Task 7). */
export const UNANSWERED_THRESHOLD_MS = 30 * 60 * 1000

/** Only the last day is live work; older waiting chats are Today's and the inbox's job. */
export const UNANSWERED_RECENCY_MS = 24 * 60 * 60 * 1000

/**
 * Reminder candidates: a ליד's open conversation whose latest customer message
 * is 30+ minutes old and has had no human answer, where either nothing at all
 * answered it, or it is explicitly waiting on a person (`escalated` — handed
 * off by the AI or the questionnaire — or `human_active`, taken over).
 *
 * A conversation the AI is still handling (`ai_qualifying` with its reply after
 * the message) stays silent: nobody promised the customer a person yet.
 */
export function findUnansweredConversationsQuery(thresholdCutoff: Date, limit: number, recencyFloor?: Date) {
  const floor = recencyFloor ?? new Date(thresholdCutoff.getTime() + UNANSWERED_THRESHOLD_MS - UNANSWERED_RECENCY_MS)
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
    INNER JOIN clients c ON c.id = cv."leadId" AND c."agencyId" = cv."agencyId"
    LEFT JOIN conversation_ai_state ai ON ai."conversationId" = cv.id
    INNER JOIN LATERAL (
      SELECT im.id, im.sequence
        FROM inbox_messages im
       WHERE im."conversationId" = cv.id
         AND im.direction = 'inbound'
         AND ${notHistorySql('im')}
       ORDER BY im.sequence DESC
       LIMIT 1
    ) m ON true
    WHERE cv.state = 'open'
      AND cv."isPersonal" IS NOT TRUE
      AND cv."lastInboundAt" IS NOT NULL
      AND cv."lastInboundAt" <= ?
      AND cv."lastInboundAt" >= ?
      AND c.status IS DISTINCT FROM 'closed'
      AND c.status IS DISTINCT FROM 'lost'
      AND COALESCE(ai."aiState", 'new') NOT IN ('opted_out', 'closed')
      AND NOT EXISTS (
        SELECT 1 FROM inbox_messages h
         WHERE h."conversationId" = cv.id
           AND h.sequence > m.sequence
           AND ${humanOutboundSql('h')}
      )
      AND (
        ai."aiState" IN ('escalated', 'human_active')
        OR NOT EXISTS (
          SELECT 1 FROM inbox_messages o
           WHERE o."conversationId" = cv.id
             AND o.direction = 'outbound'
             AND o.sequence > m.sequence
             AND ${notHistorySql('o')}
        )
      )
    ORDER BY cv."lastInboundAt" ASC, cv.id ASC
    LIMIT ?
  `,
    [thresholdCutoff, floor, limit],
  )
}

/**
 * Handoff candidates: the AI handed the conversation to a person (escalated in
 * the last day) and no person has answered since. Conversations without a ליד
 * are included — their notification goes to the admins, who own unowned work.
 *
 * A QUESTIONNAIRE handoff is excluded: it already notifies with
 * `lead.questionnaire_handoff`. It is recognised by its session ending in the
 * same transaction that escalated the conversation (identical `now()`).
 */
export function findPendingHandoffsQuery(now: Date, limit: number) {
  const floor = new Date(now.getTime() - UNANSWERED_RECENCY_MS)
  return db.raw(
    `
    SELECT
      cv.id AS "conversationId",
      cv."agencyId",
      cv."leadId",
      ai."escalatedAt",
      c."firstName",
      c."lastName"
    FROM conversation_ai_state ai
    INNER JOIN inbox_conversations cv ON cv.id = ai."conversationId" AND cv."agencyId" = ai."agencyId"
    LEFT JOIN clients c ON c.id = cv."leadId" AND c."agencyId" = cv."agencyId"
    WHERE ai."aiState" = 'escalated'
      AND ai."escalatedAt" IS NOT NULL
      AND ai."escalatedAt" >= ?
      AND ai."escalatedAt" <= ?
      AND cv.state = 'open'
      AND cv."isPersonal" IS NOT TRUE
      AND (c.id IS NULL OR (c.status IS DISTINCT FROM 'closed' AND c.status IS DISTINCT FROM 'lost'))
      AND NOT EXISTS (
        SELECT 1 FROM inbox_messages h
         WHERE h."conversationId" = cv.id
           AND COALESCE(h."channelTimestamp", h."createdAt") >= ai."escalatedAt"
           AND ${humanOutboundSql('h')}
      )
      AND NOT EXISTS (
        SELECT 1 FROM questionnaire_sessions qs
         WHERE qs."conversationId" = cv.id
           AND qs."endedAt" BETWEEN ai."escalatedAt" - INTERVAL '1 minute' AND ai."escalatedAt" + INTERVAL '1 minute'
      )
    ORDER BY ai."escalatedAt" ASC, cv.id ASC
    LIMIT ?
  `,
    [floor, now, limit],
  )
}

const toDate = (v: unknown): Date => (v instanceof Date ? v : new Date(String(v)))

export async function findUnansweredConversations(
  thresholdCutoff: Date,
  limit = UNANSWERED_TICK_LIMIT,
): Promise<UnansweredCandidateRow[]> {
  const res = (await findUnansweredConversationsQuery(thresholdCutoff, limit)) as { rows?: Record<string, unknown>[] }
  return (res.rows ?? []).map((r) => ({
    conversationId: Number(r.conversationId),
    agencyId: Number(r.agencyId),
    leadId: Number(r.leadId),
    messageId: Number(r.messageId),
    lastInboundAt: toDate(r.lastInboundAt),
    firstName: (r.firstName as string | null) ?? null,
    lastName: (r.lastName as string | null) ?? null,
  }))
}

export async function findPendingHandoffs(now: Date, limit = UNANSWERED_TICK_LIMIT): Promise<HandoffCandidateRow[]> {
  const res = (await findPendingHandoffsQuery(now, limit)) as { rows?: Record<string, unknown>[] }
  return (res.rows ?? []).map((r) => ({
    conversationId: Number(r.conversationId),
    agencyId: Number(r.agencyId),
    leadId: r.leadId == null ? null : Number(r.leadId),
    escalatedAt: toDate(r.escalatedAt),
    firstName: (r.firstName as string | null) ?? null,
    lastName: (r.lastName as string | null) ?? null,
  }))
}

type QuietHours = { tz?: string; startHour?: number; endHour?: number }

/** Quiet hours per agency (auto_response_settings, WhatsApp) — only agencies that set them. */
export async function quietHoursByAgency(agencyIds: number[]): Promise<Map<number, QuietHours>> {
  const out = new Map<number, QuietHours>()
  if (!agencyIds.length) return out
  const rows = (await db('auto_response_settings')
    .whereIn('agencyId', agencyIds)
    .where({ channel: 'whatsapp' })
    .select('agencyId', 'quietHours')) as { agencyId: number; quietHours: unknown }[]
  for (const r of rows) {
    const qh = (typeof r.quietHours === 'string' ? JSON.parse(r.quietHours) : r.quietHours) as QuietHours | null
    if (qh && qh.startHour != null && qh.endHour != null) out.set(Number(r.agencyId), qh)
  }
  return out
}
