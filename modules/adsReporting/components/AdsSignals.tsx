import type { AdsSignal } from '@/lib/facebook/ads/signals'
import type { UiLocale } from '@/lib/i18n/config'
import { translatorFor } from '@/lib/i18n/translators'

/**
 * "שימו לב" — facts the numbers prove, in neutral words, no advice. Renders
 * nothing when there is nothing true and useful to say (care-charter Law 4).
 */
export default function AdsSignals({ signals, locale = 'he' }: { signals: AdsSignal[]; locale?: UiLocale }) {
  const t = translatorFor(locale)
  if (signals.length === 0) return null
  return (
    <section aria-label={t('performance.adsIntel.signals.title')} className='rounded-lg border border-amber-200 bg-amber-50/60 px-4 py-3'>
      <h2 className='text-sm font-semibold text-gray-900'>{t('performance.adsIntel.signals.title')}</h2>
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
          {t('performance.adsIntel.signals.captureGapNote')}
        </p>
      )}
    </section>
  )
}
