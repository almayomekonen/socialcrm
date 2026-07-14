import { db } from '@/config/db'
import { findOrCreateConversation } from '@/db/inboxConversations'
import { resolveWhatsappOutboundTarget } from '@/lib/inbox/whatsappOutboundTarget'

/**
 * Ensure a WhatsApp `inbox_conversations` row exists for a lead so Inbox can
 * open `/inbox?conversation=<id>` (including empty history + composer).
 *
 * Reuses `resolveWhatsappOutboundTarget` + `findOrCreateConversation` — the same
 * creation path outbound persist uses. Does not send messages.
 */
export type EnsureWhatsappConversationResult =
  | { ok: true; conversationId: number }
  | { ok: false; reason: 'lead-not-found' | 'no-connection' | 'no-recipient' }

export async function ensureWhatsappConversationForLead(
  agencyId: number,
  leadId: number,
): Promise<EnsureWhatsappConversationResult> {
  const resolved = await resolveWhatsappOutboundTarget(agencyId, leadId)
  if (resolved.ok === false) return { ok: false, reason: resolved.reason }

  const { target } = resolved
  const conversationId = await db.transaction((trx) =>
    findOrCreateConversation(trx, {
      agencyId,
      leadId: target.leadId,
      channel: 'whatsapp',
      businessPhoneNumberId: target.businessPhoneNumberId,
      customerWaId: target.customerWaId,
      customerName: target.customerName,
    }),
  )

  return { ok: true, conversationId }
}
