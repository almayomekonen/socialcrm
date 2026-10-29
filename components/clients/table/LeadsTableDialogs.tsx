'use client'

import ModalPop from '@/lib/modals/ModalPop'
import ConfirmPop from '@/lib/modals/ConfirmPop'
import SaleForm from '@/components/sales/saleForm/SaleForm'
import UploadClientData from '@/components/settings/UploadClientData'
import ClientFormPop from '../ClientFormPop'
import TransferClientForm from '../TransferClientForm'
import BulkAssignLeadsForm from '../BulkAssignLeadsForm'
import type { LeadDialogName } from './useLeadDialogs'

/** The table's modal forms: add/edit, bulk assign, transfer, import, deal. */
export function LeadsTableDialogs({
  open,
  close,
  curClient,
  formProps,
  selectedCount,
  assignOpen,
  closeAssign,
  performBulkAssign,
}: {
  open: Record<LeadDialogName, boolean>
  close: (dialog: LeadDialogName) => void
  curClient: any
  formProps: any
  selectedCount: number
  assignOpen: boolean
  closeAssign: () => void
  performBulkAssign: (userId: number) => void
}) {
  return (
    <>
      <ModalPop open={open.form} label='פרטי ליד' pos='middle' onClose={() => close('form')}>
        <ClientFormPop client={curClient} onClose={() => close('form')} />
      </ModalPop>

      <ModalPop open={assignOpen} label='שיוך לידים לנציג' pos='middle' onClose={closeAssign}>
        <BulkAssignLeadsForm count={selectedCount} onAssign={performBulkAssign} onCancel={closeAssign} />
      </ModalPop>

      <ModalPop open={open.transfer} label='שיוך ליד לנציג' pos='middle' onClose={() => close('transfer')}>
        <TransferClientForm client={curClient} />
      </ModalPop>

      <ModalPop open={open.upload} label='העלאת לידים' pos='middle' onClose={() => close('upload')}>
        <UploadClientData />
      </ModalPop>

      {formProps && (
        <ModalPop open={open.sale} label='טופס עסקה' onClose={() => close('sale')}>
          <SaleForm
            props={formProps}
            curSale={curClient ? ({ clientId: curClient.id, clientData: curClient.name } as any) : undefined}
            onClose={() => close('sale')}
          />
        </ModalPop>
      )}
    </>
  )
}

/** Delete confirmations and the messages that follow them. */
export function LeadsTableConfirms({
  leads,
  selectedCount,
  bulkConfirmOpen,
  closeBulkConfirm,
  performBulkDelete,
  bulkInfoMsg,
  closeBulkInfo,
  confirmDeleteLead,
  cancelDelete,
  performDelete,
  deleteErrMsg,
  clearDeleteErr,
}: {
  leads: boolean
  selectedCount: number
  bulkConfirmOpen: boolean
  closeBulkConfirm: () => void
  performBulkDelete: () => void | Promise<void>
  bulkInfoMsg: string | null
  closeBulkInfo: () => void
  confirmDeleteLead: any
  cancelDelete: () => void
  performDelete: () => Promise<void>
  deleteErrMsg: string | null
  clearDeleteErr: () => void
}) {
  return (
    <>
      <ConfirmPop
        open={bulkConfirmOpen}
        destructive
        confirmLbl='מחיקה'
        msg={`למחוק ${selectedCount} ${leads ? 'לידים' : 'לקוחות'}?`}
        onClose={closeBulkConfirm}
        onConfirm={performBulkDelete}
      />

      <ConfirmPop
        open={!!confirmDeleteLead}
        destructive
        confirmLbl='מחיקה'
        msg={`האם למחוק ליד ${confirmDeleteLead?.name}?`}
        onClose={cancelDelete}
        onConfirm={performDelete}
      />

      <ConfirmPop
        open={!!deleteErrMsg}
        hideCancel
        onClose={clearDeleteErr}
        onConfirm={clearDeleteErr}
        msg={deleteErrMsg ?? ''}
      />

      <ConfirmPop
        open={!!bulkInfoMsg}
        hideCancel
        onClose={closeBulkInfo}
        onConfirm={closeBulkInfo}
        msg={bulkInfoMsg ?? ''}
      />
    </>
  )
}
