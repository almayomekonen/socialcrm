'use client'

import { Btn } from '@/lib/btns/Btn'
import ConfirmPop from '@/lib/modals/ConfirmPop'
import IssueInvoiceBtn from '../IssueInvoiceBtn'
import { useT } from '@/lib/i18n/I18nProvider'

/**
 * The draft editor's pinned bottom bar: delete the draft (with its
 * confirmation) and issue it. The parent owns the confirmation state and
 * performs the delete.
 */
export default function DraftActionBar({
  leadId,
  invoiceId,
  canIssueNow,
  issueDisabledReason,
  confirmDelete,
  onAskDelete,
  onCancelDelete,
  onDelete,
}: {
  leadId: number
  invoiceId: number
  canIssueNow: boolean
  issueDisabledReason?: string
  confirmDelete: boolean
  onAskDelete: () => void
  onCancelDelete: () => void
  onDelete: () => Promise<void>
}) {
  const t = useT()
  return (
    <>
      <div className='fixed bottom-0 inset-x-0 z-40 bg-white/95 backdrop-blur border-t border-gray-200 shadow-sm'>
        <div className='ps-20 pe-8 py-3 flex items-center justify-between gap-3'>
          <Btn variant='outline' icon='trash' lbl={t('billing.editor.bar.deleteDraft')} onClick={onAskDelete} />
          <div className='flex items-center gap-2'>
            <IssueInvoiceBtn
              leadId={leadId}
              invoiceId={invoiceId}
              disabled={!canIssueNow}
              disabledReason={issueDisabledReason}
            />
          </div>
        </div>
      </div>

      <ConfirmPop
        open={confirmDelete}
        destructive
        confirmLbl={t('billing.editor.bar.deleteDraft')}
        msg={t('billing.editor.draft.deleteMsg')}
        translated
        onClose={onCancelDelete}
        onConfirm={onDelete}
      />
    </>
  )
}
