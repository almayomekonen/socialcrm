import type { DashboardStats } from '@/lib/dashboard/stats'
import type { UiLocale } from '@/lib/i18n/config'
import { translatorFor } from '@/lib/i18n/translators'
import SourceDonut from './SourceDonut'

// Lead sources for the period (async RSC) — one tab of the dashboard's tabbed
// section. Same bordered panel as the leads table beside it.
export default async function SourcesPanel({
  stats: statsPromise,
  locale = 'he',
}: {
  stats: Promise<DashboardStats | null>
  locale?: UiLocale
}) {
  const t = translatorFor(locale)
  const stats = await statsPromise
  return (
    <div className='rounded-lg border border-neutral-200 bg-white p-6'>
      {stats && stats.sources.length > 0 ? (
        <>
          <p className='mb-4 text-sm text-neutral-500'>{t('today.analytics.newLeadsSub', { range: stats.range })}</p>
          <SourceDonut slices={stats.sources} />
        </>
      ) : (
        <p className='py-10 text-center text-sm text-neutral-500'>{t('today.analytics.trendEmpty')}</p>
      )}
    </div>
  )
}
