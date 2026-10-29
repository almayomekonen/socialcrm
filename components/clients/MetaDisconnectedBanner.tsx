'use client'

import { useT } from '@/lib/i18n/I18nProvider'

export default function MetaDisconnectedBanner({ show }: { show: boolean }) {
  const t = useT()
  if (!show) return null

  return (
    <div className='mb-4 flex items-center justify-between gap-4 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3'>
      <p className='text-sm font-semibold text-amber-900'>
        {t('leads.banners.metaDisconnected')}
      </p>
      <a
        href='/settings/integrations?section=facebook'
        className='shrink-0 rounded-md bg-solid px-4 py-2 text-sm font-semibold text-white hover:bg-solid/85'
      >
        {t('leads.banners.reconnect')}
      </a>
    </div>
  )
}
