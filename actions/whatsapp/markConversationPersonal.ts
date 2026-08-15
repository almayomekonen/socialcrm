'use server'

import { revalidatePath } from 'next/cache'
import { db } from '@/config/db'
import { requireProductAccess } from '@/lib/requireUser'
import { loadOwnedConversation } from '@/lib/whatsapp/ownedConversation'

export type MarkConversationPersonalResult =
  | { ok: true }
  | { ok: false; reason: 'not-found' | 'already-linked' | 'invalid-input' }

/**
 * "סמן כאישי" — remember that this phone must never be auto-promoted to a Lead.
 * "+ צור ליד" later clears this (attachConversationToLead resets isPersonal).
 */
export async function markConversationPersonal(
  conversationIdRaw: number | string,
): Promise<MarkConversationPersonalResult> {
  const conversationId = Number(conversationIdRaw)
  if (!Number.isFinite(conversationId) || conversationId <= 0) return { ok: false, reason: 'invalid-input' }

  const user = await requireProductAccess()
  const conv = await loadOwnedConversation(user.agencyId, conversationId)
  if (!conv) return { ok: false, reason: 'not-found' }
  if (conv.leadId != null && conv.leadId > 0) return { ok: false, reason: 'already-linked' }

  if (conv.isPersonal) {
    revalidatePath('/inbox')
    return { ok: true }
  }

  const updated = await db('inbox_conversations')
    .where({ id: conv.id, agencyId: user.agencyId })
    .whereNull('leadId')
    .update({
      isPersonal: true,
      personalMarkedByUserId: user.id,
      personalMarkedAt: new Date(),
      updatedAt: new Date(),
    })

  if (!updated) return { ok: false, reason: 'already-linked' }

  revalidatePath('/inbox')
  return { ok: true }
}
