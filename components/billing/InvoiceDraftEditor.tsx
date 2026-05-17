'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Btn } from '@/lib/btns/Btn'
import { Input } from '@/lib/form'
import { api, formatCurrency } from '@/lib/funcs'
import ConfirmPop from '@/lib/modals/ConfirmPop'
import { getFormData2 } from '@/lib/form/funcs'
import type { BillInvoiceRow, BillInvoiceLineRow } from '@/db/billing/invoices'
import type { BillBillingProfileRow } from '@/db/billing/profiles'
import type { PaymentMethod } from '@/lib/billing/payment/methods'
import { computeInvoiceLegalTotals } from '@/lib/billing/totals'
import { effectiveTaxRatePercent } from '@/lib/billing/issuer/effectiveTaxRate'
import type { BusinessType } from '@/lib/billing/issuer/fields'
import {
  addLineAction,
  deleteDraftAction,
  removeLineAction,
  updateDraftMetaAction,
  updateDraftKindAndPaymentAction,
  updateLineAction,
} from '@/actions/billing/drafts'
import InvoiceLinesEditor, { type LineFormPayload } from './InvoiceLinesEditor'
import IssueInvoiceBtn from './IssueInvoiceBtn'
import PaymentSection from './payment/PaymentSection'
import { DocStateChip } from './chips'
import { documentKindLabel } from '@/lib/billing/documentKinds'
import { formatInvoiceNumber } from './funcs'

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
  const router = useRouter()
  const [savingMeta, setSavingMeta] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [savingPayment, setSavingPayment] = useState(false)

  const isCombinedDoc = invoice.kind === 'invoice_receipt'
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod | ''>(
    (invoice.paymentMethod as PaymentMethod | null) ?? '',
  )
  const [paymentAmount, setPaymentAmount] = useState<number | null>(invoice.paymentAmount)
  const [paymentDate, setPaymentDate] = useState<string>(
    invoice.paymentDate ?? new Date().toISOString().slice(0, 10),
  )

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
  const paymentComplete =
    !isCombinedDoc ||
    (paymentMethod !== '' &&
      effectivePaymentAmount != null &&
      effectivePaymentAmount > 0 &&
      effectivePaymentAmount <= totals.total + 0.0001 &&
      paymentDate.length > 0)
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

  async function persistPayment(next: {
    method?: PaymentMethod | ''
    amount?: number | null
    date?: string
  }): Promise<void> {
    if (!isCombinedDoc) return
    if (savingPayment) return
    setSavingPayment(true)
    const method = next.method ?? paymentMethod
    const amount = next.amount === undefined ? paymentAmount : next.amount
    const date = next.date ?? paymentDate
    const result = await api(
      updateDraftKindAndPaymentAction,
      [
        {
          invoiceId: invoice.id,
          leadId: invoice.leadId,
          kind: 'invoice_receipt',
          paymentMethod: (method || null) as PaymentMethod | null,
          paymentAmount: amount,
          paymentDate: date || null,
        },
      ],
      undefined,
      'שמירת פרטי התשלום נכשלה',
      { silentSuccess: true },
    )
    setSavingPayment(false)
    if (!result || !('success' in result) || !result.success) router.refresh()
  }

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
      'השינויים נשמרו',
      'שמירת השינויים נכשלה',
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
      'הטיוטה נמחקה',
      'מחיקת הטיוטה נכשלה',
    )
    setConfirmDelete(false)
    if (result && 'success' in result && result.success) {
      router.push(`/clients/${invoice.leadId}/billing` as any)
    }
  }

  return (
    <div className='grid gap-5 py-4 pb-28'>
      {/* ── Compact draft header ──────────────────────────────────── */}
      <header className='flex items-center justify-between gap-4 flex-wrap'>
        <div className='flex items-baseline gap-3'>
          <h2 className='text-2xl font-bold text-dark tracking-tight tabular-nums'>{formatInvoiceNumber(invoice)}</h2>
          <DocStateChip state={invoice.docState} />
          <span className='text-xs font-medium px-2 py-0.5 rounded bg-softy text-gray-700'>
            {documentKindLabel(invoice.kind)}
          </span>
        </div>
        <p className='text-sm text-gray-400'>טיוטה ניתנת לעריכה עד ההנפקה</p>
      </header>

      {/* ── Recipient strip ──────────────────────────────────────── */}
      <section className='border-b border-gray-200 pb-4'>
        <p className='text-xs font-semibold text-gray-500 uppercase tracking-[0.08em] mb-2'>לכבוד</p>
        {profile ? (
          <ProfileStrip profile={profile} currency={invoice.currency} />
        ) : (
          <p className='text-base text-red-700'>חסרים פרטי חיוב — אין אפשרות להנפיק</p>
        )}
      </section>

      {/* ── Lines (inline editor) ────────────────────────────────── */}
      <InvoiceLinesEditor
        lines={lines}
        onAdd={async (payload: LineFormPayload) => {
          const result = await api(
            addLineAction,
            [{ leadId: invoice.leadId, line: { invoiceId: invoice.id, ...payload } }],
            'הפריט נוסף',
            'הוספת הפריט נכשלה',
          )
          if (!result || !('success' in result) || !result.success) throw new Error('add_line_failed')
          router.refresh()
        }}
        onUpdate={async (lineId: number, payload: LineFormPayload) => {
          const result = await api(
            updateLineAction,
            [{ leadId: invoice.leadId, invoiceId: invoice.id, line: { lineId, ...payload } }],
            'הפריט עודכן',
            'עדכון הפריט נכשל',
          )
          if (!result || !('success' in result) || !result.success) throw new Error('update_line_failed')
          router.refresh()
        }}
        onRemove={async (lineId: number) => {
          const result = await api(
            removeLineAction,
            [{ leadId: invoice.leadId, invoiceId: invoice.id, lineId }],
            'הפריט נמחק',
            'מחיקת הפריט נכשלה',
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
          disabled={savingPayment}
          onMethodChange={(v) => {
            setPaymentMethod(v)
            void persistPayment({ method: v })
          }}
          onAmountChange={(v) => {
            setPaymentAmount(v)
            void persistPayment({ amount: v })
          }}
          onDateChange={(v) => {
            setPaymentDate(v)
            void persistPayment({ date: v })
          }}
        />
      )}

      {/* ── Totals ──────────────────────────────────────────────── */}
      <section className='bg-gray-50 rounded-lg p-5'>
        <dl className='grid grid-cols-2 gap-y-2 text-base max-w-sm ms-auto'>
          <dt className='text-gray-500'>סכום ביניים</dt>
          <dd className='tabular-nums text-end text-gray-900 font-medium'>{formatCurrency(totals.subtotal)}</dd>
          <dt className='text-gray-500'>מע"מ</dt>
          <dd className='tabular-nums text-end text-gray-900 font-medium'>{formatCurrency(totals.tax)}</dd>
          <dt className='font-semibold border-t pt-3 mt-2 text-base text-gray-700'>סה"כ לתשלום</dt>
          <dd className='font-bold tabular-nums text-end border-t pt-3 mt-2 text-2xl text-dark'>
            {formatCurrency(totals.total)}
          </dd>
        </dl>
      </section>

      {/* ── Advanced options (collapsed) ─────────────────────────── */}
      <details className='border-t border-gray-200 pt-4'>
        <summary className='cursor-pointer text-base font-medium text-gray-700 hover:text-gray-900 select-none'>
          אפשרויות נוספות
        </summary>
        <form onSubmit={onSaveMeta} className='grid gap-3 mt-3'>
          <div className='grid grid-cols-1 md:grid-cols-2 gap-3'>
            <Input
              name='dueAt'
              type='date'
              lbl='תאריך פירעון'
              required={false}
              defaultValue={invoice.dueAt ?? ''}
            />
            <Input
              name='customerFooter'
              lbl='הערה ללקוח (תופיע על המסמך)'
              required={false}
              defaultValue={invoice.customerFooter}
            />
          </div>
          <Input
            name='internalNotes'
            as='textarea'
            lbl='הערות פנימיות (לא יופיעו על המסמך)'
            required={false}
            defaultValue={invoice.internalNotes}
          />
          <div className='flex justify-end'>
            <Btn variant='outline' lbl='שמור שינויים' icon='floppy-disk' type='submit' disabled={savingMeta} />
          </div>
        </form>
      </details>

      {/* ── Pinned bottom action bar ─────────────────────────────── */}
      <div className='fixed bottom-0 inset-x-0 z-40 bg-white/95 backdrop-blur border-t border-gray-200 shadow-sm'>
        <div className='ps-20 pe-8 py-3 flex items-center justify-between gap-3'>
          <Btn variant='outline' icon='trash' lbl='מחק טיוטה' onClick={() => setConfirmDelete(true)} />
          <div className='flex items-center gap-2'>
            <IssueInvoiceBtn
              leadId={invoice.leadId}
              invoiceId={invoice.id}
              disabled={!canIssueNow}
              disabledReason={issueDisabledReason}
            />
          </div>
        </div>
      </div>

      <ConfirmPop
        open={confirmDelete}
        destructive
        confirmLbl='מחק טיוטה'
        msg={'למחוק את הטיוטה? פעולה זו אינה הפיכה.'}
        onClose={() => setConfirmDelete(false)}
        onConfirm={onDelete}
      />
    </div>
  )
}

function ProfileStrip({ profile, currency }: { profile: BillBillingProfileRow; currency: string }) {
  const address = [profile.address, profile.city, profile.zip].filter(Boolean).join(', ')
  return (
    <>
      <p className='text-lg font-semibold text-gray-900'>{profile.legalName?.trim() || '—'}</p>
      <div className='mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-base text-gray-600'>
        {profile.taxId?.trim() && <span>ע.מ / ח.פ: {profile.taxId}</span>}
        {address && (
          <>
            <span className='text-gray-300'>·</span>
            <span>{address}</span>
          </>
        )}
        {profile.email?.trim() && (
          <>
            <span className='text-gray-300'>·</span>
            <span dir='ltr' className='tabular-nums'>
              {profile.email}
            </span>
          </>
        )}
        {profile.phone?.trim() && (
          <>
            <span className='text-gray-300'>·</span>
            <span dir='ltr' className='tabular-nums'>
              {profile.phone}
            </span>
          </>
        )}
        <span className='text-gray-300'>·</span>
        <span>מטבע: {currency}</span>
      </div>
    </>
  )
}
