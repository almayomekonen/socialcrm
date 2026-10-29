'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Btn } from '@/lib/btns/Btn'
import ConfirmPop from '@/lib/modals/ConfirmPop'
import { api } from '@/lib/funcs'
import { toast } from '@/lib/toast'
import { issueInvoiceAction } from '@/actions/billing/issue'
import { issueErrorMessage } from '@/lib/billing/issueErrorMessages'
import { useAccessDenied } from '@/lib/entitlement/EntitlementContext'
import SubscriptionExpiredState from '@/components/entitlement/SubscriptionExpiredState'
import { useT } from '@/lib/i18n/I18nProvider'

export default function IssueInvoiceBtn({
  leadId,
  invoiceId,
  disabled,
  disabledReason,
}: {
  leadId: number
  invoiceId: number
  disabled?: boolean
  disabledReason?: string
}) {
  const t = useT()
  const router = useRouter()
  /**
   * PRE-GATE. `issueInvoiceAction` is requireProductAccess-guarded and the
   * click runs through `api()`, which catches everything and shows the generic
   * issue-failure toast — so a lapsed subscription read as a billing error.
   * Issuing is withheld; the draft itself stays fully readable.
   */
  const expired = useAccessDenied()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)

  async function onConfirm() {
    if (busy) return
    setBusy(true)
    const result = await api(
      issueInvoiceAction,
      [{ invoiceId, leadId }],
      t('billing.editor.toast.issued'),
      t('billing.editor.toast.issueFailed'),
      { silentSuccess: true },
    )
    setBusy(false)
    setOpen(false)
    if (result && 'success' in result && result.success) {
      router.refresh()
      return
    }
    
    if (result && 'error' in result) {
      const reason = (result as { reason?: string }).reason
      toast('error', issueErrorMessage(reason, t.locale))
    }
  }

  if (expired) {
    return <SubscriptionExpiredState mode='inline' source='invoice_issue' feature={t('billing.editor.issueExpired')} translated />
  }

  return (
    <>
      <Btn
        icon='paper-plane'
        lbl={t('billing.editor.bar.issue')}
        onClick={() => setOpen(true)}
        disabled={disabled || busy}
        title={disabled ? disabledReason : undefined}
      />
      <ConfirmPop
        open={open}
        onClose={() => (busy ? null : setOpen(false))}
        onConfirm={onConfirm}
        confirmLbl={t('billing.editor.bar.issue')}
        msg={t('billing.editor.issueConfirm')}
        translated
      />
    </>
  )
}
