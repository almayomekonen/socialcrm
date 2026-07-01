'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { api } from '@/lib/funcs'
import { toast } from '@/lib/toast'
import ConfirmPop from '@/lib/modals/ConfirmPop'
import ModalPop from '@/lib/modals/ModalPop'
import ClientFormPop from '@/components/clients/ClientFormPop'
import type { BillBillingProfileRow } from '@/db/billing/profiles'
import type { DocumentKind } from '@/db/billing/invoices'
import type { PaymentMethod } from '@/lib/billing/payment/methods'
import { computeLineTotals, computeInvoiceLegalTotals } from '@/lib/billing/totals'
import { saveTransientDraftAction, type TransientLineInput } from '@/actions/billing/drafts'
import { saveAndIssueTransientAction } from '@/actions/billing/issue'
import { issueErrorMessage } from '@/lib/billing/issueErrorMessages'
import PaymentSection from './payment/PaymentSection'
import { markInvoiceJustIssued } from '@/lib/billing/justIssuedFlag'
import IssuerIdentityModal from '@/components/billing/issuer/IssuerIdentityModal'
import IssuerSetupRequiredModal from '@/components/billing/issuer/IssuerSetupRequiredModal'
import { useTransientDraftAutosave } from '@/hooks/useTransientDraftAutosave'
import { useIssueFlow } from '@/hooks/useIssueFlow'
import InvoiceLinesEditor, { type EditableLine, type LineFormPayload } from './InvoiceLinesEditor'
import type { RecentLead } from './lead-picker/types'
import InvoicePageHeader from './issue/InvoicePageHeader'
import RecipientCard from './issue/RecipientCard'
import InvoiceMetadataDetails from './issue/InvoiceMetadataDetails'
import InvoiceTotalsSummary from './issue/InvoiceTotalsSummary'
import InvoiceActionBar from './issue/InvoiceActionBar'
import { cardCls, sectionHeaderCls, eyebrowCls } from './issue/styles'

type TransientLine = EditableLine

type TransientMeta = {
  dueAt: string | null
  customerFooter: string
  internalNotes: string
}

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
  const router = useRouter()

  // ── Local state ─────────────────────────────────────────────────
  const [lines, setLines] = useState<TransientLine[]>([])
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
  const paymentComplete =
    !isCombinedDoc ||
    (paymentMethod !== '' &&
      effectivePaymentAmount != null &&
      effectivePaymentAmount > 0 &&
      effectivePaymentAmount <= totals.total + 0.0001 &&
      paymentDate.length > 0)
  const canSaveDraft = hasLines
  const saveDisabledReason = !hasLines ? 'יש להוסיף לפחות פריט אחד לפני שמירה' : undefined
  const canIssueNow = canIssue && hasLines && totals.total > 0 && paymentComplete
  const issueDisabledReason = !canIssue
    ? 'אין הרשאה להנפיק'
    : !hasLines
      ? 'יש להוסיף לפחות פריט אחד'
      : totals.total <= 0
        ? 'סכום החשבונית חייב להיות גדול מאפס'
        : !paymentComplete
          ? 'יש למלא את פרטי התשלום שהתקבל'
          : undefined

  // ── Line management ─────────────────────────────────────────────
  function applyComputed(line: Omit<TransientLine, 'lineSubtotal' | 'lineTaxAmount' | 'lineTotal'>): TransientLine {
    const computed = computeLineTotals(line.quantity, line.unitPrice, line.discount, defaultTaxRatePercent)
    return { ...line, lineSubtotal: computed.subtotal, lineTaxAmount: computed.tax, lineTotal: computed.total }
  }

  function onAddLine(payload: LineFormPayload): void {
    setLines((prev) => [
      ...prev,
      applyComputed({
        id: -Date.now() - prev.length,
        title: payload.title,
        description: payload.description,
        quantity: payload.quantity,
        unitPrice: payload.unitPrice,
        discount: payload.discount,
      }),
    ])
  }

  function onUpdateLine(lineId: number, payload: LineFormPayload): void {
    setLines((prev) =>
      prev.map((line) => (line.id === lineId ? applyComputed({ id: line.id, ...payload }) : line)),
    )
  }

  function onRemoveLine(lineId: number): void {
    setLines((prev) => prev.filter((line) => line.id !== lineId))
  }

  // ── Server-action wiring ────────────────────────────────────────
  function buildPayload() {
    return {
      leadId,
      meta: { dueAt: dueAt || null, customerFooter, internalNotes },
      lines: lines.map((line) => ({
        title: line.title,
        description: line.description,
        quantity: line.quantity,
        unitPrice: line.unitPrice,
        discount: line.discount,
      })) as TransientLineInput[],
      kind,
      payment: isCombinedDoc
        ? {
            method: (paymentMethod || null) as PaymentMethod | null,
            amount: effectivePaymentAmount,
            date: paymentDate || null,
          }
        : undefined,
    }
  }

  async function onSaveDraft() {
    if (busy) return
    setBusy(true)
    const result = await api(saveTransientDraftAction, [buildPayload()], 'הטיוטה נשמרה', 'שמירת הטיוטה נכשלה')
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
      'החשבונית הונפקה',
      'הנפקת החשבונית נכשלה',
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
    toast('error', issueErrorMessage(reason))
  }

  // ── Render ──────────────────────────────────────────────────────
  return (
    <div className='grid gap-6 pt-6 pb-28'>
      <InvoicePageHeader leadName={leadName} kind={kind} />

      <RecipientCard
        leadId={leadId}
        leadName={leadName}
        profile={profile}
        recentLeads={recentLeads}
        onPickLead={(pickedId) => router.push(`/clients/${pickedId}/billing/new` as any)}
        onCreateNewLead={() => setNewLeadOpen(true)}
      />

      <section className={cardCls}>
        <div className={sectionHeaderCls + ' flex items-baseline justify-between gap-3'}>
          <h2 className={eyebrowCls}>פריטים</h2>
          <p className='text-sm text-gray-400'>טאב למעבר בין שדות · Enter לשמירה</p>
        </div>
        <InvoiceLinesEditor lines={lines} onAdd={onAddLine} onUpdate={onUpdateLine} onRemove={onRemoveLine} />
        {!hasLines && (
          <p className='px-6 pb-5 -mt-1 text-sm text-gray-500'>
            התחילו בהקלדת שם פריט בשורת ה"+ פריט חדש" למעלה
          </p>
        )}
      </section>

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

      <ConfirmPop
        open={issueFlow.stage.kind === 'confirm'}
        onClose={() => (busy ? null : issueFlow.close())}
        onConfirm={onSaveAndIssue}
        confirmLbl='הנפק חשבונית'
        msg={'החשבונית תקבל מספר ותיסגר לעריכה.\nאם צריך לתקן משהו בהמשך, אפשר לבטל ולהנפיק חשבונית חדשה.'}
      />

      <ModalPop open={newLeadOpen} pos='middle' onClose={() => setNewLeadOpen(false)} label='ליד חדש'>
        <ClientFormPop
          onCreated={(newLeadId) => {
            setNewLeadOpen(false)
            router.push(`/clients/${newLeadId}/billing/new` as any)
          }}
          onClose={() => setNewLeadOpen(false)}
        />
      </ModalPop>

      <IssuerIdentityModal
        open={issueFlow.stage.kind === 'identity'}
        initialValues={issueFlow.stage.kind === 'identity' ? issueFlow.stage.initialValues : {}}
        onSavedAndContinue={issueFlow.onIdentitySaved}
        onCancel={issueFlow.close}
      />
      <IssuerSetupRequiredModal
        open={issueFlow.stage.kind === 'setup_required'}
        onClose={issueFlow.close}
      />
    </div>
  )
}
