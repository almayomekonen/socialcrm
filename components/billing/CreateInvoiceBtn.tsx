'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Btn } from '@/lib/btns/Btn'
import type { DocumentKindEntry } from '@/lib/billing/documentKinds'
import DocumentKindPicker from './document-picker/DocumentKindPicker'
import { useT } from '@/lib/i18n/I18nProvider'

/**
 * Opens the document-kind picker. The picker routes to the appropriate
 * editor based on the chosen kind. Plain "invoice" (default) goes to
 * /billing/new; "invoice_receipt" adds ?kind=invoice_receipt. Disabled
 * kinds in the picker are not clickable.
 */
export default function CreateInvoiceBtn({ leadId }: { leadId: number }) {
  const t = useT()
  const router = useRouter()
  const [open, setOpen] = useState(false)

  function onPick(entry: DocumentKindEntry): void {
    setOpen(false)
    if (!entry.routeKind || entry.routeKind === 'invoice') {
      router.push(`/clients/${leadId}/billing/new` as any)
      return
    }
    router.push(`/clients/${leadId}/billing/new?kind=${entry.routeKind}` as any)
  }

  return (
    <>
      <Btn icon='file-plus' lbl={t('leadTabs.billing.create')} onClick={() => setOpen(true)} />
      <DocumentKindPicker open={open} onClose={() => setOpen(false)} onPick={onPick} />
    </>
  )
}
