// @vitest-environment jsdom
import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from 'vitest'
import { renderToString as renderRaw } from 'react-dom/server'
import { cleanup } from '@testing-library/react'
import type { ReactNode } from 'react'
import { billEnv, document, DRAFT_RECEIPT, EXPIRED, ISSUED, ISSUED_RECEIPT, NOW, resetBillEnv } from './billingEnv'
import { billShell, invoicePage, newInvoicePage } from './billingHarness'

/**
 * HEBREW BASELINE for the billing screens (Phase E3) — server HTML of every
 * page-level state: the new-invoice editor (both kinds, with / without a
 * billing profile, expired, no permission), the draft editor (with / without a
 * profile, the combined kind), the issued view (PDF none / rendering / ready /
 * failed, the combined kind with a payment and rounding, the full timeline and
 * an empty one) and the not-found states. Recorded BEFORE Phase E3 on
 * unmodified product code.
 *
 * Real server pages, I/O mocked, no i18n provider. Normalized: `<!-- -->`
 * separators and `useId` values only.
 */

vi.mock('next/navigation', () => ({
  usePathname: () => '/clients/41/billing/new',
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }),
  useSearchParams: () => new URLSearchParams(''),
  redirect: (to: string) => {
    throw new Error('REDIRECT ' + to)
  },
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND')
  },
}))
vi.mock('@/db/auth', async () => ({ getUser: async () => (await import('./billingEnv')).billEnv.user }))
vi.mock('@/lib/requireUser', async () => ({ requireUser: async () => (await import('./billingEnv')).billEnv.user }))
vi.mock('@/db/uiLocale', () => ({ getUiLocalePrefs: async () => ({ userLocale: null, agencyLocale: null }) }))
vi.mock('@/lib/device', () => ({ isMobileRequest: async () => false, isMobileWorkspaceRequest: async () => false }))
vi.mock('@/db/filter', () => ({ getPerms: async () => ({ gotPermIds: [12], gotPermUsers: [], allPermUsers: [] }) }))
vi.mock('@/lib/access/productAccess', async () => ({ getAgencyProductAccess: async () => ({ hasAccess: (await import('./billingEnv')).billEnv.hasAccess }) }))
vi.mock('@/config/db', async () => (await import('./billingMocks')).configDbModule())
vi.mock('@/db/billing/invoices', async () => (await import('./billingMocks')).invoicesDbModule())
vi.mock('@/db/billing/profiles', async () => (await import('./billingMocks')).profilesDbModule())
vi.mock('@/db/billing/documents', async () => (await import('./billingMocks')).documentsDbModule())
vi.mock('@/db/billing/events', async () => (await import('./billingMocks')).eventsDbModule())
vi.mock('@/db/billing/taxRates', async () => (await import('./billingMocks')).taxRatesDbModule())
vi.mock('@/actions/billing/drafts', async () => (await import('./billingMocks')).draftsActionsModule())
vi.mock('@/actions/billing/issue', async () => (await import('./billingMocks')).issueActionsModule())
vi.mock('@/actions/billing/issuer', async () => (await import('./billingMocks')).issuerActionsModule())
vi.mock('@/actions/billing/render', async () => (await import('./billingMocks')).renderActionsModule())
vi.mock('@/actions/billing/duplicate', async () => (await import('./billingMocks')).duplicateActionsModule())
vi.mock('@/actions/billing/send', async () => (await import('./billingMocks')).sendActionsModule())
vi.mock('@/actions/billing/documentStatus', async () => (await import('./billingMocks')).documentStatusModule())
vi.mock('@/actions/clients', async () => (await import('./billingMocks')).clientsActionsModule())
// The new-lead form inside the editor's dialog is the leads package's (Phase C), baselined there.
vi.mock('@/components/clients/ClientFormPop', () => ({ default: () => <div data-stub='ClientFormPop' /> }))

function normalizeIds(html: string) {
  return html.replace(/«[^»]*»/g, '«id»').replace(/_[rR]_[0-9a-zA-Z]*_/g, '«id»').replace(/:r[0-9a-z]+:/g, '«id»')
}
const renderToString = (node: ReactNode) => normalizeIds(renderRaw(<>{node}</>).replaceAll('<!-- -->', ''))
const set = (overrides: Partial<typeof billEnv>) => Object.assign(billEnv, overrides)
const settle = (p: Promise<unknown>) => p.then(() => 'RENDERED', (e: Error) => e.message)

beforeAll(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
})
afterAll(() => vi.useRealTimers())
afterEach(() => {
  cleanup()
  resetBillEnv()
})

describe('Hebrew baseline — /clients/[clientId]/billing/new (server HTML)', () => {
  test('invoice with a billing profile; invoice/receipt; no profile; no lead name', async () => {
    const out: Record<string, string> = {}
    out.invoice = renderToString(await billShell(null, await newInvoicePage()))
    out.receipt = renderToString(await billShell(null, await newInvoicePage('invoice_receipt')))
    set({ profile: null })
    out.noProfile = renderToString(await billShell(null, await newInvoicePage()))
    set({ leadName: '' })
    out.noLeadName = renderToString(await billShell(null, await newInvoicePage()))
    expect(out).toMatchSnapshot()
  })

  test('expired subscription; no draft permission; lead not found; bad id', async () => {
    const out: Record<string, string> = {}
    set({ hasAccess: false })
    out.expired = renderToString(await billShell(null, await newInvoicePage(), EXPIRED))
    set({ hasAccess: true, user: { ...billEnv.user, role: 'EXT' } })
    out.noPermission = await settle(newInvoicePage())
    resetBillEnv()
    set({ leadFound: false })
    out.leadNotFound = await settle(newInvoicePage())
    const { default: Page } = await import('@/app/(app)/clients/[clientId]/billing/new/page')
    out.badId = await settle(Page({ params: Promise.resolve({ clientId: 'abc' }) }))
    expect(out).toMatchSnapshot()
  })
})

describe('Hebrew baseline — /clients/[clientId]/billing/[invoiceId] draft editor (server HTML)', () => {
  test('draft with a profile; without one; the combined kind with a payment; no lines; exempt agency', async () => {
    const out: Record<string, string> = {}
    out.draft = renderToString(await billShell(null, await invoicePage()))
    set({ profile: null })
    out.noProfile = renderToString(await billShell(null, await invoicePage()))
    resetBillEnv()
    set({ invoice: DRAFT_RECEIPT })
    out.receipt = renderToString(await billShell(null, await invoicePage()))
    set({ invoice: { ...DRAFT_RECEIPT, paymentMethod: null, paymentAmount: null, paymentDate: null }, lines: [] })
    out.emptyReceipt = renderToString(await billShell(null, await invoicePage()))
    resetBillEnv()
    set({ businessType: 'exempt', user: { ...billEnv.user, role: 'EXT' } })
    out.exemptNoIssuePermission = renderToString(await billShell(null, await invoicePage()))
    expect(out).toMatchSnapshot()
  })
})

describe('Hebrew baseline — issued view (server HTML)', () => {
  test('PDF none / rendering / ready / failed', async () => {
    const out: Record<string, string> = {}
    set({ invoice: ISSUED })
    out.none = renderToString(await billShell(null, await invoicePage()))
    for (const status of ['rendering', 'ready', 'failed'] as const) {
      set({ document: document(status) })
      out[status] = renderToString(await billShell(null, await invoicePage()))
    }
    expect(out).toMatchSnapshot()
  })

  test('invoice/receipt with payment and rounding; empty timeline; voided and replaced', async () => {
    const out: Record<string, string> = {}
    set({ invoice: ISSUED_RECEIPT, document: document('ready', { kind: 'invoice_receipt' }) })
    out.receipt = renderToString(await billShell(null, await invoicePage()))
    set({ invoice: { ...ISSUED, legalNameSnapshot: ' ', taxIdSnapshot: '', addressSnapshot: '', citySnapshot: '', zipSnapshot: '', emailSnapshot: '', phoneSnapshot: '' }, events: [], document: null })
    out.bareEmptyTimeline = renderToString(await billShell(null, await invoicePage()))
    set({ invoice: { ...ISSUED, docState: 'voided', fulfillState: 'written_off' } })
    out.voided = renderToString(await billShell(null, await invoicePage()))
    set({ invoice: { ...ISSUED, docState: 'replaced', fulfillState: null, issuedAt: null } })
    out.replaced = renderToString(await billShell(null, await invoicePage()))
    expect(out).toMatchSnapshot()
  })

  test('not found: missing invoice, another lead\'s invoice, no lead access, bad id', async () => {
    const out: Record<string, string> = {}
    set({ invoice: null })
    out.missing = renderToString(await billShell(null, await invoicePage()))
    set({ invoice: { ...ISSUED, leadId: 99 } })
    out.otherLead = renderToString(await billShell(null, await invoicePage()))
    set({ invoice: ISSUED, leadFound: false })
    out.noAccess = renderToString(await billShell(null, await invoicePage()))
    out.badId = await settle(invoicePage('abc'))
    expect(out).toMatchSnapshot()
  })
})
