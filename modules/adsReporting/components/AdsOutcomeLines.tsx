import { formatAdsCount, formatAdsMoney } from '@/lib/facebook/ads/format'
import { costPerCapturedLead, handledCount, type CrmOutcome } from '@/lib/facebook/ads/crmOutcomes'
import { RESULT_LABEL, type RowResult } from '@/lib/facebook/ads/results'

/**
 * The two kinds of number a campaign or ad card shows, each on its own line
 * with its own source label, so they can never be read as one:
 *
 *   לפי Meta      — spend and Meta's own result count/cost (Marketing API).
 *   ב-SocialCRM   — leads actually captured here with this campaign/ad's id,
 *                   and what happened to them since.
 *
 * "—" means unknown; 0 is a real zero.
 */

function Stat({ label, value, title }: { label: string; value: string; title?: string }) {
  return (
    <div className='min-w-0' title={title}>
      <dt className='text-[11px] text-gray-500'>{label}</dt>
      <dd dir='ltr' className='text-right text-sm font-semibold text-gray-900 tabular-nums'>
        {value}
      </dd>
    </div>
  )
}

export function MetaLine({ spend, result, currency }: { spend: number | null; result: RowResult; currency: string | null }) {
  const label = result.kind ? RESULT_LABEL[result.kind] : 'תוצאות'
  return (
    <div className='rounded-md bg-gray-50 px-3 py-2'>
      <p className='mb-1 text-[11px] font-medium text-gray-500'>לפי Meta</p>
      <dl className='grid grid-cols-3 gap-2'>
        <Stat label='הוצאה' value={formatAdsMoney(spend, currency)} />
        <Stat label={label} value={result.kind ? formatAdsCount(result.count) : '—'} />
        <Stat
          label={result.kind === 'leads' ? 'עלות לליד (Meta)' : 'עלות לתוצאה'}
          value={formatAdsMoney(result.cost, currency)}
          title='מחושב על ידי Meta: הוצאה חלקי התוצאות ש-Meta ייחסה לקמפיין'
        />
      </dl>
    </div>
  )
}

export function CrmLine({
  outcome,
  spend,
  currency,
}: {
  outcome: CrmOutcome | undefined
  /** Meta spend for the same object and period — for the separately labelled CRM cost. */
  spend: number | null
  currency: string | null
}) {
  if (!outcome || outcome.captured === 0) {
    return (
      <div className='rounded-md border border-dashed border-gray-200 px-3 py-2'>
        <p className='text-[11px] font-medium text-gray-500'>ב-SocialCRM</p>
        <p className='mt-0.5 text-xs text-gray-500'>לא נקלטו לידים עם זיהוי של הקמפיין הזה בתקופה.</p>
      </div>
    )
  }
  const perCaptured = costPerCapturedLead(spend, outcome)
  return (
    <div className='rounded-md border border-primary/15 bg-primary-tint/40 px-3 py-2'>
      <p className='mb-1 text-[11px] font-medium text-primary-text'>ב-SocialCRM</p>
      <dl className='grid grid-cols-3 gap-2 @md:grid-cols-5'>
        <Stat label='נקלטו' value={formatAdsCount(outcome.captured)} />
        <Stat label='טופלו' value={formatAdsCount(handledCount(outcome))} title='כל ליד שהסטטוס שלו כבר לא "חדש"' />
        <Stat label='לא טופלו' value={formatAdsCount(outcome.untouched)} title='לידים שעדיין בסטטוס "חדש"' />
        <Stat label='מעוניינים' value={formatAdsCount(outcome.interested)} />
        <Stat label='נסגרו' value={formatAdsCount(outcome.closed)} title='לידים בסטטוס "סגור"' />
      </dl>
      {perCaptured !== null && (
        <p className='mt-1.5 text-[11px] text-gray-600'>
          עלות לליד שנקלט ב-SocialCRM:{' '}
          <span dir='ltr' className='font-medium tabular-nums'>
            {formatAdsMoney(perCaptured, currency)}
          </span>
          <span className='text-gray-400'> · הוצאת Meta חלקי הלידים שנקלטו כאן</span>
        </p>
      )}
    </div>
  )
}
