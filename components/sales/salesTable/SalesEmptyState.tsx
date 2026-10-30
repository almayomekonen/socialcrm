'use client'

import { Btn } from '@/lib/btns/Btn'
import { useT } from '@/lib/i18n/I18nProvider'

/** The deals table's empty state (no deals, or none under the active filter): go to leads, or add a deal when leads exist. */
export default function SalesEmptyState({ hasLeads, onAdd }: { hasLeads?: boolean; onAdd: () => void }) {
  const t = useT()
  return (
    <div className='text-center py-8 flex flex-col items-center gap-4'>
      <p className='text-lg font-semibold'>{t('deals.table.empty.title')}</p>
      <p className='text-sm text-gray-500'>{t('deals.table.empty.body')}</p>
      <div className='flex gap-3 justify-center items-center'>
        <Btn lbl={t('deals.table.empty.toLeads')} href='/leads' />
        {hasLeads && <Btn lbl={t('deals.table.add')} icon='plus' variant='ghost' onClick={onAdd} />}
      </div>
    </div>
  )
}
