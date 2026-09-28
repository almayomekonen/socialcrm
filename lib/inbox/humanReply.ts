import { notHistorySql } from '@/lib/inbox/messageTimeline'

/**
 * Did a PERSON answer the customer? One definition, in TypeScript and in SQL.
 *
 * Two kinds of outbound are human:
 *
 *   1. A reply from inside SocialCRM (composer, template send, mobile). These are
 *      persisted with the sending user and NO `metadata.source`.
 *   2. A reply from the WhatsApp Business app on a Coexistence number. Meta
 *      delivers those as `smb_message_echoes`, stored with
 *      `metadata.source = 'smb_message_echo'` and no user. Meta sends echoes only
 *      for messages sent from the app, and they share no wamid with API sends
 *      (production, 2026-09-28: 3,323 echo rows across 4 agencies, 0 wamid
 *      collisions with any other outbound row).
 *
 * Everything else is not a person: `auto_response` (AI agent, questionnaire,
 * no-response, handoff texts — note these DO carry a `sentByUserId`, the lead
 * owner's, so a user id alone proves nothing), automation template sends (no
 * source, no user), imported history, and failed sends.
 *
 * Reading or opening a conversation writes no outbound row, so it can never
 * count as a reply.
 *
 * PURE ON PURPOSE (no imports but messageTimeline, which has none): the inbox
 * header imports this in the browser, and db/inboxMessages imports it too.
 */

/**
 * The Coexistence echo marker. Same literal as `ECHO_SOURCE` in
 * lib/inbox/ingestWhatsappEcho.ts, which writes it; importing it from there
 * would cycle through db/inboxMessages. A unit test pins the two equal.
 */
export const ECHO_SOURCE = 'smb_message_echo'

export function isHumanOutbound(row: {
  source: string | null | undefined
  sentByUserId: number | null | undefined
  status?: string | null
}): boolean {
  if (row.status === 'failed') return false
  if (row.source === ECHO_SOURCE) return true
  return row.source == null && row.sentByUserId != null
}

/** SQL twin of `isHumanOutbound` for an `inbox_messages` alias. */
export function humanOutboundSql(alias: string): string {
  return `(
    ${alias}.direction = 'outbound'
    AND ${notHistorySql(alias)}
    AND ${alias}.status IS DISTINCT FROM 'failed'
    AND (
      (${alias}.metadata->>'source') = '${ECHO_SOURCE}'
      OR ((${alias}.metadata->>'source') IS NULL AND ${alias}."sentByUserId" IS NOT NULL)
    )
  )`
}

/**
 * The direction that decides the conversation header's chip: the latest message
 * that is either the customer's or a PERSON's reply. An AI or automation reply
 * (`byPerson === false`) is skipped, so "the rep replied last" is never shown
 * because the AI did. Rows that do not say (`byPerson` undefined) count as before.
 */
export function lastCountedDirection(
  messages: readonly { direction: 'inbound' | 'outbound'; byPerson?: boolean }[],
): 'inbound' | 'outbound' | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]
    if (m.direction === 'inbound') return 'inbound'
    if (m.byPerson !== false) return 'outbound'
  }
  return null
}
