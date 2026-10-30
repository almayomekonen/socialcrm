'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { api } from '@/lib/funcs'
import { getFormData2 } from '@/lib/form/funcs'
import type { BillInvoiceRow, BillInvoiceLineRow } from '@/db/billing/invoices'
import type { BillBillingProfileRow } from '@/db/billing/profiles'
import { computeInvoiceLegalTotals } from '@/lib/billing/totals'
import { issueReadiness } from '@/lib/billing/issueReadiness'
import { ISSUE_BLOCKER_KEYS } from './issue/issueBlockerMessages'
import { useRegionAttrs, useT } from '@/lib/i18n/I18nProvider'
import { effectiveTaxRatePercent } from '@/lib/billing/issuer/effectiveTaxRate'
import type { BusinessType } from '@/lib/billing/issuer/fields'
import {
  addLineAction,
  deleteDraftAction,
  removeLineAction,
  updateDraftMetaAction,
  updateLineAction,
} from '@/actions/billing/drafts'
import InvoiceLinesEditor, { type LineFormPayload } from './InvoiceLinesEditor'
import PaymentSection from './payment/PaymentSection'
import { DocStateChip } from './chips'
import { documentKindDisplay } from './labels'
import { formatInvoiceNumber } from './funcs'
import { useDraftPayment } from '@/hooks/useDraftPayment'
import DraftProfileStrip from './draft/DraftProfileStrip'
import DraftTotals from './draft/DraftTotals'
import DraftMetaForm from './draft/DraftMetaForm'
import DraftActionBar from './draft/DraftActionBar'

export default function InvoiceDraftEditor({
  invoice,
  lines,
  profile,
  canIssue,
  agencyBusinessType,
}: {
  invoice: BillInvoiceRow
  lines: BillInvoiceLineRow[]
  profile: BillBillingProfileRow | null
  canIssue: boolean
  agencyBusinessType: BusinessType | null
}) {
  const t = useT()
  const region = useRegionAttrs()
  const router = useRouter()
  const [savingMeta, setSavingMeta] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const payment = useDraftPayment(invoice, t('billing.editor.toast.paymentSaveFailed'))
  const { isCombinedDoc, paymentMethod, paymentAmount, paymentDate } = payment

  // Legal totals (W1): VAT computed per rate group from each line's stored
  // taxRatePercentSnapshot, then the issuer's business-type policy is
  // applied so the preview matches what issuance will commit (W6).
  // For an exempt agency every line's effective rate is 0 regardless of
  // what the stored snapshot says — a stale draft from when the agency
  // was authorized still previews correctly after the switch.
  const totals = computeInvoiceLegalTotals(
    lines.map((l) => ({
      lineSubtotal: Number(l.lineSubtotal),
      taxRatePercentSnapshot: effectiveTaxRatePercent({
        businessType: agencyBusinessType,
        baseRatePercent: Number(l.taxRatePercentSnapshot),
      }),
    })),
  )
  if (typeof window !== 'undefined') {
    console.log('[w6.trace] InvoiceDraftEditor', {
      invoiceId: invoice.id,
      agencyBusinessType,
      storedRatesPerLine: lines.map((l) => Number(l.taxRatePercentSnapshot)),
      totals,
    })
  }
  const hasLines = lines.length > 0
  const effectivePaymentAmount = paymentAmount ?? (totals.total > 0 ? totals.total : null)
  const { canIssueNow, blocker } = issueReadiness({
    canIssue,
    hasLines,
    total: totals.total,
    isCombinedDoc,
    paymentMethod,
    paymentAmount: effectivePaymentAmount,
    paymentDate,
  })
  const issueDisabledReason = blocker ? t(ISSUE_BLOCKER_KEYS[blocker]) : undefined

  async function onSaveMeta(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (savingMeta) return
    setSavingMeta(true)

    const data = getFormData2(e) as {
      dueAt: string
      internalNotes: string
      customerFooter: string
    }

    const result = await api(
      updateDraftMetaAction,
      [
        {
          invoiceId: invoice.id,
          leadId: invoice.leadId,
          dueAt: data.dueAt ? data.dueAt : null,
          internalNotes: data.internalNotes ?? '',
          customerFooter: data.customerFooter ?? '',
        },
      ],
      t('billing.editor.toast.metaSaved'),
      t('billing.editor.toast.metaSaveFailed'),
    )

    setSavingMeta(false)
    if (result && 'success' in result && result.success) {
      router.refresh()
    }
  }

  async function onDelete() {
    const result = await api(
      deleteDraftAction,
      [{ invoiceId: invoice.id, leadId: invoice.leadId }],
      t('billing.editor.toast.draftDeleted'),
      t('billing.editor.toast.draftDeleteFailed'),
    )
    setConfirmDelete(false)
    if (result && 'success' in result && result.success) {
      router.push(`/clients/${invoice.leadId}/billing` as any)
    }
  }

  return (
    <div className='grid gap-5 py-4 pb-28' {...region}>
      {/* ── Compact draft header ──────────────────────────────────── */}
      <header className='flex items-center justify-between gap-4 flex-wrap'>
        <div className='flex items-baseline gap-3'>
          <h2 className='text-2xl font-bold text-dark tracking-tight tabular-nums'>{formatInvoiceNumber(invoice, t.locale)}</h2>
          <DocStateChip state={invoice.docState} locale={t.locale} />
          <span className='text-xs font-medium px-2 py-0.5 rounded bg-softy text-gray-700'>
            {documentKindDisplay(invoice.kind, t.locale)}
          </span>
        </div>
        <p className='text-sm text-gray-400'>{t('billing.editor.draft.editable')}</p>
      </header>

      {/* ── Recipient strip ──────────────────────────────────────── */}
      <section className='border-b border-gray-200 pb-4'>
        <p className='text-xs font-semibold text-gray-500 uppercase tracking-[0.08em] mb-2'>{t('billing.editor.recipient.heading')}</p>
        {profile ? (
          <DraftProfileStrip profile={profile} currency={invoice.currency} />
        ) : (
          <p className='text-base text-red-700'>{t('billing.editor.draft.noProfile')}</p>
        )}
      </section>

      {/* ── Lines (inline editor) ────────────────────────────────── */}
      <InvoiceLinesEditor
        lines={lines}
        onAdd={async (payload: LineFormPayload) => {
          const result = await api(
            addLineAction,
            [{ leadId: invoice.leadId, line: { invoiceId: invoice.id, ...payload } }],
            t('billing.editor.toast.lineAdded'),
            t('billing.editor.toast.lineAddFailed'),
          )
          if (!result || !('success' in result) || !result.success) throw new Error('add_line_failed')
          router.refresh()
        }}
        onUpdate={async (lineId: number, payload: LineFormPayload) => {
          const result = await api(
            updateLineAction,
            [{ leadId: invoice.leadId, invoiceId: invoice.id, line: { lineId, ...payload } }],
            t('billing.editor.toast.lineUpdated'),
            t('billing.editor.toast.lineUpdateFailed'),
          )
          if (!result || !('success' in result) || !result.success) throw new Error('update_line_failed')
          router.refresh()
        }}
        onRemove={async (lineId: number) => {
          const result = await api(
            removeLineAction,
            [{ leadId: invoice.leadId, invoiceId: invoice.id, lineId }],
            t('billing.editor.toast.lineRemoved'),
            t('billing.editor.toast.lineRemoveFailed'),
          )
          if (!result || !('success' in result) || !result.success) throw new Error('remove_line_failed')
          router.refresh()
        }}
      />

      {/* ── Payment section (combined doc only) ──────────────────── */}
      {isCombinedDoc && (
        <PaymentSection
          method={paymentMethod}
          amount={effectivePaymentAmount}
          date={paymentDate}
          invoiceTotal={totals.total}
          disabled={payment.savingPayment}
          onMethodChange={payment.onMethodChange}
          onAmountChange={payment.onAmountChange}
          onDateChange={payment.onDateChange}
        />
      )}

      {/* ── Totals ──────────────────────────────────────────────── */}
      <DraftTotals subtotal={totals.subtotal} tax={totals.tax} total={totals.total} />

      {/* ── Advanced options (collapsed) ─────────────────────────── */}
      <DraftMetaForm invoice={invoice} saving={savingMeta} onSubmit={onSaveMeta} />

      {/* ── Pinned bottom action bar ─────────────────────────────── */}
      <DraftActionBar
        leadId={invoice.leadId}
        invoiceId={invoice.id}
        canIssueNow={canIssueNow}
        issueDisabledReason={issueDisabledReason}
        confirmDelete={confirmDelete}
        onAskDelete={() => setConfirmDelete(true)}
        onCancelDelete={() => setConfirmDelete(false)}
        onDelete={onDelete}
      />
    </div>
  )
}
