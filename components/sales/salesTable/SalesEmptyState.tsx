'use client'

import { Btn } from '@/lib/btns/Btn'

/** The deals table's empty state (no deals, or none under the active filter): go to leads, or add a deal when leads exist. */
export default function SalesEmptyState({ hasLeads, onAdd }: { hasLeads?: boolean; onAdd: () => void }) {
  return (
    <div className='text-center py-8 flex flex-col items-center gap-4'>
      <p className='text-lg font-semibold'>אין עדיין עסקאות</p>
      <p className='text-sm text-gray-500'>כדי להתחיל, עבור ללידים וסגור עסקה</p>
      <div className='flex gap-3 justify-center items-center'>
        <Btn lbl='מעבר ללידים' href='/leads' />
        {hasLeads && <Btn lbl='הוסף עסקה' icon='plus' variant='ghost' onClick={onAdd} />}
      </div>
    </div>
  )
}
