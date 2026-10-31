import { INBOUND_LEAD_COPY } from '@/lib/leads/inboundLeadCopy'
import {
  facebookCapturedFieldLabels,
  facebookFieldPresence,
  formatCaptureAt,
} from '@/lib/leads/inboundLeadContextData'
import { inboundChannelFromSource, leadSourceLabel, type LeadSourceChannel } from '@/lib/leads/leadSourceLabel'
import type { UiLocale } from '@/lib/i18n/config'
import { translatorFor } from '@/lib/i18n/translators'

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

/**
 * `locale` (Hebrew by default — the exact model as before) words the copy, the
 * captured-field labels, the capture time and the source label. The visual is
 * still decided from the STORED source and its Hebrew label.
 */
export function buildMobileProvenanceModel(input: LeadProvenanceInput, locale: UiLocale = 'he'): MobileProvenanceModel {
  const inbound = inboundChannelFromSource(input.leadSource)
  const visual = provenanceVisual(input.leadSource, input.sourceChannel, input.sourceLabel)
  const capturedAt = formatCaptureAt(input.createdAt ?? null, locale)
  const t = translatorFor(locale)
  const copy = locale === 'he' ? INBOUND_LEAD_COPY : {
    facebookHeadline: t('leadDetail.inbound.facebookHeadline'),
    facebookBody: t('leadDetail.inbound.facebookBody'),
    whatsappHeadline: t('leadDetail.inbound.whatsappHeadline'),
    whatsappWithConversation: t('leadDetail.inbound.whatsappWithConversation'),
    whatsappWithoutConversation: t('leadDetail.inbound.whatsappWithoutConversation'),
  }

  if (inbound === 'facebook') {
    const presence = facebookFieldPresence(input)
    return {
      visual: 'facebook',
      headline: copy.facebookHeadline,
      body: copy.facebookBody,
      capturedLabels: facebookCapturedFieldLabels(presence.hasName, presence.hasPhone, presence.hasEmail, locale),
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
      headline: copy.whatsappHeadline,
      body: conversationId
        ? copy.whatsappWithConversation
        : copy.whatsappWithoutConversation,
      capturedLabels: [],
      capturedAt,
      preview,
      conversationId,
    }
  }

  return {
    visual,
    headline: locale === 'he' ? input.sourceLabel : leadSourceLabel(input.leadSource, locale),
    body: null,
    capturedLabels: [],
    capturedAt,
    preview: null,
    conversationId: null,
  }
}
