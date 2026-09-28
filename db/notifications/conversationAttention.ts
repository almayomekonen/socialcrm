import type { Knex } from 'knex'
import { conversationHandoffKey, conversationUnansweredKey } from '@/lib/notifications/collapseKeys'
import type { EventContext } from '@/lib/notifications/types'

/**
 * A person answered the customer: the "waiting for a person" notifications about
 * this conversation are no longer true, so every recipient's unread copy is
 * marked read.
 *
 * Called inside the transaction that persists a HUMAN outbound — a SocialCRM
 * reply (persistOutboundWhatsapp) or a WhatsApp Business app reply
 * (ingestWhatsappEcho). Not called for AI, questionnaire or automation sends,
 * and never by reading a conversation.
 *
 * Future reminders need no cancelling: the tick only emits while no human reply
 * exists (db/notifications/unanswered.ts), so this only tidies what was already
 * delivered.
 */
export async function clearConversationAttention(
  conn: Knex | Knex.Transaction,
  args: { agencyId: number; conversationId: number },
): Promise<number> {
  // The key builders only read `entityId`; one source for the key format.
  const ctx = { entityId: args.conversationId } as EventContext
  return conn('notifications')
    .where({ agencyId: args.agencyId })
    .whereIn('collapseKey', [conversationUnansweredKey(ctx), conversationHandoffKey(ctx)])
    .whereNull('readAt')
    .update({ readAt: conn.fn.now(), updatedAt: conn.fn.now() })
}
