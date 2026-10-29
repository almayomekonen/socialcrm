import { inboundChannelFromSource } from '@/lib/leads/leadSourceLabel'
import {
  facebookFieldPresence,
  formatCaptureAt,
  loadLeadFormAnswers,
  loadWhatsAppInboundPreview,
} from '@/lib/leads/inboundLeadContextData'
import { InboundLeadContextView } from './InboundLeadContextView'
import type { UiLocale } from '@/lib/i18n/config'

/**
 * "This lead arrived automatically" context surface for the lead summary.
 *
 * Shows ONLY for genuinely auto-ingested (webhook-created) leads — the composite
 * `whatsapp:{id}` / `facebook:{id}` sources — never for manual/plain/free-text
 * sources. Presentation + existing-read only: it does not touch the webhook,
 * ingestion, dedup, or any stored value.
 *
 * WhatsApp additionally surfaces the customer's FIRST inbound message (the "how
 * this lead entered" moment) and a CTA into the existing Inbox thread, resolved
 * through the agency-scoped `getInboxConversationByLeadId`. Any inbox-read failure
 * degrades to copy-only and NEVER breaks the lead page.
 *
 * Facebook has no conversation to link. Its evidence is the contact detail
 * CATEGORIES SocialCRM auto-captured from the ad form (name/phone/email) and the
 * capture time — read straight off the lead the summary page already fetched. No
 * Graph call, no page/campaign/ad/form lookup, no extra query.
 */

export default async function InboundLeadContext({
  leadId,
  leadSource,
  createdAt,
  firstName,
  lastName,
  phone,
  email,
  locale = 'he',
}: {
  leadId: number
  leadSource: string | null | undefined
  createdAt?: Date | string | null
  firstName?: string | null
  lastName?: string | null
  phone?: string | null
  email?: string | null
  /** Interface language (resolved once by the page); Hebrew by default. */
  locale?: UiLocale
}) {
  const channel = inboundChannelFromSource(leadSource)
  // Lead Ads: Facebook and Instagram forms arrive through the same webhook and
  // carry the same evidence, plus the customer's full form answers.
  if (channel === 'facebook' || channel === 'instagram') {
    // Evidence = which detail categories the lead currently holds. Presence-based
    // (no per-field provenance); the ingestion name placeholder does not count.
    const { hasName, hasPhone, hasEmail } = facebookFieldPresence({ firstName, lastName, phone, email })
    return (
      <InboundLeadContextView
        channel={channel}
        hasName={hasName}
        hasPhone={hasPhone}
        hasEmail={hasEmail}
        capturedAt={formatCaptureAt(createdAt, locale)}
        formAnswers={await loadLeadFormAnswers(leadId, locale)}
        locale={locale}
      />
    )
  }
  if (channel !== 'whatsapp') return null // manual / plain / unknown → nothing

  const { conversationId, preview } = await loadWhatsAppInboundPreview(leadId)
  return <InboundLeadContextView channel='whatsapp' conversationId={conversationId} preview={preview} locale={locale} />
}
