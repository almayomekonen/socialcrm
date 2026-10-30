import type { Surface } from './surfaces'
import type { Allowance } from './leakScan'
import { BILL_CUSTOMER_DATA, DRAFT_RECEIPT, EXPIRED, ISSUED, ISSUED_RECEIPT, document } from './billingEnv'
import { billShell, invoicePage, newInvoicePage, withBillEnv } from './billingHarness'

/**
 * Leak-gate registrations for the billing screens (Phase E3, desktop): the
 * new-invoice editor, the draft editor, the issued view and the not-found
 * state. Spread into SURFACES (surfaces.tsx); rendering relies on the mocks in
 * leakGate.test.tsx. Portalled UI (dialogs, the lead picker's panel, the send
 * dialog) is opened and scanned in billingLocales.test.tsx.
 *
 * Allowed: only fixture DATA rendered verbatim — the lead / billing-profile
 * names and address, line titles and descriptions, the internal note and the
 * customer note (all user-entered). The PDF renderer's error text is English
 * (external) and needs no allowance.
 */
function data(...texts: string[]): Allowance[] {
  return texts.map((text) => {
    if (!BILL_CUSTOMER_DATA.includes(text)) throw new Error(`not declared as customer data: ${text}`)
    return { text, reason: 'customer-data' as const }
  })
}

const LINES = ['ייעוץ עסקי', 'פגישה של שעתיים', 'בניית דף נחיתה']
const PROFILE = ['יוסי לוי בע"מ', 'הרצל 10, חיפה, 3303010']

export const BILLING_SURFACES: Surface[] = [
  {
    name: 'billing — new invoice with a billing profile',
    route: '/clients/[clientId]/billing/new',
    render: async (locale) => billShell(locale, await withBillEnv({}, () => newInvoicePage())),
    allowed: data('יוסי לוי', ...PROFILE),
  },
  {
    name: 'billing — new invoice/receipt, no billing profile (payment block, fallback line)',
    route: '/clients/[clientId]/billing/new?kind=invoice_receipt',
    render: async (locale) => billShell(locale, await withBillEnv({ profile: null }, () => newInvoicePage('invoice_receipt'))),
    allowed: data('יוסי לוי'),
  },
  {
    name: 'billing — new invoice, subscription expired',
    route: '/clients/[clientId]/billing/new',
    render: async (locale) => billShell(locale, await withBillEnv({ hasAccess: false }, () => newInvoicePage()), EXPIRED),
    allowed: [],
  },
  {
    name: 'billing — draft editor with a profile and lines',
    route: '/clients/[clientId]/billing/[invoiceId]',
    render: async (locale) => billShell(locale, await withBillEnv({}, () => invoicePage())),
    // Line titles / descriptions sit in input VALUES (not scanned); the internal note is the textarea's text.
    allowed: data(...PROFILE, 'לבדוק מול רואה החשבון'),
  },
  {
    name: 'billing — draft invoice/receipt without a profile or lines, subscription expired',
    route: '/clients/[clientId]/billing/[invoiceId]',
    render: async (locale) => billShell(locale, await withBillEnv({ invoice: DRAFT_RECEIPT, profile: null, lines: [] }, () => invoicePage()), EXPIRED),
    allowed: data('לבדוק מול רואה החשבון'),
  },
  {
    name: 'billing — issued invoice, PDF not yet rendered, full timeline',
    route: '/clients/[clientId]/billing/[invoiceId]',
    render: async (locale) => billShell(locale, await withBillEnv({ invoice: ISSUED }, () => invoicePage())),
    allowed: data(...PROFILE, ...LINES, 'תודה על שיתוף הפעולה!'),
  },
  {
    name: 'billing — issued invoice/receipt, PDF ready, payment and rounding',
    route: '/clients/[clientId]/billing/[invoiceId]',
    render: async (locale) => billShell(locale, await withBillEnv({ invoice: ISSUED_RECEIPT, document: document('ready') }, () => invoicePage())),
    allowed: data(...PROFILE, ...LINES),
  },
  {
    name: 'billing — issued invoice, PDF failed (renderer error shown as stored), no name, empty timeline',
    route: '/clients/[clientId]/billing/[invoiceId]',
    render: async (locale) =>
      billShell(locale, await withBillEnv({ invoice: { ...ISSUED, legalNameSnapshot: '', customerFooter: '' }, document: document('failed'), events: [] }, () => invoicePage())),
    allowed: data('הרצל 10, חיפה, 3303010', ...LINES),
  },
  {
    name: 'billing — invoice not found',
    route: '/clients/[clientId]/billing/[invoiceId]',
    render: async (locale) => billShell(locale, await withBillEnv({ invoice: null }, () => invoicePage())),
    allowed: [],
  },
]
