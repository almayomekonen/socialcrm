import { AUTO_RESPONSE_SOURCE, PROMISED_WAITING_RECENCY_DAYS } from '@/lib/today/constants'

/**
 * Conversation-scoped last HUMAN outbound. IRE / auto_response is excluded
 * via the existing Today marker — never sentByUserId.
 */
export function lastHumanOutboundSubquery(conversationIdRef = 'cv.id'): string {
  return `(
    SELECT MAX(COALESCE(m."channelTimestamp", m."createdAt"))
    FROM inbox_messages m
    WHERE m."conversationId" = ${conversationIdRef}
      AND m.direction = 'outbound'
      AND (m.metadata->>'source') IS DISTINCT FROM '${AUTO_RESPONSE_SOURCE}'
  )`
}

/** Same waiting rule as lib/today/waitingReply.ts, evaluated in SQL at query time. */
export function waitingReplySql(conversationAlias = 'cv'): string {
  const human = lastHumanOutboundSubquery(`${conversationAlias}.id`)
  return `(
    ${conversationAlias}."lastInboundAt" IS NOT NULL
    AND ${conversationAlias}."lastInboundAt" > COALESCE(${human}, '-infinity'::timestamptz)
    AND ${conversationAlias}."lastInboundAt" >= NOW() - INTERVAL '${PROMISED_WAITING_RECENCY_DAYS} days'
  )`
}
