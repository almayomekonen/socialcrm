'use client'

import ModalPop from '@/lib/modals/ModalPop'
import { Btn } from '@/lib/btns/Btn'
import { ADD_LEAD_SEL, eduSel } from '@/lib/education'

/** Clicks the existing Add Lead control. Does not mount a second form. */
export function openExistingAddLead(): boolean {
  if (typeof document === 'undefined') return false
  const el =
    document.querySelector<HTMLElement>(ADD_LEAD_SEL) ||
    document.querySelector<HTMLElement>(eduSel('leads-add'))
  if (!el) return false
  const target =
    el.tagName === 'BUTTON' || el.tagName === 'A' ? el : (el.querySelector<HTMLElement>('button, a') ?? el)
  target.click()
  return true
}

export default function LeadsTourEmptyNotice({
  onDismiss,
  onAddLead,
}: {
  onDismiss: () => void
  onAddLead: () => void
}) {
  return (
    <ModalPop
      open
      onClose={onDismiss}
      pos='middle'
      labelledBy='leads-tour-empty-title'
      closeOutside
      className='w-[min(100%,24rem)]'
    >
      <div dir='rtl' className='grid gap-4 text-start'>
        <div>
          <h2 id='leads-tour-empty-title' className='text-lg font-bold text-ink'>
            אין כרגע לידים
          </h2>
          <p className='mt-1 text-sm text-gray-600'>כדי להתחיל את סיור הלידים, הוסף לפחות ליד אחד.</p>
        </div>
        <Btn lbl='הוסף ליד' icon='plus' onClick={onAddLead} />
        <Btn variant='outline' lbl='הבנתי' onClick={onDismiss} />
      </div>
    </ModalPop>
  )
}
