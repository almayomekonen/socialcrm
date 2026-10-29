import { NOW } from './leadsFixtures'

/**
 * Fixed data + mutable state behind the BILLING mocks (Phase E3): the invoice
 * editor (`/clients/[clientId]/billing/new`), the draft editor and the issued
 * view (`/clients/[clientId]/billing/[invoiceId]`), the shared lead picker.
 * Used by the Hebrew baseline, the leak gate, the locale and behaviour tests.
 *
 * Customer / issuer names, line titles and descriptions, addresses, the
 * customer note and the PDF renderer's error text are DATA (Hebrew / English on
 * purpose) — they must reach the screen untouched by any localization.
 *
 * The `vi.mock` calls live in each test file (hoisted per file); their
 * factories read `billEnv` / record into `billEnv.calls`, see `billingMocks.ts`.
 */
export { NOW }

const DAY = 86_400_000
const at = (ms: number) => new Date(ms).toISOString()

export const BILL_USER = { id: 7, name: 'דנה כהן', role: 'ADMIN', agencyId: 103 }

export const PROFILE = {
  id: 3,
  agencyId: 103,
  leadId: 41,
  createdByUserId: 7,
  legalName: 'יוסי לוי בע"מ',
  taxId: '514123456',
  address: 'הרצל 10',
  city: 'חיפה',
  zip: '3303010',
  country: 'IL',
  email: 'yossi@example.test',
  phone: '054-1234567',
  defaultCurrency: 'ILS',
  locale: 'he',
  state: 'active',
  metadata: {},
  createdAt: at(NOW - 30 * DAY),
  updatedAt: at(NOW - 30 * DAY),
}

const line = (id: number, title: string, description: string, quantity: number, unitPrice: number, discount = 0) => {
  const lineSubtotal = quantity * unitPrice - discount
  return {
    id,
    invoiceId: 9,
    agencyId: 103,
    lineNumber: id,
    title,
    description,
    quantity,
    unitPrice,
    discount,
    taxRateId: 1,
    taxRatePercentSnapshot: 18,
    lineSubtotal,
    lineTaxAmount: Math.round(lineSubtotal * 18) / 100,
    lineTotal: Math.round(lineSubtotal * 118) / 100,
    metadata: {},
    createdAt: at(NOW - DAY),
    updatedAt: at(NOW - DAY),
  }
}

export const LINES = [line(1, 'ייעוץ עסקי', 'פגישה של שעתיים', 2, 450, 50), line(2, 'בניית דף נחיתה', '', 1, 1200.5)]

const invoice = (id: number, extra: Record<string, unknown> = {}) => ({
  id,
  agencyId: 103,
  leadId: 41,
  billingProfileId: 3,
  createdByUserId: 7,
  docState: 'draft',
  fulfillState: null,
  kind: 'invoice',
  documentNumber: null,
  documentYear: null,
  issuedAt: null,
  issuedByUserId: null,
  dueAt: null,
  createdAt: at(NOW - 2 * DAY),
  updatedAt: at(NOW - DAY),
  currency: 'ILS',
  locale: 'he',
  fxRate: 1,
  subtotalAmount: 2050.5,
  taxAmount: 369.09,
  roundingAmount: 0,
  totalAmount: 2419.59,
  legalNameSnapshot: 'יוסי לוי בע"מ',
  taxIdSnapshot: '514123456',
  addressSnapshot: 'הרצל 10',
  citySnapshot: 'חיפה',
  zipSnapshot: '3303010',
  countrySnapshot: 'IL',
  emailSnapshot: 'yossi@example.test',
  phoneSnapshot: '054-1234567',
  issuerNameSnapshot: 'רחל כהן ייעוץ',
  issuerBusinessTypeSnapshot: 'authorized',
  issuerTaxIdSnapshot: '123456789',
  issuerAddressSnapshot: '',
  issuerPhoneSnapshot: '',
  issuerEmailSnapshot: '',
  replacedByInvoiceId: null,
  paymentMethod: null,
  paymentAmount: null,
  paymentDate: null,
  paymentReceived: false,
  paymentMethodSnapshot: '',
  paymentAmountSnapshot: null,
  paymentDateSnapshot: null,
  internalNotes: 'לבדוק מול רואה החשבון',
  customerFooter: '',
  outstandingAmount: null,
  lastEventAt: at(NOW - DAY),
  ...extra,
})

const issued = { docState: 'issued', fulfillState: 'open', documentNumber: 42, documentYear: 2026, issuedAt: at(NOW - DAY), issuedByUserId: 7, dueAt: at(NOW + 14 * DAY) }

export const DRAFT = invoice(9)
export const DRAFT_RECEIPT = invoice(9, { kind: 'invoice_receipt', paymentMethod: 'bank_transfer', paymentAmount: 1000, paymentDate: '2026-10-27' })
export const ISSUED = invoice(9, { ...issued, customerFooter: 'תודה על שיתוף הפעולה!', outstandingAmount: 2419.59 })
export const ISSUED_RECEIPT = invoice(9, {
  ...issued,
  kind: 'invoice_receipt',
  fulfillState: 'partial',
  roundingAmount: 0.41,
  outstandingAmount: 1420,
  paymentReceived: true,
  paymentMethodSnapshot: 'credit_card',
  paymentAmountSnapshot: 1000,
  paymentDateSnapshot: '2026-10-27',
})

export const document = (status: 'pending' | 'rendering' | 'ready' | 'failed', extra: Record<string, unknown> = {}) => ({
  id: 5,
  agencyId: 103,
  invoiceId: 9,
  kind: 'invoice',
  locale: 'he',
  templateVersionId: 1,
  path: null,
  url: status === 'ready' ? 'https://files.example.test/invoice-42.pdf' : null,
  contentHash: null,
  byteSize: null,
  status,
  errorReason: status === 'failed' ? 'Chromium timeout after 30s' : null,
  isCurrent: true,
  renderedAt: null,
  renderedByUserId: null,
  metadata: {},
  createdAt: at(NOW - DAY),
  ...extra,
})

const event = (id: number, eventType: string, payload: Record<string, unknown>) => ({
  id,
  agencyId: 103,
  invoiceId: 9,
  leadId: 41,
  actorUserId: 7,
  actorKind: 'user',
  eventType,
  visibilityTier: 'customer',
  occurredAt: at(NOW - (10 - id) * 3_600_000),
  recordedAt: at(NOW - (10 - id) * 3_600_000),
  payload,
  idempotencyKey: null,
})

/** Every event the timeline words, plus an unknown one (shown as its stored type). */
export const EVENTS = [
  event(1, 'invoice.drafted', {}),
  event(2, 'invoice.updated', {}),
  event(3, 'invoice.issued', { totalAmount: 2419.59, documentNumber: 42 }),
  event(4, 'invoice.issued', {}),
  event(5, 'payment.received', { paymentAmount: 1000, paymentMethod: 'credit_card' }),
  event(6, 'payment.received', { paymentAmount: 300, paymentMethod: 'barter' }),
  event(7, 'payment.received', {}),
  event(8, 'invoice.voided', {}),
  event(9, 'invoice.replaced', {}),
  event(10, 'invoice.reminder_scheduled', {}),
]

/** The picker's recents: two already billed, two not (so both groups render). */
export const RECENT_LEADS = [
  { id: 41, details: 'יוסי לוי', firstName: 'יוסי', lastName: 'לוי', idNum: null, invoiceCount: 3 },
  { id: 52, details: null, firstName: 'מיכל', lastName: 'אברהם', idNum: null, invoiceCount: 1 },
  { id: 63, details: 'רונית שמש', firstName: null, lastName: null, idNum: null, invoiceCount: 0 },
  { id: 74, details: null, firstName: null, lastName: null, idNum: null, invoiceCount: 0 },
]
export const SEARCH_RESULTS = [{ id: 85, details: 'אבי כהן', firstName: 'אבי', lastName: 'כהן', idNum: null }]

export const ISSUER = { name: '', businessType: null, taxId: '', address: null, phone: null, email: null, img: null, country: 'IL', defaultCurrency: 'ILS', locale: 'he', docNumberFormat: 'YYYY-NNNN', bankDetails: {} }

export const BILL_DEFAULTS = {
  user: BILL_USER as Record<string, unknown>,
  leadFound: true,
  leadName: 'יוסי לוי',
  /** Server product access (the new-invoice route lock). */
  hasAccess: true,
  invoice: DRAFT as Record<string, unknown> | null,
  lines: LINES as Record<string, unknown>[],
  profile: PROFILE as Record<string, unknown> | null,
  document: null as Record<string, unknown> | null,
  events: EVENTS as Record<string, unknown>[],
  businessType: 'authorized' as string | null,
  taxRatePercent: 18,
  billedLeads: RECENT_LEADS.slice(0, 2) as Record<string, unknown>[],
  otherLeads: RECENT_LEADS.slice(2) as Record<string, unknown>[],
  searchResults: SEARCH_RESULTS as Record<string, unknown>[],
  /** The issuer completeness answer: 'complete' | 'missing-admin' | 'missing-rep' | 'error'. */
  issuer: 'complete' as 'complete' | 'missing-admin' | 'missing-rep' | 'error',
  /** Each action's next result (`undefined` → success). A string → `{ error: true, reason }`; 'throw' → it throws. */
  results: {} as Record<string, string | undefined>,
  /** What the PDF status poll returns. */
  pdfStatus: null as null | { status: string; url: string | null; errorReason: string | null },
  calls: [] as unknown[][],
}

export const billEnv = { ...BILL_DEFAULTS, results: {}, calls: [] as unknown[][] }

export function resetBillEnv() {
  Object.assign(billEnv, BILL_DEFAULTS, { results: {}, calls: [] })
}

export const EXPIRED = { hasAccess: false, status: 'TRIAL_EXPIRED', expiresAt: '2026-10-20T12:00:00.000Z' }
export const ACTIVE = { hasAccess: true, status: 'ACTIVE', expiresAt: null }

/** Hebrew DATA these screens render verbatim (names, line titles / descriptions, notes, addresses). */
export const BILL_CUSTOMER_DATA = [
  'יוסי לוי בע"מ',
  'יוסי לוי',
  'הרצל 10, חיפה, 3303010',
  'ייעוץ עסקי',
  'פגישה של שעתיים',
  'בניית דף נחיתה',
  'לבדוק מול רואה החשבון',
  'תודה על שיתוף הפעולה!',
  'מיכל אברהם',
  'רונית שמש',
  'אבי כהן',
]
