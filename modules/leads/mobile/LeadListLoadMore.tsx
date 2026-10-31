'use client'

import Icon from '@/lib/Icon'
import { useT } from '@/lib/i18n/I18nProvider'

/**
 * "טען עוד" — one control, and it only exists while there IS a next batch:
 * when the list is exhausted the caller stops rendering it rather than leaving
 * a dead "עמוד N" with nowhere to go (extracted from `LeadListMobileClient`,
 * no behaviour change).
 */
export default function LeadListLoadMore({ loading, onLoad }: { loading: boolean; onLoad: () => void }) {
  const t = useT()
  return (
    <div className='px-4 py-4'>
      <button
        type='button'
        onClick={onLoad}
        disabled={loading}
        aria-busy={loading}
        className='press flex min-h-11 w-full items-center justify-center gap-2 rounded-md border border-gray-200 bg-white text-sm font-medium text-gray-800 disabled:opacity-60 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary'
      >
        {loading ? (
          <>
            <Icon name='spinner' type='sol' aria-hidden className='size-4 animate-spin bg-gray-500' />
            {t('leads.empty.loading')}
          </>
        ) : (
          t('leads.mobile.list.loadMore')
        )}
      </button>
    </div>
  )
}
