import { db } from '@/config/db'

/**
 * MESSAGING FACTS — the two reads that make the automation engine and the
 * instant-response engine behave as one system toward a lead.
 *
 * Both exist because SocialCRM has TWO independent automated senders. The
 * automation engine (lib/automations/*) and the instant-response / qualifier
 * subsystem (lib/inbox/autoresponse/*) each gather their own facts and apply
 * their own rules, and neither knows the other exists. From the engine's side
 * that is invisible; from the LEAD's side it is one business that messaged them
 * twice in ten seconds.
 *
 * These readers are the smallest correct intervention: the automation engine's
 * existing laws keep deciding, they just stop being blind to the other sender.
 * Nothing here changes the autoresponse, which continues to own its own gate.
 */

/**
 * Has this lead asked this business to stop messaging them?
 *
 * The signal already exists and is already maintained: the qualifier's state
 * machine writes `conversation_ai_state.aiState = 'opted_out'` when an inbound
 * message is detected as an opt-out request (`detectOptOut` →
 * `markStopped(conv.id, 'opted_out', …)`). Reading it rather than inventing a
 * second consent store is deliberate — two stores for one question is how a
 * lead who said "עצור" keeps receiving messages from the half that never heard.
 *
 * SCOPE DECISION, stated rather than implied: the flag is stored per
 * CONVERSATION and its name speaks about the AI. It is read here as
 * "this lead does not want automated messages from this business" — a broader
 * meaning than the column name suggests, and the correct one: a person who asked
 * a business to stop did not mean "stop only from the robot that asked."
 *
 * It bounds the ENGINE only. A rep's manual reply is unaffected — laws never run
 * on a human's own action — which is right: a human choosing to answer a
 * customer is not automated outreach.
 *
 * Any opted-out conversation for the lead counts. A business with two WhatsApp
 * numbers is one business to the person receiving the messages.
 */
export function isLeadOptedOutOfMessagingQuery(agencyId: number, leadId: number) {
  return db('conversation_ai_state as s')
    .join('inbox_conversations as c', 'c.id', 's.conversationId')
    .where('c.agencyId', agencyId)
    .where('c.leadId', leadId)
    .where('s.aiState', 'opted_out')
    .first<{ conversationId: number } | undefined>('s.conversationId')
}

export async function isLeadOptedOutOfMessaging(agencyId: number, leadId: number): Promise<boolean> {
  return Boolean(await isLeadOptedOutOfMessagingQuery(agencyId, leadId))
}

/**
 * Automated messages the INSTANT-RESPONSE engine sent this lead since `since`.
 *
 * Counted from `auto_response_jobs` rather than from `inbox_messages`, because
 * the autoresponse attributes its sends to a real user id
 * (`lead.userId ?? handlerId ?? connection.user_id`) — so an outbound row is
 * indistinguishable from a rep's own message by attribution alone. The job
 * ledger is the only place that records "a machine sent this."
 *
 * `status = 'sent'` only: pending, skipped and failed jobs did not reach the
 * lead, and a cap must count what arrived, never what was attempted.
 */
export function countAutoResponsesForLeadQuery(agencyId: number, leadId: number, since: Date) {
  return db('auto_response_jobs')
    .count<{ c: string }[]>({ c: '*' })
    .where({ agencyId, leadId, status: 'sent' })
    .where('updatedAt', '>=', since)
}

export async function countAutoResponsesForLead(agencyId: number, leadId: number, since: Date): Promise<number> {
  const rows = await countAutoResponsesForLeadQuery(agencyId, leadId, since)
  return Number(rows[0]?.c ?? 0)
}
