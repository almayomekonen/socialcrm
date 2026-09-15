'use server'

import { revalidatePath } from 'next/cache'
import { db } from '@/config/db'
import { requireAgencyUser } from '@/lib/requireUser'
import { getLeadById, upsertLead } from '@/actions/clients'
import { isFacebookMessengerEnabledForAgency } from '@/lib/facebook/permissions'
import { messengerLeadSource } from '@/lib/facebook/messenger/rules'

export type MessengerLeadResult =
  | { ok: true; leadId: number }
  | { ok: false; reason: 'not_enabled' | 'not_found' | 'quota_exceeded' | 'create_failed' }

/** `clients."lastName"` is NOT NULL: a one-word or missing name has an EMPTY last name, never null. */
function splitName(full: string | null): { firstName: string; lastName: string } {
  const parts = (full ?? '').trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return { firstName: 'פונה מ-Messenger', lastName: '' }
  return { firstName: parts[0], lastName: parts.slice(1).join(' ') }
}

async function ownedConversation(agencyId: number, conversationId: number) {
  const id = Number(conversationId)
  if (!Number.isInteger(id) || id <= 0) return null
  return db('messenger_conversations').where({ id, agencyId }).first()
}

/**
 * "צור ליד" from a Messenger conversation.
 *
 * Same path and guarantees as Facebook comment conversion: the PUBLIC
 * `upsertLead` (product access, quota lock, field allowlist, lead_created
 * automation), a `leadSource` that includes the agency and Page because a PSID
 * is only unique inside its Page, and orphan adoption so a crash between create and
 * link can never produce a second lead. A Messenger contact has no phone or
 * email — nothing is invented.
 */
export async function createLeadFromMessengerConversation(conversationId: number): Promise<MessengerLeadResult> {
  const user = await requireAgencyUser()
  if (!isFacebookMessengerEnabledForAgency(user.agencyId)) return { ok: false, reason: 'not_enabled' }
  const conversation = await ownedConversation(user.agencyId, conversationId)
  if (!conversation) return { ok: false, reason: 'not_found' }
  if (conversation.leadId) return { ok: true, leadId: conversation.leadId }

  const leadSource = messengerLeadSource(user.agencyId, conversation.pageId, conversation.psid)
  const link = async (leadId: number) => {
    await db('messenger_conversations').where({ id: conversation.id, agencyId: user.agencyId }).update({ leadId, updatedAt: new Date() })
    revalidatePath('/inbox/messenger')
  }

  const orphan = await db('clients').where({ leadSource, agencyId: user.agencyId }).first('id')
  if (orphan?.id) {
    await link(orphan.id)
    return { ok: true, leadId: orphan.id }
  }

  const { firstName, lastName } = splitName(conversation.customerName)
  // Entitlement/quota errors thrown by upsertLead's own guard propagate to useAction.
  // status/userId explicit: the column defaults ('true', NULL) hide a ליד from every status tab and rep filter.
  const lead = await upsertLead(
    user.id,
    { firstName, lastName, leadSource, lead: true, status: 'new', userId: user.id, handlerId: user.id },
    undefined,
    true,
    'manual',
  )
  if (!lead) return { ok: false, reason: 'create_failed' }
  if (typeof lead === 'object' && 'error' in lead) {
    return { ok: false, reason: lead.error === 'quota_exceeded' ? 'quota_exceeded' : 'create_failed' }
  }
  await link(lead.id)
  return { ok: true, leadId: lead.id }
}

/**
 * "קשר לליד קיים". The lead is read through `getLeadById`, which enforces the
 * caller's agency AND, for non-admins, their lead permissions — a rep cannot
 * attach a conversation to a lead they are not allowed to see.
 */
export async function linkMessengerConversationToLead(conversationId: number, leadId: number): Promise<MessengerLeadResult> {
  const user = await requireAgencyUser()
  if (!isFacebookMessengerEnabledForAgency(user.agencyId)) return { ok: false, reason: 'not_enabled' }
  const conversation = await ownedConversation(user.agencyId, conversationId)
  if (!conversation) return { ok: false, reason: 'not_found' }
  const lead = await getLeadById(leadId)
  if (!lead) return { ok: false, reason: 'not_found' }
  await db('messenger_conversations').where({ id: conversation.id, agencyId: user.agencyId }).update({ leadId: lead.id, updatedAt: new Date() })
  revalidatePath('/inbox/messenger')
  return { ok: true, leadId: lead.id }
}
