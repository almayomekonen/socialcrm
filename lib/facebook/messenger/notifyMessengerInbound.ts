import { db } from '@/config/db'
import { notifyEvent } from '@/lib/notifications/emit'
import { leadDisplayName } from '@/lib/notifications/leadName'

/**
 * Tell the agency a customer wrote on Messenger — through the notification
 * engine, exactly as a WhatsApp arrival does (bell, toast, push when away).
 *
 * Called by the Messenger event worker for a NEWLY stored inbound message, after
 * the first-message name lookup, so the notification names the sender the way
 * the Messenger tab does: the linked ליד's name, else the Messenger profile name,
 * else no name at all (never an invented one).
 *
 * IDEMPOTENT. The event key is the `messenger_messages.id`, so a worker retry
 * that reaches this again enqueues nothing new. Never throws. Returns false only
 * when the enqueue itself failed, so the worker can retry the receipt; every
 * deliberate "no" (notifications off, not allowlisted, no plan) is true.
 *
 * TENANCY. Every read is scoped to the agency the message was stored under, and
 * recipients resolve inside that agency (`lead_handler_or_admins`).
 */
export async function notifyMessengerInbound(input: {
  agencyId: number
  conversationId: number
  messageId: number
  occurredAt: Date
}): Promise<boolean> {
  let leadId: number | null = null
  let name: string | null = null
  try {
    const row = (await db('messenger_conversations as mc')
      .leftJoin('clients as c', function () {
        this.on('c.id', '=', 'mc.leadId').andOn('c.agencyId', '=', 'mc.agencyId')
      })
      .where({ 'mc.id': input.conversationId, 'mc.agencyId': input.agencyId })
      .first('mc.leadId', 'mc.customerName', 'c.firstName', 'c.lastName')) as
      | { leadId: number | null; customerName: string | null; firstName: string | null; lastName: string | null }
      | undefined
    if (row) {
      leadId = row.leadId == null ? null : Number(row.leadId)
      name = leadDisplayName(row) ?? (row.customerName?.trim() || null)
    }
  } catch {
    // Name and routing facts are best-effort; the notification still goes to the admins.
  }

  const result = await notifyEvent({
    type: 'message.messenger_inbound',
    agencyId: input.agencyId,
    entityType: 'messenger_conversation',
    entityId: input.conversationId,
    actorUserId: null,
    occurredAt: input.occurredAt,
    payload: { leadId, leadName: name, messageId: input.messageId, provider: 'messenger' },
  })
  return result.enqueued === true || result.reason !== 'error'
}
