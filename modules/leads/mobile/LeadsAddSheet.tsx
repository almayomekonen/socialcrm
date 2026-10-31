'use client'

import BottomSheet from '@/components/mobile/BottomSheet'
import Icon from '@/lib/Icon'
import { useT } from '@/lib/i18n/I18nProvider'

/**
 * Populated-Leads chooser — add or import, never both sheets at once.
 * Same two actions as `LeadsFirstRunMobile`; this only appears after the
 * workspace already has leads, so the empty first-run stays untouched.
 */
export default function LeadsAddSheet({
  open,
  onClose,
  onAdd,
  onImport,
}: {
  open: boolean
  onClose: () => void
  onAdd: () => void
  onImport: () => void
}) {
  const t = useT()
  return (
    <BottomSheet open={open} onClose={onClose} title={t('leads.add')} titleId='leads-add-sheet' translated>
      <div className='flex flex-col gap-2'>
        <button
          type='button'
          className='press flex min-h-11 w-full items-center justify-center gap-2 rounded-md bg-solid font-medium text-white hover:bg-solid/85 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary'
          onClick={onAdd}
        >
          <Icon name='plus' type='sol' className='size-4 bg-white' />
          {t('leads.empty.addLead')}
        </button>
        <button
          type='button'
          className='press flex min-h-11 w-full items-center justify-center gap-2 rounded-md border border-gray-200 bg-white font-medium text-ink hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary'
          onClick={onImport}
        >
          <Icon name='file-excel' type='sol' className='size-4 bg-ink' />
          {t('leads.mobile.sheet.importLeads')}
        </button>
        <button
          type='button'
          className='press flex min-h-11 w-full items-center justify-center rounded-md font-medium text-gray-600 hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary'
          onClick={onClose}
        >
          {t('common.dialog.cancel')}
        </button>
      </div>
    </BottomSheet>
  )
}
