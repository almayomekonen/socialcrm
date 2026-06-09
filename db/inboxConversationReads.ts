import { db } from '@/config/db'

export type MarkConversationReadInput = {
  conversationId: number
  userId: number
  agencyId: number
}

export async function markConversationRead(input: MarkConversationReadInput): Promise<boolean> {
  const conv = await db('inbox_conversations').where({ id: input.conversationId, agencyId: input.agencyId }).first('id')
  if (!conv) return false

  const maxRow = await db('inbox_messages')
    .where({ conversationId: input.conversationId })
    .max<{ max: string | number | null }>('id as max')
    .first()
  const lastReadMessageId = maxRow?.max != null ? Number(maxRow.max) : null

  await db('inbox_conversation_reads')
    .insert({
      conversationId: input.conversationId,
      userId: input.userId,
      agencyId: input.agencyId,
      lastReadAt: db.fn.now(),
      lastReadMessageId,
    })
    .onConflict(['conversationId', 'userId'])
    .merge({
      lastReadAt: db.fn.now(),
      lastReadMessageId,
      updatedAt: db.fn.now(),
    })

  return true
}

export async function countUnreadConversationsForUser(agencyId: number, userId: number): Promise<number> {
  const row = await db('inbox_conversations as cv')
    .leftJoin('inbox_conversation_reads as r', function () {
      this.on('r.conversationId', 'cv.id').andOnVal('r.userId', userId)
    })
    .where('cv.agencyId', agencyId)
    .whereNotNull('cv.lastInboundAt')
    .andWhere(function () {
      this.whereNull('r.lastReadAt').orWhereRaw('cv."lastInboundAt" > r."lastReadAt"')
    })
    .count<{ count: string | number }>('cv.id as count')
    .first()

  return Number(row?.count) || 0
}
