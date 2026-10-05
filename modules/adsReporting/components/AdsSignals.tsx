import type { AdsSignal } from '@/lib/facebook/ads/signals'

/**
 * "שימו לב" — facts the numbers prove, in neutral words, no advice. Renders
 * nothing when there is nothing true and useful to say (care-charter Law 4).
 */
export default function AdsSignals({ signals }: { signals: AdsSignal[] }) {
  if (signals.length === 0) return null
  return (
    <section aria-label='שימו לב' className='rounded-lg border border-amber-200 bg-amber-50/60 px-4 py-3'>
      <h2 className='text-sm font-semibold text-gray-900'>שימו לב</h2>
      <ul className='mt-1.5 grid gap-1 text-sm text-gray-700'>
        {signals.map((s) => (
          <li key={`${s.kind}:${s.campaignId}`} className='flex gap-2'>
            <span aria-hidden className='mt-2 size-1.5 shrink-0 rounded-full bg-amber-500' />
            <span>{s.text}</span>
          </li>
        ))}
      </ul>
      {signals.some((s) => s.kind === 'capture_gap') && (
        <p className='mt-2 text-xs text-gray-500'>
          Meta סופרת לידים לפי הגדרות הייחוס שלה. ליד שלא נקלט ב-SocialCRM עשוי להגיע מטופס שאינו מחובר, או להיות מחוץ לטווח
          התאריכים כאן.
        </p>
      )}
    </section>
  )
}
