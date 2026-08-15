import { db } from '@/config/db'

export type OwnedConversation = {
  id: number
  agencyId: number
  leadId: number | null
  isPersonal: boolean
  customerWaId: string
  customerName: string | null
  channel: string
}

export async function loadOwnedConversation(
  agencyId: number,
  conversationId: number,
): Promise<OwnedConversation | null> {
  if (!Number.isFinite(agencyId) || agencyId <= 0) return null
  if (!Number.isFinite(conversationId) || conversationId <= 0) return null

  const row = await db('inbox_conversations')
    .where({ id: conversationId, agencyId })
    .first('id', 'agencyId', 'leadId', 'isPersonal', 'customerWaId', 'customerName', 'channel')
  if (!row) return null

  return {
    id: Number(row.id),
    agencyId: Number(row.agencyId),
    leadId: row.leadId != null ? Number(row.leadId) : null,
    isPersonal: row.isPersonal === true,
    customerWaId: String(row.customerWaId ?? ''),
    customerName: row.customerName ?? null,
    channel: String(row.channel),
  }
}
