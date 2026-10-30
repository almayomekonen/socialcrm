'use client'

import ModalPop from '@/lib/modals/ModalPop'
import { Btn } from '@/lib/btns/Btn'
import { ADD_LEAD_SEL, eduSel } from '@/lib/education'
import { useT } from '@/lib/i18n/I18nProvider'
import { regionAttrs } from '@/lib/i18n/config'

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
  const t = useT()
  // Hebrew keeps its explicit `dir='rtl'`; otherwise the dialog declares the interface language.
  const region = regionAttrs(t.locale)
  return (
    <ModalPop
      open
      onClose={onDismiss}
      pos='middle'
      labelledBy='leads-tour-empty-title'
      closeOutside
      className='w-[min(100%,24rem)]'
      translated
    >
      <div dir={region.dir ?? 'rtl'} lang={region.lang} className='grid gap-4 text-start'>
        <div>
          <h2 id='leads-tour-empty-title' className='text-lg font-bold text-ink'>
            {t('education.leadsEmpty.title')}
          </h2>
          <p className='mt-1 text-sm text-gray-600'>{t('education.leadsEmpty.body')}</p>
        </div>
        <Btn lbl={t('leads.empty.addLead')} icon='plus' onClick={onAddLead} />
        <Btn variant='outline' lbl={t('education.leadsEmpty.dismiss')} onClick={onDismiss} />
      </div>
    </ModalPop>
  )
}
