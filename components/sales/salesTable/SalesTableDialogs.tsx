'use client'

import { Btn } from '@/lib/btns/Btn'
import UploadDealsData from '@/components/sales/UploadDealsData'
import ModalPop from '@/lib/modals/ModalPop'
import ConfirmPop from '@/lib/modals/ConfirmPop'
import { ActionsMenu, getActions } from './funcs'
import { useT } from '@/lib/i18n/I18nProvider'
import type { MessageKey } from '@/lib/i18n/translate'

/** Row-menu text by action CODE (the `getActions()` key the click is switched on). */
const ACTION_LABEL: Record<string, MessageKey> = {
  מחיקה: 'deals.table.menu.delete',
  עריכה: 'deals.table.menu.edit',
  'הוספה למועדפים': 'deals.table.menu.addFavorite',
}

/**
 * The deals table's overlays: the import dialog, the row actions menu (edit /
 * delete / favourite) and the three confirmations (bulk delete, single delete,
 * the bulk-delete "skipped" notice). State lives in `SalesTable`.
 */
export default function SalesTableDialogs({
  openUpload,
  setOpenUpload,
  curSale,
  isFav,
  setOpenForm,
  confirmBulkDelete,
  setConfirmBulkDelete,
  selectedIds,
  performBulkDelete,
  confirmDeleteSale,
  setConfirmDeleteSale,
  performSaleDelete,
  bulkInfoMsg,
  setBulkInfoMsg,
}: {
  openUpload: boolean
  setOpenUpload: (v: boolean) => void
  curSale: any
  isFav: any
  setOpenForm: (v: boolean) => void
  confirmBulkDelete: boolean
  setConfirmBulkDelete: (v: boolean) => void
  selectedIds: number[]
  performBulkDelete: () => void
  confirmDeleteSale: any
  setConfirmDeleteSale: (v: any) => void
  performSaleDelete: () => void
  bulkInfoMsg: string | null
  setBulkInfoMsg: (v: string | null) => void
}) {
  const t = useT()
  const label = (code: string) => (ACTION_LABEL[code] ? t(ACTION_LABEL[code]) : code)
  return (
    <>
    <ModalPop open={openUpload} label={t('deals.table.import')} pos='middle' translated onClose={() => setOpenUpload(false)}>
      {openUpload && <UploadDealsData />}
    </ModalPop>

    <ActionsMenu id='saleActions'>
      {Object.entries(getActions()).map(([lbl, action]) => (
        <div key={lbl}>
          <div className='h-px bg-gray-200 w-full' />
          {action.func ? (
            <Btn
              variant='simple'
              size='simple'
              lbl={label(lbl)}
              onClick={() => {
                switch (lbl) {
                  case 'עריכה':
                    setOpenForm(true)
                    break

                  case 'מחיקה':
                    setConfirmDeleteSale(curSale)
                    break

                  default:
                    action.func(curSale, isFav, t)
                }
              }}
            />
          ) : (
            <Btn variant='simple' lbl={label(lbl)} />
          )}
        </div>
      ))}
    </ActionsMenu>

    <ConfirmPop
      open={confirmBulkDelete}
      destructive
      confirmLbl={t('deals.table.confirmDelete')}
      msg={t('deals.table.bulkConfirm', { count: String(selectedIds.length) })}
      translated
      onClose={() => setConfirmBulkDelete(false)}
      onConfirm={performBulkDelete}
    />

    <ConfirmPop
      open={!!confirmDeleteSale}
      destructive
      confirmLbl={t('deals.table.confirmDelete')}
      msg={t('deals.table.deleteOneConfirm', { name: String(confirmDeleteSale?.clientData) })}
      translated
      onClose={() => setConfirmDeleteSale(null)}
      onConfirm={performSaleDelete}
    />

    <ConfirmPop
      open={!!bulkInfoMsg}
      hideCancel
      onClose={() => setBulkInfoMsg(null)}
      onConfirm={() => setBulkInfoMsg(null)}
      msg={bulkInfoMsg ?? ''}
      translated
    />
    </>
  )
}
