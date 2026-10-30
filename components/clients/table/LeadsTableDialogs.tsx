'use client'

import ModalPop from '@/lib/modals/ModalPop'
import ConfirmPop from '@/lib/modals/ConfirmPop'
import SaleForm from '@/components/sales/saleForm/SaleForm'
import UploadClientData from '@/components/settings/UploadClientData'
import ClientFormPop from '../ClientFormPop'
import TransferClientForm from '../TransferClientForm'
import BulkAssignLeadsForm from '../BulkAssignLeadsForm'
import type { LeadDialogName } from './useLeadDialogs'
import { useT } from '@/lib/i18n/I18nProvider'

/**
 * The table's modal forms: add/edit, bulk assign, transfer, import, deal.
 * Every dialog here except the deal form (Phase E, still Hebrew) is translated
 * and declares the interface language.
 */
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
  const t = useT()
  return (
    <>
      <ModalPop open={open.form} label={t('leads.dialog.leadDetails')} pos='middle' onClose={() => close('form')} translated>
        <ClientFormPop client={curClient} onClose={() => close('form')} />
      </ModalPop>

      <ModalPop open={assignOpen} label={t('leads.dialog.bulkAssign')} pos='middle' onClose={closeAssign} translated>
        <BulkAssignLeadsForm count={selectedCount} onAssign={performBulkAssign} onCancel={closeAssign} />
      </ModalPop>

      <ModalPop open={open.transfer} label={t('leads.dialog.assignOne')} pos='middle' onClose={() => close('transfer')} translated>
        <TransferClientForm client={curClient} />
      </ModalPop>

      <ModalPop open={open.upload} label={t('leads.dialog.upload')} pos='middle' onClose={() => close('upload')} translated>
        <UploadClientData />
      </ModalPop>

      {formProps && (
        <ModalPop open={open.sale} label={t('leads.dialog.deal')} onClose={() => close('sale')} translated>
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
  const t = useT()
  const del = t('leads.action.delete')
  return (
    <>
      <ConfirmPop
        open={bulkConfirmOpen}
        destructive
        confirmLbl={del}
        msg={t(leads ? 'leads.dialog.bulkDeleteLeads' : 'leads.dialog.bulkDeleteCustomers', { count: String(selectedCount) })}
        translated
        onClose={closeBulkConfirm}
        onConfirm={performBulkDelete}
      />

      <ConfirmPop
        open={!!confirmDeleteLead}
        destructive
        confirmLbl={del}
        msg={t('leads.dialog.deleteLead', { name: `${confirmDeleteLead?.name}` })}
        translated
        onClose={cancelDelete}
        onConfirm={performDelete}
      />

      <ConfirmPop
        open={!!deleteErrMsg}
        hideCancel
        onClose={clearDeleteErr}
        onConfirm={clearDeleteErr}
        msg={deleteErrMsg ?? ''}
        translated
      />

      <ConfirmPop
        open={!!bulkInfoMsg}
        hideCancel
        onClose={closeBulkInfo}
        onConfirm={closeBulkInfo}
        msg={bulkInfoMsg ?? ''}
        translated
      />
    </>
  )
}
