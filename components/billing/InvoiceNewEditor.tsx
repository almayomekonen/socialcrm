'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { api } from '@/lib/funcs'
import { toast } from '@/lib/toast'
import type { BillBillingProfileRow } from '@/db/billing/profiles'
import type { DocumentKind } from '@/db/billing/invoices'
import type { PaymentMethod } from '@/lib/billing/payment/methods'
import { computeInvoiceLegalTotals } from '@/lib/billing/totals'
import { issueReadiness } from '@/lib/billing/issueReadiness'
import { ISSUE_BLOCKER_KEYS } from './issue/issueBlockerMessages'
import { useRegionAttrs, useT } from '@/lib/i18n/I18nProvider'
import { saveTransientDraftAction } from '@/actions/billing/drafts'
import { buildTransientPayload } from '@/lib/billing/transientPayload'
import { saveAndIssueTransientAction } from '@/actions/billing/issue'
import { issueErrorMessage } from '@/lib/billing/issueErrorMessages'
import PaymentSection from './payment/PaymentSection'
import { markInvoiceJustIssued } from '@/lib/billing/justIssuedFlag'
import { useTransientDraftAutosave } from '@/hooks/useTransientDraftAutosave'
import { useIssueFlow } from '@/hooks/useIssueFlow'
import { useTransientLines } from '@/hooks/useTransientLines'
import type { RecentLead } from './lead-picker/types'
import InvoicePageHeader from './issue/InvoicePageHeader'
import RecipientCard from './issue/RecipientCard'
import InvoiceMetadataDetails from './issue/InvoiceMetadataDetails'
import InvoiceTotalsSummary from './issue/InvoiceTotalsSummary'
import InvoiceActionBar from './issue/InvoiceActionBar'
import NewInvoiceLinesCard from './issue/NewInvoiceLinesCard'
import NewInvoiceDialogs from './issue/NewInvoiceDialogs'

export default function InvoiceNewEditor({
  userId,
  leadId,
  leadName,
  profile,
  defaultTaxRatePercent,
  canIssue,
  recentLeads = [],
  initialKind = 'invoice',
}: {
  userId: number
  leadId: number
  leadName: string
  profile: BillBillingProfileRow | null
  defaultTaxRatePercent: number
  canIssue: boolean
  recentLeads?: RecentLead[]
  initialKind?: DocumentKind
}) {
  const t = useT()
  const region = useRegionAttrs()
  const router = useRouter()

  // ── Local state ─────────────────────────────────────────────────
  const { lines, setLines, onAddLine, onUpdateLine, onRemoveLine } = useTransientLines(defaultTaxRatePercent)
  const [dueAt, setDueAt] = useState('')
  const [customerFooter, setCustomerFooter] = useState('')
  const [internalNotes, setInternalNotes] = useState('')
  const [kind, setKind] = useState<DocumentKind>(initialKind)
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod | ''>('')
  const [paymentAmount, setPaymentAmount] = useState<number | null>(null)
  const [paymentDate, setPaymentDate] = useState<string>(() => new Date().toISOString().slice(0, 10))
  const [busy, setBusy] = useState(false)
  const [newLeadOpen, setNewLeadOpen] = useState(false)

  // ── Hooks ───────────────────────────────────────────────────────
  const { clearStoredDraft } = useTransientDraftAutosave({
    userId,
    leadId,
    lines,
    dueAt,
    customerFooter,
    internalNotes,
    kind,
    paymentMethod,
    paymentAmount,
    paymentDate,
    setLines,
    setDueAt,
    setCustomerFooter,
    setInternalNotes,
    setKind,
    setPaymentMethod,
    setPaymentAmount,
    setPaymentDate,
  })
  const issueFlow = useIssueFlow()

  // ── Derived state ───────────────────────────────────────────────
  // Legal totals (W1): VAT is computed per rate group, not summed from
  // pre-rounded per-line tax — so the editor previews the exact total the
  // customer will see on the issued PDF. All lines in this draft share
  // the agency's default rate.
  const totals = computeInvoiceLegalTotals(
    lines.map((l) => ({ lineSubtotal: l.lineSubtotal, taxRatePercentSnapshot: defaultTaxRatePercent })),
  )
  if (typeof window !== 'undefined') {
    console.log('[w6.trace] InvoiceNewEditor', {
      defaultTaxRatePercent,
      lineCount: lines.length,
      totals,
    })
  }
  const hasLines = lines.length > 0
  const isCombinedDoc = kind === 'invoice_receipt'
  // Default payment amount to the running total whenever it's still null.
  // Keeps the field editable but pre-filled the moment lines produce a total.
  const effectivePaymentAmount = paymentAmount ?? (totals.total > 0 ? totals.total : null)
  const canSaveDraft = hasLines
  const saveDisabledReason = !hasLines ? t('billing.editor.blocker.noLinesToSave') : undefined
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

  // ── Server-action wiring ────────────────────────────────────────
  function buildPayload() {
    return buildTransientPayload({
      leadId,
      dueAt,
      customerFooter,
      internalNotes,
      lines,
      kind,
      isCombinedDoc,
      paymentMethod,
      paymentAmount: effectivePaymentAmount,
      paymentDate,
    })
  }

  async function onSaveDraft() {
    if (busy) return
    setBusy(true)
    const result = await api(saveTransientDraftAction, [buildPayload()], t('billing.editor.toast.draftSaved'), t('billing.editor.toast.draftSaveFailed'))
    setBusy(false)
    if (result && 'success' in result && result.success) {
      clearStoredDraft()
      router.push(`/clients/${leadId}/billing/${result.invoiceId}` as any)
    }
  }

  async function onSaveAndIssue() {
    if (busy) return
    setBusy(true)
    const result = await api(
      saveAndIssueTransientAction,
      [buildPayload()],
      t('billing.editor.toast.issued'),
      t('billing.editor.toast.issueFailed'),
      { silentSuccess: true },
    )
    setBusy(false)
    issueFlow.close()
    if (!result) return
    if ('success' in result && result.success) {
      clearStoredDraft()
      // Mark the freshly-issued invoice so the issued view's send banner
      // appears once. Replaces the prior `?send=1` URL coupling.
      markInvoiceJustIssued(result.invoiceId)
      router.push(`/clients/${leadId}/billing/${result.invoiceId}` as any)
      return
    }
    // Issuance failed. Surface the reason as a toast and stay on the
    // editor so the user can fix the offending field. We intentionally do
    // NOT navigate away — the prior "redirect to draft editor with no
    // message" behavior hid the failure entirely.
    const reason = 'reason' in result ? (result as { reason?: string }).reason : undefined
    toast('error', issueErrorMessage(reason, t.locale))
  }

  // ── Render ──────────────────────────────────────────────────────
  return (
    <div className='grid gap-6 pt-6 pb-28' {...region}>
      <InvoicePageHeader leadName={leadName} kind={kind} />

      <RecipientCard
        leadId={leadId}
        leadName={leadName}
        profile={profile}
        recentLeads={recentLeads}
        onPickLead={(pickedId) => router.push(`/clients/${pickedId}/billing/new` as any)}
        onCreateNewLead={() => setNewLeadOpen(true)}
      />

      <NewInvoiceLinesCard lines={lines} onAdd={onAddLine} onUpdate={onUpdateLine} onRemove={onRemoveLine} />

      {isCombinedDoc && (
        <PaymentSection
          method={paymentMethod}
          amount={effectivePaymentAmount}
          date={paymentDate}
          invoiceTotal={totals.total}
          onMethodChange={setPaymentMethod}
          onAmountChange={setPaymentAmount}
          onDateChange={setPaymentDate}
        />
      )}

      <div className='grid md:grid-cols-3 gap-6'>
        <InvoiceMetadataDetails
          dueAt={dueAt}
          customerFooter={customerFooter}
          internalNotes={internalNotes}
          onDueAtChange={setDueAt}
          onCustomerFooterChange={setCustomerFooter}
          onInternalNotesChange={setInternalNotes}
        />
        <InvoiceTotalsSummary subtotal={totals.subtotal} tax={totals.tax} total={totals.total} />
      </div>

      <InvoiceActionBar
        busy={busy}
        hasLines={hasLines}
        canSaveDraft={canSaveDraft}
        canIssueNow={canIssueNow}
        saveDisabledReason={saveDisabledReason}
        issueDisabledReason={issueDisabledReason}
        onCancel={() => router.push(`/clients/${leadId}/billing` as any)}
        onSaveDraft={onSaveDraft}
        onIssueClick={issueFlow.startIssueFlow}
      />

      <NewInvoiceDialogs
        stage={issueFlow.stage}
        busy={busy}
        newLeadOpen={newLeadOpen}
        onCloseIssueFlow={issueFlow.close}
        onConfirmIssue={onSaveAndIssue}
        onIdentitySaved={issueFlow.onIdentitySaved}
        onCloseNewLead={() => setNewLeadOpen(false)}
        onLeadCreated={(newLeadId) => {
          setNewLeadOpen(false)
          router.push(`/clients/${newLeadId}/billing/new` as any)
        }}
      />
    </div>
  )
}
