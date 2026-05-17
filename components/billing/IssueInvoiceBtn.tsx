'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Btn } from '@/lib/btns/Btn'
import ConfirmPop from '@/lib/modals/ConfirmPop'
import { api } from '@/lib/funcs'
import { toast } from '@/lib/toast'
import { issueInvoiceAction } from '@/actions/billing/issue'
import { issueErrorMessage } from '@/lib/billing/issueErrorMessages'

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
