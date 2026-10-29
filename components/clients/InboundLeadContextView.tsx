import Link from 'next/link'
import Icon from '@/lib/Icon'
import { facebookCapturedFieldLabels, type FormAnswerRow } from '@/lib/leads/inboundLeadContextData'
import LeadFormAnswersList from '@/components/clients/LeadFormAnswersList'
import { dirFor, regionAttrs, type UiLocale } from '@/lib/i18n/config'
import { translatorFor } from '@/lib/i18n/translators'
import type { MessageKey } from '@/lib/i18n/translate'

/**
 * Presentational, side-effect-free view for the "this lead arrived automatically"
 * context surface. All data (channel, first-inbound preview, conversation id) is
 * resolved by the server wrapper and passed in — this component only renders.
 *
 * Static page metadata, NOT an announced event: plain semantic structure, no
 * role='status', not dismissible, no one-shot state.
 */
type Props = {
  channel: 'whatsapp' | 'facebook' | 'instagram'
  /** WhatsApp only: the linked conversation id, when one exists. */
  conversationId?: number | null
  /** WhatsApp only: the customer's FIRST inbound message text, when usable. */
  preview?: string | null
  /**
   * Facebook only: which CATEGORIES of contact detail the lead currently holds.
   * These drive the "נקלטו אוטומטית" evidence labels. They reflect current field
   * PRESENCE, not untouched provenance — there is no per-field history, so a value
   * edited by the user later still counts. We never render the values themselves.
   */
  hasName?: boolean
  hasPhone?: boolean
  hasEmail?: boolean
  /**
   * Facebook only: SocialCRM's CAPTURE time (clients.createdAt), pre-formatted
   * server-side in the business timezone. NOT Meta's submission time — copy says
   * "נקלט אצלך", never "נשלח"/"מילא".
   */
  capturedAt?: string | null
  /** Lead Ads only: the customer's answers beyond name/phone/email. */
  formAnswers?: FormAnswerRow[]
  /** Interface language of the chrome; customer text and Meta answers are shown as they are. */
  locale?: UiLocale
}

/** Lead Ads channel mark and headline — Facebook and Instagram share the card. */
const FORM_CHANNEL = {
  facebook: { icon: 'facebook', wrap: 'bg-[#1877F2]/10', mark: 'bg-[#1877F2]', headline: 'leadDetail.inbound.facebookHeadline' as MessageKey },
  instagram: { icon: 'instagram', wrap: 'bg-[#E4405F]/10', mark: 'bg-[#E4405F]', headline: 'leadDetail.inbound.instagramHeadline' as MessageKey },
} as const

export function InboundLeadContextView({
  channel,
  conversationId,
  preview,
  hasName,
  hasPhone,
  hasEmail,
  capturedAt,
  formAnswers = [],
  locale = 'he',
}: Props) {
  const t = translatorFor(locale)
  const region = { dir: dirFor(locale), ...regionAttrs(locale) }
  if (channel === 'facebook' || channel === 'instagram') {
    const form = FORM_CHANNEL[channel]
    // Evidence labels for the categories actually present — never the values.
    const capturedLabels = facebookCapturedFieldLabels(hasName, hasPhone, hasEmail, locale)
    return (
      <section {...region} className='mb-6 rounded-lg border border-gray-200 bg-white p-4'>
        <div className='flex items-start gap-3'>
          <span className={`flex size-8 flex-none items-center justify-center rounded-lg ${form.wrap}`}>
            <Icon name={form.icon} type='reg' aria-hidden className={`size-4 ${form.mark}`} />
          </span>
          <div className='min-w-0 flex-1'>
            <h2 className='text-sm font-semibold text-ink'>{t(form.headline)}</h2>
            <p className='mt-0.5 text-sm text-gray-600'>{t('leadDetail.inbound.facebookBody')}</p>

            {capturedLabels.length > 0 || capturedAt ? (
              <div className='mt-2 flex flex-col gap-0.5 text-xs text-gray-500'>
                {capturedLabels.length > 0 ? (
                  <p>{t('leadDetail.inbound.capturedFields', { fields: capturedLabels.join(' · ') })}</p>
                ) : null}
                {capturedAt ? (
                  <p>{t('leadDetail.inbound.capturedAt', { date: capturedAt })}</p>
                ) : null}
              </div>
            ) : null}

            <LeadFormAnswersList rows={formAnswers} locale={locale} />
          </div>
        </div>
      </section>
    )
  }

  // WhatsApp. Supporting copy reflects whether a conversation was captured too.
  const supporting = conversationId
    ? t('leadDetail.inbound.whatsappWithConversation')
    : t('leadDetail.inbound.whatsappWithoutConversation')

  return (
    <section {...region} className='mb-6 rounded-lg border border-gray-200 bg-white p-4'>
      <div className='flex items-start gap-3'>
        <span className='flex size-8 flex-none items-center justify-center rounded-lg bg-[#25D366]/10'>
          <Icon name='whatsapp' type='reg' aria-hidden className='size-4 bg-[#25D366]' />
        </span>
        <div className='min-w-0 flex-1'>
          <h2 className='text-sm font-semibold text-ink'>{t('leadDetail.inbound.whatsappHeadline')}</h2>
          <p className='mt-0.5 text-sm text-gray-600'>{supporting}</p>

          {preview ? (
            // Real persisted customer text, rendered as text (React escapes it),
            // dir='auto' for natural RTL/LTR, clamped so a long message can't grow
            // the surface. Secondary to the lead.
            <p
              dir='auto'
              className='mt-2 line-clamp-2 rounded-md border border-gray-100 bg-gray-50 px-3 py-2 text-sm leading-relaxed text-gray-700'
            >
              {preview}
            </p>
          ) : null}

          {conversationId ? (
            <Link
              href={`/inbox?conversation=${conversationId}`}
              className='mt-3 inline-flex h-9 items-center gap-1.5 rounded-md border border-gray-200 bg-white px-4 text-sm font-medium text-gray-800 hover:bg-gray-50'
            >
              <Icon name='whatsapp' type='reg' aria-hidden className='size-3.5 bg-[#25D366]' />
              {t('leadDetail.inbound.openConversation')}
            </Link>
          ) : null}
        </div>
      </div>
    </section>
  )
}
