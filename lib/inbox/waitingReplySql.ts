import { AUTO_RESPONSE_SOURCE, PROMISED_WAITING_RECENCY_DAYS } from '@/lib/today/constants'
import { notHistorySql } from '@/lib/inbox/messageTimeline'

/**
 * Conversation-scoped last HUMAN outbound. IRE / auto_response is excluded
 * via the existing Today marker — never sentByUserId.
 *
 * Imported history is excluded too: this feeds `isWaitingForReply`, a statement
 * about the present. The INBOUND half of that rule reads `cv."lastInboundAt"`,
 * a conversation column the history importer is forbidden to touch, so it needs
 * no exclusion of its own.
 */
export function lastHumanOutboundSubquery(conversationIdRef = 'cv.id'): string {
  return `(
    SELECT MAX(COALESCE(m."channelTimestamp", m."createdAt"))
    FROM inbox_messages m
    WHERE m."conversationId" = ${conversationIdRef}
      AND m.direction = 'outbound'
      AND (m.metadata->>'source') IS DISTINCT FROM '${AUTO_RESPONSE_SOURCE}'
      AND ${notHistorySql('m')}
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
