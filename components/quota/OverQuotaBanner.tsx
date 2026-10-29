'use client'
import { upgradeHref } from '@/lib/entitlement/upgradeHref'
import { useT } from '@/lib/i18n/I18nProvider'

export default function OverQuotaBanner({ count }: { count: number }) {
  const t = useT()
  if (!count || count <= 0) return null

  return (
    <div className='mb-4 flex items-center justify-between gap-4 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3'>
      <p className='text-sm font-semibold text-amber-900'>
        {t('leads.banners.overQuota', { count: String(count) })}
      </p>
      <a
        href={upgradeHref('over_quota_banner')}
        target='_blank'
        rel='noopener noreferrer'
        className='shrink-0 rounded-md bg-solid px-4 py-2 text-sm font-semibold text-white hover:bg-solid/85'
      >
        {t('leads.banners.upgradeNow')}
      </a>
    </div>
  )
}
