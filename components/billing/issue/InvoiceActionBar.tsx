'use client'

import { Btn } from '@/lib/btns/Btn'
import { useT } from '@/lib/i18n/I18nProvider'

export default function InvoiceActionBar({
  busy,
  hasLines,
  canSaveDraft,
  canIssueNow,
  saveDisabledReason,
  issueDisabledReason,
  onCancel,
  onSaveDraft,
  onIssueClick,
}: {
  busy: boolean
  hasLines: boolean
  canSaveDraft: boolean
  canIssueNow: boolean
  saveDisabledReason?: string
  issueDisabledReason?: string
  onCancel: () => void
  onSaveDraft: () => void
  onIssueClick: () => void
}) {
  const t = useT()
  return (
    <div className='fixed bottom-0 inset-x-0 z-40 bg-white border-t border-gray-200 shadow-[0_-1px_0_0_rgba(0,0,0,0.02),0_-6px_18px_-10px_rgba(15,23,42,0.08)]'>
      <div className='ps-20 pe-8 py-4 flex items-center justify-between gap-3'>
        <Btn variant='outline' lbl={t('common.dialog.cancel')} onClick={onCancel} disabled={busy} />
        <div className='flex items-center gap-2'>
          {!hasLines && (
            <p className='text-sm text-gray-500 me-2 hidden sm:block'>{t('billing.editor.bar.addLineHint')}</p>
          )}
          <Btn
            variant='outline'
            icon='floppy-disk'
            lbl={t('billing.editor.bar.saveDraft')}
            onClick={onSaveDraft}
            disabled={busy || !canSaveDraft}
            title={saveDisabledReason}
          />
          <Btn
            icon='paper-plane'
            lbl={t('billing.editor.bar.issue')}
            onClick={onIssueClick}
            disabled={busy || !canIssueNow}
            title={issueDisabledReason}
          />
        </div>
      </div>
    </div>
  )
}
