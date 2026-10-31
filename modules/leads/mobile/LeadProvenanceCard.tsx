import Link from 'next/link'
import Icon from '@/lib/Icon'
import type { IconNames } from '@/lib/Icon'
import { INBOUND_LEAD_COPY } from '@/lib/leads/inboundLeadCopy'
import type { MobileProvenanceModel, ProvenanceVisual } from './leadProvenanceModel'
import type { FormAnswerRow } from '@/lib/leads/inboundLeadContextData'
import LeadFormAnswersList from '@/components/clients/LeadFormAnswersList'
import { dirFor, type UiLocale } from '@/lib/i18n/config'
import { translatorFor } from '@/lib/i18n/translators'

/**
 * Mobile-native provenance card. Same information as desktop inbound context,
 * laid out for a phone: stacked type, wrapping Hebrew, circular channel mark.
 *
 * Informational by default — only the existing WhatsApp "open conversation"
 * control is interactive, and it is a sibling of the copy, never wrapping it.
 */

const VISUAL: Record<ProvenanceVisual, { icon: IconNames; type: 'reg' | 'sol'; wrap: string; mark: string }> = {
  facebook: { icon: 'facebook', type: 'reg', wrap: 'bg-[#1877F2]/10', mark: 'bg-[#1877F2]' },
  whatsapp: { icon: 'whatsapp', type: 'reg', wrap: 'bg-[#25D366]/10', mark: 'bg-[#25D366]' },
  instagram: { icon: 'instagram', type: 'reg', wrap: 'bg-[#E4405F]/10', mark: 'bg-[#E4405F]' },
  website: { icon: 'globe', type: 'sol', wrap: 'bg-violet-100', mark: 'bg-violet-700' },
  manual: { icon: 'user-pen', type: 'sol', wrap: 'bg-gray-100', mark: 'bg-gray-600' },
  import: { icon: 'file-excel', type: 'sol', wrap: 'bg-gray-100', mark: 'bg-ink' },
  other: { icon: 'circle-info', type: 'sol', wrap: 'bg-gray-100', mark: 'bg-gray-600' },
}

export default function LeadProvenanceCard({
  model,
  formAnswers = [],
  locale = 'he',
}: {
  model: MobileProvenanceModel
  /** Lead Ads only: the customer's answers beyond name/phone/email. */
  formAnswers?: FormAnswerRow[]
  /** Our copy's language (Hebrew by default); the customer's answers and message are shown as received. */
  locale?: UiLocale
}) {
  const t = translatorFor(locale)
  const visual = VISUAL[model.visual]
  const hasMeta = model.capturedLabels.length > 0 || !!model.capturedAt

  return (
    <section
      dir={dirFor(locale)}
      data-testid='lead-provenance-mobile'
      data-source-visual={model.visual}
      className='mt-4 rounded-xl border border-gray-200 bg-white p-4'
    >
      {/*
        HEADER ROW ONLY — the channel mark sits with the TITLE, not beside the
        whole card.

        It used to be a flex sibling of the entire content stack (headline, body,
        quote, capture meta, full-width CTA), so a 44px mark reserved a
        full-HEIGHT column that was empty below its first 44px. On a phone, with
        a tall card, that read as a two-column layout with a large blank strip.

        Now it is a compact 40px contextual indicator on the title line, and
        every block below runs the full card width. RTL is unchanged: the row is
        still `dir='rtl'`, so the mark stays leading (right) and the title
        follows it.
      */}
      <div className='flex items-center gap-2.5'>
        <span className={`flex size-10 shrink-0 items-center justify-center rounded-full ${visual.wrap}`} aria-hidden>
          <Icon name={visual.icon} type={visual.type} className={`size-5 ${visual.mark}`} />
        </span>
        <h2 className='min-w-0 flex-1 text-base font-semibold leading-snug break-words text-ink'>{model.headline}</h2>
      </div>

      {model.body ? <p className='mt-1 text-sm leading-relaxed break-words text-gray-600'>{model.body}</p> : null}

      {model.preview ? (
        <p
          dir='auto'
          className='mt-3 line-clamp-2 break-words rounded-md border border-gray-100 bg-gray-50 px-3 py-2 text-sm leading-relaxed text-gray-700'
        >
          {model.preview}
        </p>
      ) : null}

      {hasMeta ? (
        <div className='mt-3 flex flex-col gap-1 text-sm leading-relaxed text-gray-500'>
          {model.capturedLabels.length > 0 ? (
            <p className='break-words'>
              {locale === 'he' ? (
                <>
                  {INBOUND_LEAD_COPY.capturedFieldsPrefix}: {model.capturedLabels.join(' · ')}
                </>
              ) : (
                t('leadDetail.inbound.capturedFields', { fields: model.capturedLabels.join(' · ') })
              )}
            </p>
          ) : null}
          {model.capturedAt ? (
            <p className='break-words'>
              {locale === 'he' ? (
                <>
                  {INBOUND_LEAD_COPY.capturedAtPrefix}
                  {model.capturedAt}
                </>
              ) : (
                t('leadDetail.inbound.capturedAt', { date: model.capturedAt })
              )}
            </p>
          ) : null}
        </div>
      ) : null}

      <LeadFormAnswersList rows={formAnswers} locale={locale} />

      {model.conversationId ? (
        <Link
          href={`/inbox?conversation=${model.conversationId}`}
          className='mt-3 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-md border border-gray-200 bg-white px-4 text-sm font-medium text-gray-800'
        >
          <Icon name='whatsapp' type='reg' aria-hidden className='size-4 bg-[#25D366]' />
          {t('leadDetail.inbound.openConversation')}
        </Link>
      ) : null}
    </section>
  )
}
