'use server'

import { requireAgencyUser } from '@/lib/requireUser'
import { markConversationRead as markConversationReadDb } from '@/db/inboxConversationReads'
import { ensureWhatsappConversationForLead } from '@/lib/inbox/ensureWhatsappConversation'
import { getInboxConversationByLeadId, listInboxConversations } from './queries'
import type { InboxConversationsPage, InboxCursor, InboxListFilters } from './types'

export async function loadMoreInboxConversations(args: {
  cursor: InboxCursor
  filters: Partial<InboxListFilters>
}): Promise<InboxConversationsPage> {
  const user = await requireAgencyUser()
  return listInboxConversations(user.agencyId, user.id, { cursor: args.cursor, filters: args.filters })
}

export async function markConversationRead(conversationIdRaw: number | string): Promise<{ ok: boolean }> {
  const conversationId = Number(conversationIdRaw)
  if (!Number.isFinite(conversationId) || conversationId <= 0) return { ok: false }

  const user = await requireAgencyUser()
  const ok = await markConversationReadDb({ conversationId, userId: user.id, agencyId: user.agencyId })
  return { ok }
}

/**
 * Canonical Lead → Inbox WhatsApp conversation id for navigation.
 *
 * 1. Prefer an existing conversation (`getInboxConversationByLeadId`).
 * 2. Otherwise ensure a conversation row via `findOrCreateConversation`
 *    (same targeting as send) so Inbox can open the existing workspace
 *    with empty history + composer.
 *
 * Does not send messages. Callers navigate with `/inbox?conversation=<id>`.
 */
export async function resolveLeadWhatsappConversation(
  leadIdRaw: number | string,
): Promise<{ conversationId: number | null; reason?: string }> {
  const leadId = Number(leadIdRaw)
  if (!Number.isFinite(leadId) || leadId <= 0) return { conversationId: null, reason: 'invalid-input' }

  const user = await requireAgencyUser()

  const existing = await getInboxConversationByLeadId(user.agencyId, leadId)
  if (existing) return { conversationId: existing.conversationId }

  const ensured = await ensureWhatsappConversationForLead(user.agencyId, leadId)
  if (ensured.ok === false) return { conversationId: null, reason: ensured.reason }

  return { conversationId: ensured.conversationId }
}
