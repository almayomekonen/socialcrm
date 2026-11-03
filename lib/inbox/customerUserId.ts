import { db } from '@/config/db'

/**
 * WhatsApp business-scoped user ID (BSUID): RECORDED, NOT YET USED.
 *
 * Meta sends a BSUID for every WhatsApp user (`from_user_id` inbound,
 * `to_user_id` on Coexistence echoes) and may omit the phone number once a user
 * adopts a username. This module only writes the BSUID next to the phone-keyed
 * conversation it already belongs to. Conversation resolution, lead matching,
 * routing and sending are unchanged: nothing here decides anything.
 *
 * NEVER MERGES, NEVER OVERWRITES. The id is written only when the conversation
 * has none and no other conversation on the same business number holds it. A
 * different existing value is left alone and reported as a conflict (by
 * conversation id only), never resolved here.
 *
 * NEVER THROWS. It runs after a message is stored, inside a webhook that must
 * answer 200; a failure here must never cost the message.
 *
 * Format (Meta): ISO 3166 alpha-2 country code, a period, up to 128
 * alphanumerics, e.g. `US.13491208655302741918`. Matches the column's CHECK.
 */
export const CUSTOMER_USER_ID_PATTERN = /^[A-Z]{2}\.[A-Za-z0-9]{1,128}$/

/** A well-formed BSUID, or null. Never normalizes: the value is used exactly as Meta sent it. */
export function parseCustomerUserId(raw: unknown): string | null {
  return typeof raw === 'string' && CUSTOMER_USER_ID_PATTERN.test(raw) ? raw : null
}

export type RecordCustomerUserIdResult = 'recorded' | 'unchanged' | 'conflict' | 'no_conversation' | 'invalid' | 'failed'

/**
 * Record the BSUID on the conversation identified exactly as the phone-keyed
 * ingest identified it: agency + WhatsApp + business number + customer wa_id.
 */
export async function recordConversationCustomerUserId(input: {
  agencyId: number
  businessPhoneNumberId: string
  customerWaId: string
  customerUserId: unknown
}): Promise<RecordCustomerUserIdResult> {
  const userId = parseCustomerUserId(input.customerUserId)
  if (!userId) return 'invalid'
  const key = {
    agencyId: input.agencyId,
    channel: 'whatsapp',
    businessPhoneNumberId: input.businessPhoneNumberId,
    customerWaId: input.customerWaId,
  }
  try {
    const updated = await db('inbox_conversations')
      .where(key)
      .whereNull('customerUserId')
      .whereNotExists(function () {
        this.select(db.raw('1'))
          .from('inbox_conversations as other')
          .where('other.channel', 'whatsapp')
          .andWhere('other.businessPhoneNumberId', input.businessPhoneNumberId)
          .andWhere('other.customerUserId', userId)
      })
      .update({ customerUserId: userId })
      .returning('id')
    if (updated.length > 0) return 'recorded'

    const row = await db('inbox_conversations').where(key).first('id', 'customerUserId')
    if (!row) return 'no_conversation'
    if (row.customerUserId === userId) return 'unchanged'
    console.warn('[WhatsappCustomerUserId] not recorded: conflicting id', { conversationId: Number(row.id) })
    return 'conflict'
  } catch (err) {
    // A concurrent writer can win the partial unique index between the check and the update.
    if ((err as { code?: string })?.code === '23505') {
      console.warn('[WhatsappCustomerUserId] not recorded: id already held on this business number')
      return 'conflict'
    }
    console.error('[WhatsappCustomerUserId] record failed', { code: (err as { code?: string })?.code ?? null })
    return 'failed'
  }
}
