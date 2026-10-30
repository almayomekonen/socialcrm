'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Btn } from '@/lib/btns/Btn'
import { api } from '@/lib/funcs'
import { duplicateInvoiceAction } from '@/actions/billing/duplicate'
import { useT } from '@/lib/i18n/I18nProvider'

/**
 * Clones an issued invoice into a fresh draft and navigates into the new
 * draft's editor. The semantic is "start a new invoice based on this one",
 * not "regenerate the PDF" — issued invoices are immutable, so any change
 * must happen on a new draft.
 *
 * Two visual variants:
 *   - 'hero'    : white solid button for the dark hero band.
 *   - 'default' : standard solid button.
 */
export default function DuplicateInvoiceBtn({
  invoiceId,
  leadId,
  variant = 'default',
}: {
  invoiceId: number
  leadId: number
  variant?: 'hero' | 'default'
}) {
  const t = useT()
  const router = useRouter()
  const [busy, setBusy] = useState(false)

  async function onClick() {
    if (busy) return
    setBusy(true)
    const result = await api(
      duplicateInvoiceAction,
      [{ invoiceId, leadId }],
      t('billing.issued.toast.duplicated'),
      t('billing.issued.toast.duplicateFailed'),
      { silentSuccess: true },
    )
    setBusy(false)
    if (result && 'success' in result && result.success) {
      router.push(`/clients/${leadId}/billing/${result.invoiceId}` as any)
    }
  }

  if (variant === 'hero') {
    return (
      <button
        type='button'
        onClick={onClick}
        disabled={busy}
        className='inline-flex items-center gap-2 h-10 px-4 rounded-md border border-white/20 bg-white/5 hover:bg-white/10 text-white font-semibold transition-colors disabled:opacity-60'
      >
        <span>{t('billing.issued.duplicateHero')}</span>
      </button>
    )
  }

  return <Btn variant='outline' icon='copy' lbl={t('billing.issued.duplicate')} onClick={onClick} disabled={busy} />
}
