'use server'

import { revalidatePath } from 'next/cache'
import { after } from 'next/server'
import { db } from '@/config/db'
import { upsertLead } from '@/actions/clients'
import { attachConversationToLead } from '@/db/inboxConversations'
import { enqueueConversationAnalysis } from '@/db/conversationIntelligence'
import { parseWhatsappLead } from '@/lib/adapters/whatsappLead'
import {
  enqueueInboundAutoResponse,
  findLatestUnansweredInbound,
} from '@/lib/inbox/autoresponse/enqueueInboundAutoResponse'
import { runAutoResponseKick } from '@/lib/inbox/autoresponse/kickWorker'
import { requireProductAccess } from '@/lib/requireUser'
import { findClientsByPhoneCore } from '@/lib/whatsapp/matchLeadByPhone'
import { loadOwnedConversation } from '@/lib/whatsapp/ownedConversation'

export const maxDuration = 60

export type ConversationLeadMatch = {
  id: number
  name: string
  status: string | null
  phone: string | null
}

export type PromoteConversationResult =
  | { ok: true; leadId: number; created: boolean }
  | { ok: false; reason: 'not-found' | 'lead-not-found' | 'invalid-input' | 'quota_exceeded' | 'save-failed' }

export type ListConversationLeadMatchesResult =
  | { ok: true; matches: ConversationLeadMatch[] }
  | { ok: false; reason: 'not-found' | 'invalid-input' }

async function afterLink(agencyId: number, conversationId: number, leadId: number) {
  let jobId: number | null = null
  let delaySeconds = 0
  await db.transaction(async (trx) => {
    await attachConversationToLead(trx, { conversationId, agencyId, leadId })
    await enqueueConversationAnalysis(trx, {
      conversationId,
      agencyId,
      channel: 'whatsapp',
      triggerSequence: 0,
      reason: 'new_message',
    })
    // IRE only for an unanswered inbound. Leadless ingest correctly skipped
    // enqueue; promotion is the moment this becomes a sales conversation.
    const unanswered = await findLatestUnansweredInbound(trx, conversationId)
    if (unanswered) {
      const enqueued = await enqueueInboundAutoResponse(trx, {
        agencyId,
        conversationId,
        leadId,
        triggerSequence: unanswered.sequence,
      })
      jobId = enqueued.jobId
      delaySeconds = enqueued.delaySeconds
    }
  })
  // Same post-commit kick as the WhatsApp webhook. delaySeconds>0 waits until
  // approximately notBefore, then the existing worker claims. Cron remains the drain.
  if (jobId != null) {
    after(async () => {
      try {
        await runAutoResponseKick({ delaySeconds, limit: 5 })
      } catch (kickErr) {
        console.error('[auto-response] kick failed', { reason: (kickErr as Error)?.message })
      }
    })
  }
  revalidatePath('/inbox')
  revalidatePath('/leads')
}

/**
 * "+ צור ליד" — create a Lead (or link if this phone already matches exactly
 * one existing client) and remember the association on the conversation row.
 */
export async function promoteConversationToLead(conversationIdRaw: number | string): Promise<PromoteConversationResult> {
  const conversationId = Number(conversationIdRaw)
  if (!Number.isFinite(conversationId) || conversationId <= 0) return { ok: false, reason: 'invalid-input' }

  const user = await requireProductAccess()
  const conv = await loadOwnedConversation(user.agencyId, conversationId)
  if (!conv) return { ok: false, reason: 'not-found' }
  if (conv.leadId != null && conv.leadId > 0) return { ok: true, leadId: conv.leadId, created: false }

  const matches = await findClientsByPhoneCore(user.agencyId, conv.customerWaId)
  if (matches.length === 1) {
    await afterLink(user.agencyId, conv.id, matches[0].id)
    return { ok: true, leadId: matches[0].id, created: false }
  }

  const parsed = parseWhatsappLead(conv.customerWaId, conv.customerName)
  const created = await upsertLead(
    user.id,
    {
      firstName: parsed.firstName,
      lastName: parsed.lastName || '',
      phone: parsed.phone,
      lead: true,
      handlerId: user.id,
    },
    null,
    true,
    'manual',
  )

  if (created && typeof created === 'object' && 'error' in created && created.error === 'quota_exceeded') {
    return { ok: false, reason: 'quota_exceeded' }
  }
  if (!created || typeof created !== 'object' || !('id' in created) || created.id == null) {
    return { ok: false, reason: 'save-failed' }
  }

  const leadId = Number(created.id)
  await afterLink(user.agencyId, conv.id, leadId)
  return { ok: true, leadId, created: true }
}

/**
 * "קשר לליד קיים" — link this conversation to an existing Lead in the same
 * agency. Never creates a duplicate.
 */
export async function linkConversationToExistingLead(
  conversationIdRaw: number | string,
  targetLeadIdRaw: number | string,
): Promise<PromoteConversationResult> {
  const conversationId = Number(conversationIdRaw)
  const targetLeadId = Number(targetLeadIdRaw)
  if (!Number.isFinite(conversationId) || conversationId <= 0) return { ok: false, reason: 'invalid-input' }
  if (!Number.isFinite(targetLeadId) || targetLeadId <= 0) return { ok: false, reason: 'invalid-input' }

  const user = await requireProductAccess()
  const conv = await loadOwnedConversation(user.agencyId, conversationId)
  if (!conv) return { ok: false, reason: 'not-found' }
  if (conv.leadId != null && conv.leadId > 0) return { ok: true, leadId: conv.leadId, created: false }

  const lead = await db('clients').where({ id: targetLeadId, agencyId: user.agencyId }).first('id')
  if (!lead) return { ok: false, reason: 'lead-not-found' }

  await afterLink(user.agencyId, conv.id, Number(lead.id))
  return { ok: true, leadId: Number(lead.id), created: false }
}

export async function listConversationLeadMatches(
  conversationIdRaw: number | string,
): Promise<ListConversationLeadMatchesResult> {
  const conversationId = Number(conversationIdRaw)
  if (!Number.isFinite(conversationId) || conversationId <= 0) return { ok: false, reason: 'invalid-input' }

  const user = await requireProductAccess()
  const conv = await loadOwnedConversation(user.agencyId, conversationId)
  if (!conv) return { ok: false, reason: 'not-found' }

  const matches = await findClientsByPhoneCore(user.agencyId, conv.customerWaId)
  return { ok: true, matches }
}
