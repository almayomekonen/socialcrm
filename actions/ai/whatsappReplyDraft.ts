'use server'

import { requireProductAccess } from '@/lib/requireUser'
import { runStructured } from '@/lib/ai/router'
import { getLeadIntelligenceInputs } from '@/db/aiSummaries'
import { getFullLead } from '@/db/clients'
import { listLeadWhatsappMessages } from '@/db/inboxMessages'
import {
  LEAD_FOLLOWUP_SYSTEM_PROMPT,
  LeadFollowupSchema,
  sanitizeLeadFollowup,
  type LeadFollowup,
} from '@/lib/ai/prompts/leadFollowup'
import { buildWhatsappReplyUserMessage } from '@/lib/ai/prompts/whatsappReplyDraft'

/**
 * Generate a WhatsApp reply draft for a lead — UI helper only.
 *
 * Reuses the existing AI infrastructure (runStructured + the lead-followup
 * prompt/schema/sanitizer) but calls the model primitive DIRECTLY rather than
 * through defineCachedLeadAction, so there is NO cache and NO persistence: every
 * call is a fresh generation (enables "regenerate") and nothing is written to
 * ai_messages / inbox. The returned message only populates a client-side draft.
 */

export type WhatsappReplyDraftResult = { ok: true; message: string } | { ok: false; reason: string }

const RECENT_MESSAGE_LIMIT = 10

export async function generateWhatsappReplyDraft(
  leadIdRaw: number | string,
): Promise<WhatsappReplyDraftResult> {
  const leadId = Number(leadIdRaw)
  if (!Number.isFinite(leadId) || leadId <= 0) return { ok: false, reason: 'invalid-input' }

  const user = await requireProductAccess()

  const [snapshot, leadMeta, allMessages] = await Promise.all([
    getLeadIntelligenceInputs(leadId).catch(() => null),
    getFullLead({ id: leadId, select: ['name'] }).catch(() => null),
    listLeadWhatsappMessages(leadId).catch(() => []),
  ])
  if (!snapshot) return { ok: false, reason: 'invalid-input' }

  const recent = allMessages.slice(-RECENT_MESSAGE_LIMIT)
  const userMessage = buildWhatsappReplyUserMessage(
    snapshot.inputs,
    (leadMeta?.name as string | undefined) ?? null,
    recent,
  )

  const out = await runStructured({
    kind: 'lead.followup',
    schema: LeadFollowupSchema,
    schemaName: 'WhatsappReplyDraft',
    schemaDescription: 'טיוטת תשובה אחת בוואטסאפ, מבוססת על נתוני הליד וההודעות האחרונות',
    system: LEAD_FOLLOWUP_SYSTEM_PROMPT,
    user: userMessage,
    leadId,
    agencyId: user.agencyId,
    userId: user.id,
  })

  if (out.ok === false) return { ok: false, reason: out.reason }

  const { result } = sanitizeLeadFollowup(out.data as LeadFollowup)
  if (!result) return { ok: false, reason: 'invalid-output' }

  return { ok: true, message: result.message }
}
