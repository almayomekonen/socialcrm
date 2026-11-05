'use server'

import { revalidatePath } from 'next/cache'
import { render } from '@react-email/render'
import { db } from '@/config/db'
import { requireProductAccess } from '@/lib/requireUser'
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
import { invoicePdfFilename } from '@/lib/billing/pdf/filename'
import { getObjectBytes, StorageNotFoundError } from '@/lib/storage/objects'

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
  const user = await requireProductAccess()
  console.log('[billing.send] action.start', {
    invoiceId: input.invoiceId,
    leadId: input.leadId,
    userId: user.id,
    agencyId: user.agencyId,
  })
  if (!canReadBilling(user)) {
    console.log('[billing.send] gate.no_permission', { userId: user.id, role: user.role })
    return { error: true, reason: 'no_permission' }
  }

  const recipient = String(input.recipientEmail ?? '').trim()
  if (!isValidEmail(recipient)) {
    console.log('[billing.send] gate.invalid_email', { invoiceId: input.invoiceId })
    return { error: true, reason: 'invalid_email' }
  }

  const { gotPermIds } = await getPerms(user)
  const leadQ = db('clients').where({ id: input.leadId, agencyId: user.agencyId })
  if (!isAdmin(user.role)) leadQ.whereIn('userId', gotPermIds)
  const lead = await leadQ.first('id')
  if (!lead) {
    console.log('[billing.send] gate.lead_not_found', {
      leadId: input.leadId,
      agencyId: user.agencyId,
      isAdmin: isAdmin(user.role),
      gotPermIdsCount: gotPermIds?.length ?? null,
    })
    return { error: true, reason: 'lead_not_found' }
  }

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
  if (!invoice) {
    console.log('[billing.send] gate.invoice_not_found', {
      invoiceId: input.invoiceId,
      leadId: input.leadId,
      agencyId: user.agencyId,
    })
    return { error: true, reason: 'invoice_not_found' }
  }
  if (invoice.docState === 'draft') {
    console.log('[billing.send] gate.invoice_not_issued', {
      invoiceId: input.invoiceId,
      docState: invoice.docState,
    })
    return { error: true, reason: 'invoice_not_issued' }
  }

  // Probe ALL document rows for this invoice — not just the ready ones —
  // so when the ready-row lookup misses we can tell whether the render is
  // still pending, failed, or never scheduled.
  const document = await db('bill_documents')
    .where({ agencyId: user.agencyId, invoiceId: input.invoiceId, isCurrent: true, status: 'ready' })
    .first('url', 'path')
  if (!document?.path) {
    const latestDoc = await db('bill_documents')
      .where({ agencyId: user.agencyId, invoiceId: input.invoiceId })
      .orderBy('id', 'desc')
      .first('id', 'status', 'isCurrent', 'url', 'errorReason', 'createdAt')
    console.log('[billing.send] gate.pdf_not_ready', {
      invoiceId: input.invoiceId,
      readyRow: !!document,
      hadPath: !!document?.path,
      latestDoc: latestDoc
        ? {
            id: latestDoc.id,
            status: latestDoc.status,
            isCurrent: latestDoc.isCurrent,
            errorReason: latestDoc.errorReason ?? null,
            createdAt: latestDoc.createdAt,
          }
        : null,
    })
    return { error: true, reason: 'pdf_not_ready' }
  }

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
        console.log('[billing.send] gate.rate_limited', {
          invoiceId: input.invoiceId,
          sinceMs,
          cooldownMs: SEND_COOLDOWN_SECONDS * 1000,
        })
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
      customMessage: input.customMessage?.trim() || undefined,
    }),
  )

  const subject = `${documentIdentity} מ-${agencyName}`

  /**
   * THE PDF TRAVELS WITH THE EMAIL. Invoices are private objects, and a link good
   * enough for someone with no account would be a permanent public URL. A file that
   * cannot be read fails the send here, before anything reaches the customer.
   */
  let pdf: Uint8Array
  try {
    pdf = await getObjectBytes(String(document.path))
  } catch (err) {
    console.log('[billing.send] gate.pdf_unreadable', { invoiceId: input.invoiceId, name: (err as Error)?.name ?? null })
    return { error: true, reason: err instanceof StorageNotFoundError ? 'pdf_not_ready' : 'transport_failed' }
  }
  const filename = invoicePdfFilename({
    kind: invoice.kind ?? null,
    documentNumber: invoice.documentNumber == null ? null : Number(invoice.documentNumber),
    legalNameSnapshot: invoice.legalNameSnapshot ?? null,
  })

  console.log('[billing.send] before.sendEmail', {
    invoiceId: input.invoiceId,
    htmlBytes: html.length,
    pdfBytes: pdf.byteLength,
  })

  try {
    const result = await sendEmail({
      to: recipient,
      subject,
      html,
      attachments: [{ filename, content: Buffer.from(pdf) }],
    })
    console.log('[billing.send] after.sendEmail', {
      invoiceId: input.invoiceId,
      ok: result.ok,
      id: 'id' in result ? result.id : null,
    })
    if (!result.ok) {
      const transportError = 'error' in result ? result.error : 'unknown_send_failure'
      logActionError('billing.action.send.transport_fail', new Error(transportError), {
        invoiceId: input.invoiceId,
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
    logActionError('billing.action.send', err, { invoiceId: input.invoiceId })
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
