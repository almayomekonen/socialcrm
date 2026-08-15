'use server'

import { revalidatePath } from 'next/cache'
import { requireAgencyUser } from '@/lib/requireUser'
import { markConversationRead as markConversationReadDb } from '@/db/inboxConversationReads'
import { deleteConversation as deleteConversationDb } from '@/db/inboxConversations'
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
 * Delete a WhatsApp conversation (and its messages) from SocialCRM — local only.
 * Never touches the Lead, the WABA, the phone number, Meta, or WhatsApp config;
 * it removes only the SocialCRM copy of the thread (see `deleteConversationDb`).
 *
 * Security: the `agencyId` passed to the delete is the SESSION's, derived
 * server-side from the authenticated user — never a value from the browser. A
 * caller can therefore only delete a conversation their own agency owns; a
 * conversationId belonging to another agency simply matches 0 rows (IDOR-safe).
 * Idempotent: a repeated/stale/never-existed delete returns
 * `{ ok: true, deleted: false }` rather than erroring, so double-clicks and
 * concurrent requests are safe.
 */
export async function deleteConversation(
  conversationIdRaw: number | string,
): Promise<{ ok: boolean; deleted: boolean }> {
  const conversationId = Number(conversationIdRaw)
  if (!Number.isFinite(conversationId) || conversationId <= 0) return { ok: false, deleted: false }

  const user = await requireAgencyUser()
  const { deleted } = await deleteConversationDb({ conversationId, agencyId: user.agencyId })
  // Debuggable without leaking message contents: ids + outcome only.
  console.log('[inbox] deleteConversation', { conversationId, agencyId: user.agencyId, deleted })
  revalidatePath('/inbox')
  return { ok: true, deleted }
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
