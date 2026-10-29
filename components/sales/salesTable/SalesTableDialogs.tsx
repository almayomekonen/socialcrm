'use client'

import { Btn } from '@/lib/btns/Btn'
import UploadDealsData from '@/components/sales/UploadDealsData'
import ModalPop from '@/lib/modals/ModalPop'
import ConfirmPop from '@/lib/modals/ConfirmPop'
import { ActionsMenu, getActions } from './funcs'

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
  return (
    <>
    <ModalPop open={openUpload} label='ייבוא עסקאות' pos='middle' onClose={() => setOpenUpload(false)}>
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
              lbl={lbl}
              onClick={() => {
                switch (lbl) {
                  case 'עריכה':
                    setOpenForm(true)
                    break

                  case 'מחיקה':
                    setConfirmDeleteSale(curSale)
                    break

                  default:
                    action.func(curSale, isFav)
                }
              }}
            />
          ) : (
            <Btn variant='simple' lbl={lbl} />
          )}
        </div>
      ))}
    </ActionsMenu>

    <ConfirmPop
      open={confirmBulkDelete}
      destructive
      confirmLbl='מחיקה'
      msg={`למחוק ${selectedIds.length} עסקאות?`}
      onClose={() => setConfirmBulkDelete(false)}
      onConfirm={performBulkDelete}
    />

    <ConfirmPop
      open={!!confirmDeleteSale}
      destructive
      confirmLbl='מחיקה'
      msg={`בטוח למחוק עסקה של ${confirmDeleteSale?.clientData} ?`}
      onClose={() => setConfirmDeleteSale(null)}
      onConfirm={performSaleDelete}
    />

    <ConfirmPop
      open={!!bulkInfoMsg}
      hideCancel
      onClose={() => setBulkInfoMsg(null)}
      onConfirm={() => setBulkInfoMsg(null)}
      msg={bulkInfoMsg ?? ''}
    />
    </>
  )
}
