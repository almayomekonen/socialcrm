import { INBOUND_LEAD_COPY } from '@/lib/leads/inboundLeadCopy'
import type { FormAnswerRow } from '@/lib/leads/inboundLeadContextData'

/**
 * "תשובות מהטופס" — what the customer answered in the Lead Ads form, inside the
 * existing inbound-lead card (desktop) and provenance card (mobile). Same
 * bordered-box treatment as the card's quoted first message.
 *
 * The answers are the customer's own text: rendered as text (React escapes it)
 * and wrapped so a long answer can never widen the card. Each label and value
 * sits in a `<bdi>`: the list stays right-aligned like the card, while an
 * English question or a number keeps its own direction and punctuation
 * ("when do you want to start?" never becomes "?when…"). Renders nothing when
 * there are none.
 */
export default function LeadFormAnswersList({ rows }: { rows: FormAnswerRow[] }) {
  if (rows.length === 0) return null
  return (
    <div className='mt-3'>
      <h3 className='text-xs font-medium text-gray-500'>{INBOUND_LEAD_COPY.formAnswersHeading}</h3>
      <dl className='mt-1.5 divide-y divide-gray-100 rounded-md border border-gray-100 bg-gray-50'>
        {rows.map((row, i) => (
          <div key={`${i}:${row.label}`} className='flex flex-col gap-0.5 px-3 py-2'>
            <dt className='break-words text-xs text-gray-500'>
              <bdi>{row.label}</bdi>
            </dt>
            <dd className='break-words text-sm leading-relaxed text-gray-800'>
              {row.values.length > 0 ? <bdi>{row.values.join(' · ')}</bdi> : INBOUND_LEAD_COPY.formAnswerEmpty}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  )
}
