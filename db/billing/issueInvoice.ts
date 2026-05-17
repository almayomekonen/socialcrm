import { db } from '@/config/db'
import { requireUser } from '@/lib/requireUser'
import { allocateNumberInTransaction } from './numbering'
import { appendFinancialEvent } from './events'
import { INVOICE_EVENTS, PAYMENT_EVENTS } from '@/lib/billing/events/eventTypes'
import { buildInvoiceIssuedPayload, buildPaymentReceivedPayload } from '@/lib/billing/events/factories'
import { validateInvoiceDraftForIssue } from '@/lib/billing/validation/validateInvoiceDraftForIssue'
import { validateInvoiceTotals } from '@/lib/billing/validation/validateInvoiceTotals'
import { validatePaymentAtIssue, fulfillStateForCombinedDoc } from '@/lib/billing/payment/validation'
import { computeInvoiceLegalTotals } from '@/lib/billing/totals'
import { effectiveTaxRatePercent } from '@/lib/billing/issuer/effectiveTaxRate'
import type { BusinessType } from '@/lib/billing/issuer/fields'
import { scheduleInvoicePdfRender } from '@/lib/billing/pdf/schedule'

export type IssueInvoiceInput = {
  invoiceId: number
}

export type IssueInvoiceResult = {
  invoiceId: number
  documentNumber: number
  documentYear: number
  issuedAt: string
  totalAmount: number
}

export async function issueInvoice(input: IssueInvoiceInput): Promise<IssueInvoiceResult> {
  const user = await requireUser()

  const result = await db.transaction(async (trx) => {
    const invoice = await trx('bill_invoices').where({ id: input.invoiceId, agencyId: user.agencyId }).forUpdate().first()

    if (!invoice) throw new Error('billing.issue.invoice_not_found')
    if (invoice.docState !== 'draft') throw new Error('billing.issue.not_draft')

    const lines = await trx('bill_invoice_lines')
      .where({ invoiceId: input.invoiceId, agencyId: user.agencyId })
      .orderBy('lineNumber', 'asc')
      .select('id', 'lineSubtotal', 'taxRatePercentSnapshot')

    const profile = await trx('bill_billing_profiles').where({ id: invoice.billingProfileId, agencyId: user.agencyId }).first()

    if (!profile) throw new Error('billing.issue.profile_not_found')

    const agencyIssuer = await trx('agencies')
      .where({ id: user.agencyId })
      .first('name', 'businessType', 'taxId', 'address', 'phone', 'email')

    console.log(
      '[w6.trace] issueInvoice.agencyFetched',
      JSON.stringify({
        agencyId: user.agencyId,
        invoiceId: input.invoiceId,
        businessType: agencyIssuer?.businessType ?? null,
        agencyName: agencyIssuer?.name ?? null,
      }),
    )

    validateInvoiceDraftForIssue({
      docState: String(invoice.docState),
      lineCount: lines.length,
      profileLegalName: String(profile.legalName ?? ''),
      profileState: String(profile.state ?? ''),
    })

    // Business-type policy (W6) — exempt issuers (עוסק פטור) cannot collect
    // VAT regardless of the draft's stored rate. Resolve effective rate
    // PER LINE from the live agency state so an authorized → exempt switch
    // mid-draft produces a legally-correct invoice. The stored
    // taxRatePercentSnapshot from draft creation is overwritten below.
    const issuerBusinessType = (agencyIssuer?.businessType ?? null) as BusinessType | null
    const effectiveRatesByLine: number[] = lines.map((l) =>
      effectiveTaxRatePercent({
        businessType: issuerBusinessType,
        baseRatePercent: Number(l.taxRatePercentSnapshot),
      }),
    )
    console.log(
      '[w6.trace] issueInvoice.effectiveRates',
      JSON.stringify({
        invoiceId: input.invoiceId,
        issuerBusinessType,
        storedRatesPerLine: lines.map((l) => Number(l.taxRatePercentSnapshot)),
        effectiveRatesPerLine: effectiveRatesByLine,
        lineSubtotals: lines.map((l) => Number(l.lineSubtotal)),
      }),
    )

    // W1 fix — group-VAT calculation. The legal tax is `round2(group
    // subtotal × rate)`, not the sum of per-line rounded taxes, because
    // the naive sum overcharges customers on small-line-heavy invoices.
    // Per-line tax/total are recomputed inside the same transaction so
    // sum(lineTotal) === invoice total exactly.
    const legal = computeInvoiceLegalTotals(
      lines.map((l, i) => ({
        lineSubtotal: Number(l.lineSubtotal),
        taxRatePercentSnapshot: effectiveRatesByLine[i],
      })),
    )
    const rounding = round2(Number(invoice.roundingAmount ?? 0))
    const totals = {
      subtotal: legal.subtotal,
      tax: legal.tax,
      rounding,
      total: round2(legal.subtotal + legal.tax + rounding),
    }
    console.log(
      '[w6.trace] issueInvoice.legalTotals',
      JSON.stringify({
        invoiceId: input.invoiceId,
        subtotal: totals.subtotal,
        tax: totals.tax,
        total: totals.total,
        perLineTax: legal.perLineTax,
        perLineTotal: legal.perLineTotal,
      }),
    )
    validateInvoiceTotals(totals)

    // Sync each line's tax/total + the effective rate snapshot with the
    // legally-coherent share. Done in the same transaction as the invoice
    // transition, so either everything commits together or the draft stays
    // untouched. taxRateId is nulled for exempt because no rate row is
    // actually being applied.
    for (let i = 0; i < lines.length; i++) {
      const effectiveRate = effectiveRatesByLine[i]
      const updates: Record<string, unknown> = {
        taxRatePercentSnapshot: effectiveRate,
        lineTaxAmount: legal.perLineTax[i],
        lineTotal: legal.perLineTotal[i],
        updatedAt: trx.fn.now(),
      }
      if (effectiveRate === 0) updates.taxRateId = null
      await trx('bill_invoice_lines')
        .where({ id: Number(lines[i].id), agencyId: user.agencyId })
        .update(updates)
    }

    // Combined-document (חשבונית/קבלה) branch. Reuses the 'invoice' numbering
    // kind — one document, one number.
    const isCombinedDoc = String(invoice.kind ?? 'invoice') === 'invoice_receipt'
    const paymentAmount = invoice.paymentAmount == null ? null : Number(invoice.paymentAmount)
    const paymentDateStr = paymentDateToString(invoice.paymentDate)
    const paymentMethodStr = invoice.paymentMethod == null ? '' : String(invoice.paymentMethod)
    if (isCombinedDoc) {
      validatePaymentAtIssue({
        paymentMethod: paymentMethodStr,
        paymentAmount,
        paymentDate: paymentDateStr,
        invoiceTotal: totals.total,
      })
    }

    const issuedAt = new Date()
    const documentYear = issuedAt.getUTCFullYear()
    const documentNumber = await allocateNumberInTransaction(trx, {
      agencyId: user.agencyId,
      year: documentYear,
      kind: 'invoice',
    })

    const fulfillState = isCombinedDoc && paymentAmount != null ? fulfillStateForCombinedDoc(paymentAmount, totals.total) : 'open'
    const outstandingAmount = isCombinedDoc && paymentAmount != null ? round2(totals.total - paymentAmount) : totals.total

    await trx('bill_invoices')
      .where({ id: input.invoiceId, agencyId: user.agencyId })
      .update({
        docState: 'issued',
        fulfillState,
        documentNumber,
        documentYear,
        issuedAt,
        issuedByUserId: user.id,
        subtotalAmount: totals.subtotal,
        taxAmount: totals.tax,
        totalAmount: totals.total,
        outstandingAmount,
        lastEventAt: issuedAt,
        legalNameSnapshot: String(profile.legalName ?? ''),
        taxIdSnapshot: String(profile.taxId ?? ''),
        addressSnapshot: String(profile.address ?? ''),
        citySnapshot: String(profile.city ?? ''),
        zipSnapshot: String(profile.zip ?? ''),
        countrySnapshot: String(profile.country ?? 'IL'),
        emailSnapshot: String(profile.email ?? ''),
        phoneSnapshot: String(profile.phone ?? ''),
        issuerNameSnapshot: String(agencyIssuer?.name ?? ''),
        issuerBusinessTypeSnapshot: (agencyIssuer?.businessType as string | null) ?? null,
        issuerTaxIdSnapshot: String(agencyIssuer?.taxId ?? ''),
        issuerAddressSnapshot: String(agencyIssuer?.address ?? ''),
        issuerPhoneSnapshot: String(agencyIssuer?.phone ?? ''),
        issuerEmailSnapshot: String(agencyIssuer?.email ?? ''),
        paymentReceived: isCombinedDoc,
        paymentMethodSnapshot: isCombinedDoc ? paymentMethodStr : '',
        paymentAmountSnapshot: isCombinedDoc ? paymentAmount : null,
        paymentDateSnapshot: isCombinedDoc ? paymentDateStr : null,
        updatedAt: issuedAt,
      })

    const payload = buildInvoiceIssuedPayload({
      documentNumber,
      documentYear,
      totalAmount: totals.total,
      subtotalAmount: totals.subtotal,
      taxAmount: totals.tax,
      currency: String(invoice.currency ?? 'ILS'),
      locale: String(invoice.locale ?? 'he'),
    })

    await appendFinancialEvent(
      {
        invoiceId: input.invoiceId,
        leadId: Number(invoice.leadId),
        actorKind: 'user',
        actorUserId: user.id,
        eventType: INVOICE_EVENTS.ISSUED,
        occurredAt: issuedAt,
        payload: payload as unknown as Record<string, unknown>,
      },
      trx,
    )

    if (isCombinedDoc && paymentAmount != null) {
      const paymentPayload = buildPaymentReceivedPayload({
        paymentMethod: paymentMethodStr,
        paymentAmount,
        paymentDate: paymentDateStr,
        invoiceTotalAmount: totals.total,
        currency: String(invoice.currency ?? 'ILS'),
      })
      await appendFinancialEvent(
        {
          invoiceId: input.invoiceId,
          leadId: Number(invoice.leadId),
          actorKind: 'user',
          actorUserId: user.id,
          eventType: PAYMENT_EVENTS.RECEIVED,
          occurredAt: issuedAt,
          payload: paymentPayload as unknown as Record<string, unknown>,
        },
        trx,
      )
    }

    return {
      invoiceId: input.invoiceId,
      documentNumber,
      documentYear,
      issuedAt: issuedAt.toISOString(),
      totalAmount: totals.total,
    }
  })

  try {
    await scheduleInvoicePdfRender({
      invoiceId: result.invoiceId,
      agencyId: user.agencyId,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(
      '[billing.issue] post_commit.schedule_render.fail',
      JSON.stringify({ invoiceId: result.invoiceId, message: trunc(message) }),
    )
  }

  return result
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

function trunc(s: string, n = 200): string {
  return s.length > n ? s.slice(0, n) + '…' : s
}

function paymentDateToString(d: unknown): string {
  if (d == null) return ''
  if (d instanceof Date) return d.toISOString().slice(0, 10)
  const s = String(d)
  return s.length >= 10 ? s.slice(0, 10) : s
}
