import { db } from '@/config/db'

export type IreSendGate =
  | { ok: true }
  | { ok: false; reason: 'conversation_gone' | 'personal' }

/**
 * Re-read immediately before Graph send. Personal always wins.
 * Agency-scoped so a job cannot send on another tenant's conversation.
 */
export async function assertIreSendAllowed(agencyId: number, conversationId: number): Promise<IreSendGate> {
  const conv = await db('inbox_conversations')
    .where({ id: conversationId, agencyId })
    .first('id', 'isPersonal')
  if (!conv) return { ok: false, reason: 'conversation_gone' }
  if (conv.isPersonal === true) return { ok: false, reason: 'personal' }
  return { ok: true }
}
