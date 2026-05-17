import { db } from '@/config/db'
import { requireUser } from '@/lib/requireUser'
import type { BusinessType } from '@/lib/billing/issuer/fields'
import type { PaymentMethod } from '@/lib/billing/payment/methods'

export type DocState = 'draft' | 'issued' | 'voided' | 'replaced'
export type FulfillState = 'open' | 'partial' | 'paid' | 'overdue' | 'written_off'
export type DocumentKind = 'invoice' | 'invoice_receipt'

export type BillInvoiceRow = {
  id: number
  agencyId: number
  leadId: number
  billingProfileId: number
  createdByUserId: number

  docState: DocState
  fulfillState: FulfillState | null
  kind: DocumentKind

  documentNumber: number | null
  documentYear: number | null
  issuedAt: string | null
  issuedByUserId: number | null

  dueAt: string | null
  createdAt: string
  updatedAt: string

  currency: string
  locale: string
  fxRate: number

  subtotalAmount: number
  taxAmount: number
  roundingAmount: number
  totalAmount: number

  legalNameSnapshot: string
  taxIdSnapshot: string
  addressSnapshot: string
  citySnapshot: string
  zipSnapshot: string
  countrySnapshot: string
  emailSnapshot: string
  phoneSnapshot: string

  issuerNameSnapshot: string
  issuerBusinessTypeSnapshot: BusinessType | null
  issuerTaxIdSnapshot: string
  issuerAddressSnapshot: string
  issuerPhoneSnapshot: string
  issuerEmailSnapshot: string

  replacedByInvoiceId: number | null

  paymentMethod: PaymentMethod | null
  paymentAmount: number | null
  paymentDate: string | null
  paymentReceived: boolean

  paymentMethodSnapshot: string
  paymentAmountSnapshot: number | null
  paymentDateSnapshot: string | null

  internalNotes: string
  customerFooter: string

  outstandingAmount: number | null
  lastEventAt: string | null
  lastProjectionAt: string | null
  lastViewedAt: string | null
  reminderCount: number
  lastReminderAt: string | null

  templateVersionId: number

  metadata: Record<string, unknown>
}

export type BillInvoiceLineRow = {
  id: number
  invoiceId: number
  agencyId: number
  lineNumber: number

  title: string
  description: string
  quantity: number
  unitPrice: number
  discount: number

  taxRateId: number | null
  taxRatePercentSnapshot: number

  lineSubtotal: number
  lineTaxAmount: number
  lineTotal: number

  metadata: Record<string, unknown>

  createdAt: string
  updatedAt: string
}

export type CreateDraftInvoiceInput = {
  leadId: number
  billingProfileId: number
  currency?: string
  locale?: string
  dueAt?: string | null
  customerFooter?: string
  internalNotes?: string
  metadata?: Record<string, unknown>
  kind?: DocumentKind
  paymentMethod?: PaymentMethod | null
  paymentAmount?: number | null
  paymentDate?: string | null
}

export async function getInvoiceById(invoiceId: number): Promise<BillInvoiceRow | null> {
  const user = await requireUser()
  const row = await db('bill_invoices').where({ id: invoiceId, agencyId: user.agencyId }).first()
  return row ? normalizeInvoice(row) : null
}

export async function listInvoicesForLead(leadId: number): Promise<BillInvoiceRow[]> {
  const user = await requireUser()
  const rows = await db('bill_invoices').where({ agencyId: user.agencyId, leadId }).orderBy('createdAt', 'desc')
  return rows.map(normalizeInvoice)
}

export async function getInvoiceLinesByInvoiceId(invoiceId: number): Promise<BillInvoiceLineRow[]> {
  const user = await requireUser()

  const ownership = await db('bill_invoices').where({ id: invoiceId, agencyId: user.agencyId }).first('id')
  if (!ownership) return []

  const rows = await db('bill_invoice_lines').where({ invoiceId, agencyId: user.agencyId }).orderBy('lineNumber', 'asc')
  return rows.map(normalizeLine)
}

export type UpdateDraftMetaInput = {
  invoiceId: number
  dueAt?: string | null
  internalNotes?: string
  customerFooter?: string
}

export async function updateDraftMeta(input: UpdateDraftMetaInput): Promise<void> {
  const user = await requireUser()

  const fields: Record<string, unknown> = { updatedAt: new Date() }
  if (input.dueAt !== undefined) fields.dueAt = input.dueAt
  if (input.internalNotes !== undefined) fields.internalNotes = input.internalNotes
  if (input.customerFooter !== undefined) fields.customerFooter = input.customerFooter

  const updated = await db('bill_invoices')
    .where({ id: input.invoiceId, agencyId: user.agencyId, docState: 'draft' })
    .update(fields)

  if (updated === 0) throw new Error('billing.invoice.update_meta_failed')
}

export type UpdateDraftKindAndPaymentInput = {
  invoiceId: number
  kind: DocumentKind
  paymentMethod: PaymentMethod | null
  paymentAmount: number | null
  paymentDate: string | null
}

export async function updateDraftKindAndPayment(input: UpdateDraftKindAndPaymentInput): Promise<void> {
  const user = await requireUser()

  const fields: Record<string, unknown> = { updatedAt: new Date() }
  if (input.kind === 'invoice_receipt') {
    fields.kind = 'invoice_receipt'
    fields.paymentMethod = input.paymentMethod
    fields.paymentAmount = input.paymentAmount
    fields.paymentDate = input.paymentDate
  } else {
    fields.kind = 'invoice'
    fields.paymentMethod = null
    fields.paymentAmount = null
    fields.paymentDate = null
  }

  const updated = await db('bill_invoices')
    .where({ id: input.invoiceId, agencyId: user.agencyId, docState: 'draft' })
    .update(fields)

  if (updated === 0) throw new Error('billing.invoice.update_payment_failed')
}

export async function deleteDraftInvoice(invoiceId: number): Promise<void> {
  const user = await requireUser()

  const removed = await db('bill_invoices').where({ id: invoiceId, agencyId: user.agencyId, docState: 'draft' }).del()

  if (removed === 0) throw new Error('billing.invoice.delete_failed')
}

export async function createDraftInvoice(input: CreateDraftInvoiceInput, executor: typeof db = db): Promise<BillInvoiceRow> {
  const user = await requireUser()

  const lead = await executor('clients').where({ id: input.leadId, agencyId: user.agencyId }).first('id')
  if (!lead) throw new Error('billing.invoice.lead_not_found')

  const profile = await executor('bill_billing_profiles')
    .where({ id: input.billingProfileId, agencyId: user.agencyId, leadId: input.leadId })
    .first('id')
  if (!profile) throw new Error('billing.invoice.profile_not_found')

  const kind: DocumentKind = input.kind ?? 'invoice'
  const isCombinedDoc = kind === 'invoice_receipt'

  const [inserted] = await executor('bill_invoices')
    .insert({
      agencyId: user.agencyId,
      leadId: input.leadId,
      billingProfileId: input.billingProfileId,
      createdByUserId: user.id,
      docState: 'draft',
      currency: input.currency ?? 'ILS',
      locale: input.locale ?? 'he',
      dueAt: input.dueAt ?? null,
      customerFooter: input.customerFooter ?? '',
      internalNotes: input.internalNotes ?? '',
      metadata: JSON.stringify(input.metadata ?? {}),
      kind,
      paymentMethod: isCombinedDoc ? (input.paymentMethod ?? null) : null,
      paymentAmount: isCombinedDoc ? (input.paymentAmount ?? null) : null,
      paymentDate: isCombinedDoc ? (input.paymentDate ?? null) : null,
    })
    .returning('*')

  return normalizeInvoice(inserted)
}

function normalizeInvoice(raw: Record<string, unknown>): BillInvoiceRow {
  return {
    id: Number(raw.id),
    agencyId: Number(raw.agencyId),
    leadId: Number(raw.leadId),
    billingProfileId: Number(raw.billingProfileId),
    createdByUserId: Number(raw.createdByUserId),
    docState: raw.docState as DocState,
    fulfillState: (raw.fulfillState as FulfillState | null) ?? null,
    kind: (raw.kind as DocumentKind) ?? 'invoice',
    documentNumber: raw.documentNumber == null ? null : Number(raw.documentNumber),
    documentYear: raw.documentYear == null ? null : Number(raw.documentYear),
    issuedAt: toIso(raw.issuedAt),
    issuedByUserId: raw.issuedByUserId == null ? null : Number(raw.issuedByUserId),
    dueAt: toIsoDate(raw.dueAt),
    createdAt: toIso(raw.createdAt) ?? '',
    updatedAt: toIso(raw.updatedAt) ?? '',
    currency: String(raw.currency ?? 'ILS'),
    locale: String(raw.locale ?? 'he'),
    fxRate: Number(raw.fxRate ?? 1),
    subtotalAmount: Number(raw.subtotalAmount ?? 0),
    taxAmount: Number(raw.taxAmount ?? 0),
    roundingAmount: Number(raw.roundingAmount ?? 0),
    totalAmount: Number(raw.totalAmount ?? 0),
    legalNameSnapshot: String(raw.legalNameSnapshot ?? ''),
    taxIdSnapshot: String(raw.taxIdSnapshot ?? ''),
    addressSnapshot: String(raw.addressSnapshot ?? ''),
    citySnapshot: String(raw.citySnapshot ?? ''),
    zipSnapshot: String(raw.zipSnapshot ?? ''),
    countrySnapshot: String(raw.countrySnapshot ?? 'IL'),
    emailSnapshot: String(raw.emailSnapshot ?? ''),
    phoneSnapshot: String(raw.phoneSnapshot ?? ''),
    issuerNameSnapshot: String(raw.issuerNameSnapshot ?? ''),
    issuerBusinessTypeSnapshot: (raw.issuerBusinessTypeSnapshot as BusinessType | null) ?? null,
    issuerTaxIdSnapshot: String(raw.issuerTaxIdSnapshot ?? ''),
    issuerAddressSnapshot: String(raw.issuerAddressSnapshot ?? ''),
    issuerPhoneSnapshot: String(raw.issuerPhoneSnapshot ?? ''),
    issuerEmailSnapshot: String(raw.issuerEmailSnapshot ?? ''),
    replacedByInvoiceId: raw.replacedByInvoiceId == null ? null : Number(raw.replacedByInvoiceId),
    paymentMethod: (raw.paymentMethod as PaymentMethod | null) ?? null,
    paymentAmount: raw.paymentAmount == null ? null : Number(raw.paymentAmount),
    paymentDate: toIsoDate(raw.paymentDate),
    paymentReceived: Boolean(raw.paymentReceived ?? false),
    paymentMethodSnapshot: String(raw.paymentMethodSnapshot ?? ''),
    paymentAmountSnapshot: raw.paymentAmountSnapshot == null ? null : Number(raw.paymentAmountSnapshot),
    paymentDateSnapshot: toIsoDate(raw.paymentDateSnapshot),
    internalNotes: String(raw.internalNotes ?? ''),
    customerFooter: String(raw.customerFooter ?? ''),
    outstandingAmount: raw.outstandingAmount == null ? null : Number(raw.outstandingAmount),
    lastEventAt: toIso(raw.lastEventAt),
    lastProjectionAt: toIso(raw.lastProjectionAt),
    lastViewedAt: toIso(raw.lastViewedAt),
    reminderCount: Number(raw.reminderCount ?? 0),
    lastReminderAt: toIso(raw.lastReminderAt),
    templateVersionId: Number(raw.templateVersionId ?? 1),
    metadata: raw.metadata && typeof raw.metadata === 'object' ? (raw.metadata as Record<string, unknown>) : {},
  }
}

function normalizeLine(raw: Record<string, unknown>): BillInvoiceLineRow {
  return {
    id: Number(raw.id),
    invoiceId: Number(raw.invoiceId),
    agencyId: Number(raw.agencyId),
    lineNumber: Number(raw.lineNumber),
    title: String(raw.title ?? ''),
    description: String(raw.description ?? ''),
    quantity: Number(raw.quantity ?? 0),
    unitPrice: Number(raw.unitPrice ?? 0),
    discount: Number(raw.discount ?? 0),
    taxRateId: raw.taxRateId == null ? null : Number(raw.taxRateId),
    taxRatePercentSnapshot: Number(raw.taxRatePercentSnapshot ?? 0),
    lineSubtotal: Number(raw.lineSubtotal ?? 0),
    lineTaxAmount: Number(raw.lineTaxAmount ?? 0),
    lineTotal: Number(raw.lineTotal ?? 0),
    metadata: raw.metadata && typeof raw.metadata === 'object' ? (raw.metadata as Record<string, unknown>) : {},
    createdAt: toIso(raw.createdAt) ?? '',
    updatedAt: toIso(raw.updatedAt) ?? '',
  }
}

function toIso(d: unknown): string | null {
  if (d == null) return null
  if (d instanceof Date) return d.toISOString()
  return String(d)
}

function toIsoDate(d: unknown): string | null {
  if (d == null) return null
  if (d instanceof Date) return d.toISOString().slice(0, 10)
  const s = String(d)
  return s.length >= 10 ? s.slice(0, 10) : s
}
