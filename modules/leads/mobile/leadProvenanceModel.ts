import { INBOUND_LEAD_COPY } from '@/lib/leads/inboundLeadCopy'
import {
  facebookCapturedFieldLabels,
  facebookFieldPresence,
  formatCaptureAt,
} from '@/lib/leads/inboundLeadContextData'
import { inboundChannelFromSource, type LeadSourceChannel } from '@/lib/leads/leadSourceLabel'

/**
 * Pure mapping from stored lead-source fields → the mobile provenance card.
 *
 * Auto-ingest copy (Facebook / WhatsApp composites) is the SAME wording as
 * desktop `InboundLeadContextView`. Other sources get identity + capture time
 * only — never invented "arrived automatically" marketing copy.
 */

export type ProvenanceVisual =
  | 'facebook'
  | 'whatsapp'
  | 'instagram'
  | 'website'
  | 'manual'
  | 'import'
  | 'other'

export type MobileProvenanceModel = {
  visual: ProvenanceVisual
  headline: string
  body: string | null
  capturedLabels: string[]
  capturedAt: string | null
  preview: string | null
  conversationId: number | null
}

export type LeadProvenanceInput = {
  leadSource: string | null | undefined
  sourceLabel: string
  sourceChannel: LeadSourceChannel | null
  createdAt?: Date | string | null
  firstName?: string | null
  lastName?: string | null
  phone?: string | null
  email?: string | null
  conversationId?: number | null
  preview?: string | null
}

export function provenanceVisual(
  source: string | null | undefined,
  sourceChannel: LeadSourceChannel | null,
  sourceLabel: string,
): ProvenanceVisual {
  const inbound = inboundChannelFromSource(source)
  if (inbound === 'facebook' || sourceChannel === 'facebook') return 'facebook'
  if (inbound === 'whatsapp' || sourceChannel === 'whatsapp') return 'whatsapp'
  if (inbound === 'instagram' || sourceChannel === 'instagram') return 'instagram'
  if (sourceChannel === 'website') return 'website'
  if ((source ?? '').trim() === 'ייבוא' || sourceLabel === 'ייבוא') return 'import'
  if (sourceChannel === 'manual') return 'manual'
  return 'other'
}

export function buildMobileProvenanceModel(input: LeadProvenanceInput): MobileProvenanceModel {
  const inbound = inboundChannelFromSource(input.leadSource)
  const visual = provenanceVisual(input.leadSource, input.sourceChannel, input.sourceLabel)
  const capturedAt = formatCaptureAt(input.createdAt ?? null)

  if (inbound === 'facebook') {
    const presence = facebookFieldPresence(input)
    return {
      visual: 'facebook',
      headline: INBOUND_LEAD_COPY.facebookHeadline,
      body: INBOUND_LEAD_COPY.facebookBody,
      capturedLabels: facebookCapturedFieldLabels(presence.hasName, presence.hasPhone, presence.hasEmail),
      capturedAt,
      preview: null,
      conversationId: null,
    }
  }

  if (inbound === 'whatsapp') {
    const conversationId = input.conversationId ?? null
    const preview = input.preview?.trim() ? input.preview.trim() : null
    return {
      visual: 'whatsapp',
      headline: INBOUND_LEAD_COPY.whatsappHeadline,
      body: conversationId
        ? INBOUND_LEAD_COPY.whatsappWithConversation
        : INBOUND_LEAD_COPY.whatsappWithoutConversation,
      capturedLabels: [],
      capturedAt,
      preview,
      conversationId,
    }
  }

  return {
    visual,
    headline: input.sourceLabel,
    body: null,
    capturedLabels: [],
    capturedAt,
    preview: null,
    conversationId: null,
  }
}
