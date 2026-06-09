'use server'

import { requireAgencyUser } from '@/lib/requireUser'
import { markConversationRead as markConversationReadDb } from '@/db/inboxConversationReads'
import { listInboxConversations } from './queries'
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
