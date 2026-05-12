import { db } from '@/config/db'

export type ConversationState = 'active' | 'archived'

export type AiConversationRow = {
  id: number
  agencyId: number
  leadId: number
  createdByUserId: number
  title: string | null
  state: ConversationState
  lastMessageAt: string | null
  messageCount: number
  summaryText: string | null
  summaryUpdatedAt: string | null
  metadata: Record<string, unknown>
  createdAt: string
  updatedAt: string
}

export async function getOrCreateLeadConversation(agencyId: number, leadId: number, userId: number): Promise<number> {
  const inserted = await db.raw(
    `INSERT INTO ai_conversations ("agencyId", "leadId", "createdByUserId")
     VALUES (?, ?, ?)
     ON CONFLICT ("agencyId", "leadId") WHERE state = 'active' DO NOTHING
     RETURNING id`,
    [agencyId, leadId, userId],
  )
  if (inserted.rows?.length) return Number(inserted.rows[0].id)

  const existing = await db('ai_conversations').where({ agencyId, leadId, state: 'active' }).first('id')
  if (!existing) throw new Error('ai_conversations.resolve_failed')
  return Number(existing.id)
}

export async function getConversationById(id: number, agencyId: number): Promise<AiConversationRow | null> {
  const row = await db('ai_conversations').where({ id, agencyId }).first()
  return row ? (row as AiConversationRow) : null
}
