'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Btn } from '@/lib/btns/Btn'
import { api } from '@/lib/funcs'
import { rerenderInvoicePdfAction } from '@/actions/billing/render'
import { useT } from '@/lib/i18n/I18nProvider'

/**
 * Explicit "render again" trigger. Used both for first-time renders that
 * landed in 'failed' and for after-the-fact regeneration. The post-issue
 * automatic render flow is the primary path; this button is the manual
 * override.
 */
export default function RerenderPdfBtn({
  invoiceId,
  leadId,
  lbl,
}: {
  invoiceId: number
  leadId: number
  lbl?: string
}) {
  const t = useT()
  const router = useRouter()
  const [busy, setBusy] = useState(false)

  async function onClick() {
    if (busy) return
    setBusy(true)
    const result = await api(
      rerenderInvoicePdfAction,
      [{ invoiceId, leadId }],
      t('billing.issued.toast.rerenderSent'),
      t('billing.issued.toast.rerenderFailed'),
      { silentSuccess: false },
    )
    setBusy(false)
    if (result && 'success' in result && result.success) {
      router.refresh()
    }
  }

  return <Btn variant='outline' icon='rotate' lbl={lbl ?? t('billing.issued.rerender')} onClick={onClick} disabled={busy} />
}
