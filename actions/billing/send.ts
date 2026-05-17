'use server'

import { revalidatePath } from 'next/cache'
import { render } from '@react-email/render'
import { db } from '@/config/db'
import { requireUser } from '@/lib/requireUser'
import { getPerms } from '@/db/filter'
import { isAdmin } from '@/types/roles'
import { canReadBilling } from '@/lib/billing/permissions'
import { sendEmail } from '@/lib/email/sender'
import { getAgencyById } from '@/db/agencies'
import { getIssuerForRender } from '@/db/billing/issuer'
import { resolveIssuerForRender } from '@/lib/billing/issuer/resolveForRender'
import type { BusinessType } from '@/lib/billing/issuer/fields'
import { appendFinancialEvent } from '@/db/billing/events'
import { INVOICE_EVENTS } from '@/lib/billing/events/eventTypes'
import { formatDocumentIdentity, formatDocumentShortNumber, formatNumberingDisplay } from '@/lib/billing/numbering'
import type { DocumentKind } from '@/db/billing/invoices'
import { formatCurrency } from '@/lib/funcs'
import { formatDate } from '@/lib/dates'
import InvoiceSentEmail from '@/emails/templates/InvoiceSentEmail'

export type SendInvoiceResult = { success: true } | { error: true; reason: SendInvoiceErrorReason }

export type SendInvoiceErrorReason =
  | 'no_permission'
  | 'lead_not_found'
  | 'invoice_not_found'
  | 'invoice_not_issued'
  | 'pdf_not_ready'
  | 'invalid_email'
  | 'rate_limited'
  | 'transport_failed'
  | 'failed'

const SEND_COOLDOWN_SECONDS = 30

export async function sendInvoiceEmailAction(input: {
  invoiceId: number
  leadId: number
  recipientEmail: string
  customMessage?: string
}): Promise<SendInvoiceResult> {
  const user = await requireUser()
  if (!canReadBilling(user)) return { error: true, reason: 'no_permission' }

  const recipient = String(input.recipientEmail ?? '').trim()
  if (!isValidEmail(recipient)) return { error: true, reason: 'invalid_email' }

  const { gotPermIds } = await getPerms(user)
  const leadQ = db('clients').where({ id: input.leadId, agencyId: user.agencyId })
  if (!isAdmin(user.role)) leadQ.whereIn('userId', gotPermIds)
  const lead = await leadQ.first('id')
  if (!lead) return { error: true, reason: 'lead_not_found' }

  const invoice = await db('bill_invoices')
    .where({ id: input.invoiceId, agencyId: user.agencyId, leadId: input.leadId })
    .first(
      'id',
      'docState',
      'kind',
      'leadId',
      'documentNumber',
      'documentYear',
      'totalAmount',
      'currency',
      'issuedAt',
      'legalNameSnapshot',
      'emailSnapshot',
      'issuerNameSnapshot',
      'issuerBusinessTypeSnapshot',
      'issuerTaxIdSnapshot',
      'issuerAddressSnapshot',
      'issuerPhoneSnapshot',
      'issuerEmailSnapshot',
    )
  if (!invoice) return { error: true, reason: 'invoice_not_found' }
  if (invoice.docState === 'draft') return { error: true, reason: 'invoice_not_issued' }

  const document = await db('bill_documents')
    .where({ agencyId: user.agencyId, invoiceId: input.invoiceId, isCurrent: true, status: 'ready' })
    .first('url', 'path')
  if (!document?.url) return { error: true, reason: 'pdf_not_ready' }

  const lastSent = await db('bill_financial_events')
    .where({
      agencyId: user.agencyId,
      invoiceId: input.invoiceId,
      eventType: INVOICE_EVENTS.SENT,
    })
    .orderBy('recordedAt', 'desc')
    .first('recordedAt')
  if (lastSent?.recordedAt) {
    const lastSentMs = new Date(String(lastSent.recordedAt)).getTime()
    if (Number.isFinite(lastSentMs)) {
      const sinceMs = Date.now() - lastSentMs
      if (sinceMs >= 0 && sinceMs < SEND_COOLDOWN_SECONDS * 1000) {
        return { error: true, reason: 'rate_limited' }
      }
    }
  }

  const [agency, liveIssuer] = await Promise.all([getAgencyById(user.agencyId), getIssuerForRender(user.agencyId)])
  const resolvedIssuer = resolveIssuerForRender({
    invoice: {
      issuerNameSnapshot: String(invoice.issuerNameSnapshot ?? ''),
      issuerBusinessTypeSnapshot: (invoice.issuerBusinessTypeSnapshot as BusinessType | null) ?? null,
      issuerTaxIdSnapshot: String(invoice.issuerTaxIdSnapshot ?? ''),
      issuerAddressSnapshot: String(invoice.issuerAddressSnapshot ?? ''),
      issuerPhoneSnapshot: String(invoice.issuerPhoneSnapshot ?? ''),
      issuerEmailSnapshot: String(invoice.issuerEmailSnapshot ?? ''),
    },
    liveIssuer,
    fallbackAgencyName: String(agency?.name ?? ''),
  })
  const agencyName: string = (resolvedIssuer.name ?? '').trim() || 'SocialCRM'

  const numberDisplay = formatNumberingDisplay({
    year: Number(invoice.documentYear),
    value: Number(invoice.documentNumber),
    kind: 'invoice',
  })

  const kind = (invoice.kind ?? 'invoice') as DocumentKind
  const documentIdentity = formatDocumentIdentity({
    documentNumber: Number(invoice.documentNumber),
    docState: 'issued',
    kind,
  })
  const shortNumber = formatDocumentShortNumber({
    documentNumber: Number(invoice.documentNumber),
    docState: 'issued',
  })

  const html = await render(
    InvoiceSentEmail({
      recipientName: String(invoice.legalNameSnapshot ?? '').trim(),
      documentIdentity,
      shortNumber,
      totalDisplay: String(formatCurrency(Number(invoice.totalAmount))),
      issuedDate: invoice.issuedAt ? formatDate(invoice.issuedAt) : '',
      agencyName,
      pdfUrl: String(document.url),
      customMessage: input.customMessage?.trim() || undefined,
    }),
  )

  const subject = `${documentIdentity} מ-${agencyName}`

  try {
    const result = await sendEmail({ to: recipient, subject, html })
    if (!result.ok) {
      const transportError = 'error' in result ? result.error : 'unknown_send_failure'
      logActionError('billing.action.send.transport_fail', new Error(transportError), {
        invoiceId: input.invoiceId,
        recipient,
      })
      return { error: true, reason: 'transport_failed' }
    }

    await appendFinancialEvent({
      invoiceId: input.invoiceId,
      leadId: input.leadId,
      actorKind: 'user',
      actorUserId: user.id,
      eventType: INVOICE_EVENTS.SENT,
      payload: {
        channel: 'email',
        recipient,
        providerMessageId: result.id,
        documentNumber: numberDisplay,
      },
    })

    revalidatePath(`/clients/${input.leadId}/billing/${input.invoiceId}`)
    return { success: true }
  } catch (err) {
    logActionError('billing.action.send', err, { invoiceId: input.invoiceId, recipient })
    return { error: true, reason: 'failed' }
  }
}

function isValidEmail(value: string): boolean {
  if (!value) return false
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
}

function logActionError(channel: string, err: unknown, extra: Record<string, unknown>): void {
  const message = err instanceof Error ? err.message : String(err)
  const truncated = message.length > 200 ? message.slice(0, 200) + '…' : message
  console.error(channel, JSON.stringify({ ...extra, message: truncated }))
}
