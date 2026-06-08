import type { Knex } from 'knex'

/**
 * Inbox participant access. For WhatsApp 1:1 a thread has exactly two endpoints:
 * the customer and the business number. Idempotent on (conversationId, role) so
 * webhook retries don't create duplicates.
 */

export type InboxParticipantRole = 'customer' | 'business'

export type EnsureParticipantInput = {
  conversationId: number
  agencyId: number
  role: InboxParticipantRole
  waId: string
  displayName: string | null
  leadId: number | null
}

/** Insert the participant if absent; refresh its display name when provided. */
export async function ensureParticipant(
  trx: Knex.Transaction,
  input: EnsureParticipantInput,
): Promise<void> {
  await trx('inbox_participants')
    .insert({
      conversationId: input.conversationId,
      agencyId: input.agencyId,
      role: input.role,
      waId: input.waId,
      displayName: input.displayName,
      leadId: input.leadId,
    })
    .onConflict(['conversationId', 'role'])
    .merge({
      displayName: trx.raw(
        'COALESCE(EXCLUDED."displayName", inbox_participants."displayName")',
      ),
    })
}
