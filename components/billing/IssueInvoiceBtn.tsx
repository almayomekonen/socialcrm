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
      'החשבונית הונפקה',
      'הנפקת החשבונית נכשלה',
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
      toast('error', issueErrorMessage(reason))
    }
  }

  if (expired) {
    return <SubscriptionExpiredState mode='inline' source='invoice_issue' feature='חידוש המנוי מחזיר את הפקת החשבוניות' />
  }

  return (
    <>
      <Btn
        icon='paper-plane'
        lbl='הנפק חשבונית'
        onClick={() => setOpen(true)}
        disabled={disabled || busy}
        title={disabled ? disabledReason : undefined}
      />
      <ConfirmPop
        open={open}
        onClose={() => (busy ? null : setOpen(false))}
        onConfirm={onConfirm}
        confirmLbl='הנפק חשבונית'
        msg={'החשבונית תקבל מספר ותיסגר לעריכה.\nאם צריך לתקן משהו בהמשך, אפשר לבטל ולהנפיק חשבונית חדשה.'}
      />
    </>
  )
}
