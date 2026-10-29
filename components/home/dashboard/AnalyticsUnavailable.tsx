import Link from 'next/link'
import type { UiLocale } from '@/lib/i18n/config'
import { translatorFor } from '@/lib/i18n/translators'

// Shown when the analytics query fails. The brief above still works; the user
// learns what is missing and can retry without losing their place.
export default function AnalyticsUnavailable({ locale = 'he' }: { locale?: UiLocale }) {
  const t = translatorFor(locale)
  return (
    <section role='status' className='flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border bg-surface px-[22px] py-5'>
      <div>
        <h2 className='text-[15px] font-bold text-ink'>{t('today.analytics.unavailableTitle')}</h2>
        <p className='mt-0.5 text-sm text-gray-500'>{t('today.analytics.unavailableBody')}</p>
      </div>
      <Link
        href='/dashboard'
        className='inline-flex h-10 items-center rounded-[10px] border border-border px-4 text-[15px] font-semibold whitespace-nowrap text-ink hover:border-primary hover:text-primary-text focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary'
      >
        {t('today.analytics.reload')}
      </Link>
    </section>
  )
}
