// @vitest-environment jsdom
import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { billEnv, NOW, resetBillEnv } from './billingEnv'
import { billShell, newInvoicePage } from './billingHarness'

/**
 * HEBREW BASELINE for the new-invoice editor's interactions (Phase E3): adding
 * lines, every disabled-reason title, the payment block, save-draft and issue
 * toasts and their payloads, every issue failure reason, the confirm dialog,
 * the issuer identity dialog (validation errors) and the setup-required dialog,
 * the line delete confirmation, the new-lead dialog chrome, and the shared lead
 * picker (groups, current row, live search, no results). Recorded BEFORE
 * Phase E3 on unmodified product code. No i18n provider.
 */

const H = vi.hoisted(() => ({ toasts: [] as unknown[][], nav: [] as string[] }))

vi.mock('next/navigation', () => ({
  usePathname: () => '/clients/41/billing/new',
  useRouter: () => ({ push: (to: string) => H.nav.push(to), replace: () => {}, refresh: () => H.nav.push('refresh') }),
  useSearchParams: () => new URLSearchParams(''),
  redirect: (to: string) => {
    throw new Error('REDIRECT ' + to)
  },
}))
vi.mock('@/lib/toast', () => ({ toast: (...args: unknown[]) => H.toasts.push(args), proToast: () => {} }))
vi.mock('@/db/auth', async () => ({ getUser: async () => (await import('./billingEnv')).billEnv.user }))
vi.mock('@/lib/requireUser', async () => ({ requireUser: async () => (await import('./billingEnv')).billEnv.user }))
vi.mock('@/db/uiLocale', () => ({ getUiLocalePrefs: async () => ({ userLocale: null, agencyLocale: null }) }))
vi.mock('@/lib/device', () => ({ isMobileRequest: async () => false, isMobileWorkspaceRequest: async () => false }))
vi.mock('@/db/filter', () => ({ getPerms: async () => ({ gotPermIds: [12], gotPermUsers: [], allPermUsers: [] }) }))
vi.mock('@/lib/access/productAccess', async () => ({ getAgencyProductAccess: async () => ({ hasAccess: (await import('./billingEnv')).billEnv.hasAccess }) }))
vi.mock('@/config/db', async () => (await import('./billingMocks')).configDbModule())
vi.mock('@/db/billing/invoices', async () => (await import('./billingMocks')).invoicesDbModule())
vi.mock('@/db/billing/documents', async () => (await import('./billingMocks')).documentsDbModule())
vi.mock('@/db/billing/events', async () => (await import('./billingMocks')).eventsDbModule())
vi.mock('@/actions/billing/send', async () => (await import('./billingMocks')).sendActionsModule())
vi.mock('@/db/billing/profiles', async () => (await import('./billingMocks')).profilesDbModule())
vi.mock('@/db/billing/taxRates', async () => (await import('./billingMocks')).taxRatesDbModule())
vi.mock('@/actions/billing/drafts', async () => (await import('./billingMocks')).draftsActionsModule())
vi.mock('@/actions/billing/issue', async () => (await import('./billingMocks')).issueActionsModule())
vi.mock('@/actions/billing/issuer', async () => (await import('./billingMocks')).issuerActionsModule())
vi.mock('@/actions/clients', async () => (await import('./billingMocks')).clientsActionsModule())
vi.mock('@/components/clients/ClientFormPop', () => ({ default: () => <div data-stub='ClientFormPop' /> }))

const norm = (s: string) => s.replace(/«[^»]*»/g, '«id»').replace(/_[rR]_[0-9a-zA-Z]*_/g, '«id»').replace(/:r[0-9a-z]+:/g, '«id»')
const html = (el: Element | null | undefined) => (el ? norm(el.outerHTML) : 'ABSENT')
const dialog = () => html(document.querySelector('[role="dialog"]'))
const byTestId = (id: string) => document.querySelector(`[data-testid="${id}"]`) as HTMLInputElement
const type = (id: string, value: string) => fireEvent.change(byTestId(id), { target: { value } })
const wait = (ms: number) => act(async () => void (await new Promise((r) => setTimeout(r, ms))))
const titles = () => [...document.querySelectorAll('.fixed button')].map((b) => [b.textContent, b.getAttribute('title'), (b as HTMLButtonElement).disabled])

async function mount(kind?: string) {
  const r = render(await billShell(null, await newInvoicePage(kind)))
  return r
}
async function addLine(title: string, price: string, extra: { qty?: string; discount?: string; description?: string } = {}) {
  type('invoice-newline-title', title)
  if (extra.description) type('invoice-newline-description', extra.description)
  if (extra.qty) type('invoice-newline-quantity', extra.qty)
  type('invoice-newline-unit-price', price)
  if (extra.discount) type('invoice-newline-discount', extra.discount)
  await act(async () => fireEvent.keyDown(byTestId('invoice-newline-title'), { key: 'Enter' }))
}
const clickText = async (text: string, index = 0) => act(async () => fireEvent.click(screen.getAllByText(text)[index]))

beforeAll(() => {
  Object.assign(HTMLElement.prototype, { showPopover() {}, hidePopover() {}, togglePopover() {} })
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
})
afterAll(() => vi.useRealTimers())
afterEach(() => {
  cleanup()
  resetBillEnv()
  sessionStorage.clear()
  H.toasts.length = 0
  H.nav.length = 0
})

describe('Hebrew baseline — new-invoice editor', () => {
  test('lines, disabled reasons, totals, delete confirmation, save draft', async () => {
    const out: Record<string, unknown> = {}
    const { container } = await mount()
    out.emptyBar = titles()
    await addLine('ייעוץ עסקי', '0', { description: 'פגישה של שעתיים' })
    out.zeroTotal = titles()
    await addLine('בניית דף נחיתה', '1200.5', { qty: '2', discount: '100' })
    out.withLines = titles()
    out.items = html(container.querySelector('section table'))
    out.totals = html(container.querySelectorAll('section')[2])
    fireEvent.click(container.querySelector('[data-testid="invoice-line-delete"]')!)
    out.deleteConfirm = dialog()
    await clickText('מחק פריט')
    await clickText('שמור טיוטה')
    out.calls = billEnv.calls
    out.toasts = H.toasts
    out.nav = H.nav
    expect(out).toMatchSnapshot()
  })

  test('save draft failure; invoice/receipt payment block and its reasons', async () => {
    const out: Record<string, unknown> = {}
    billEnv.results.saveTransientDraftAction = 'throw'
    await mount('invoice_receipt')
    await addLine('ייעוץ עסקי', '500')
    out.payment = html(document.querySelector('section.bg-white.border.p-5'))
    out.receiptReady = titles()
    fireEvent.change(document.querySelector('section.p-5 input[type="number"]')!, { target: { value: '200' } })
    out.partialHint = html(document.querySelector('section.p-5'))
    fireEvent.change(document.querySelector('section.p-5 input[type="date"]')!, { target: { value: '' } })
    out.missingPayment = titles()
    await clickText('שמור טיוטה')
    out.toasts = H.toasts
    expect(out).toMatchSnapshot()
  })

  test('issue: confirm, success, every failure reason, a thrown failure', async () => {
    const out: Record<string, unknown> = {}
    const reasons = ['payment_exceeds_total', 'payment_incomplete', 'issuer_identity_incomplete', 'no_permission', 'lead_not_found', 'empty_lines', 'zero_total', 'invalid_input', 'failed', 'unknown_reason', 'throw']
    await mount()
    await addLine('ייעוץ עסקי', '500')
    await clickText('הנפק חשבונית')
    out.confirm = dialog()
    await act(async () => fireEvent.click(document.querySelectorAll('[role="dialog"] button')[2]))
    for (const reason of reasons) {
      billEnv.results.saveAndIssueTransientAction = reason
      await clickText('הנפק חשבונית')
      await act(async () => fireEvent.click(screen.getAllByText('הנפק חשבונית').at(-1)!))
    }
    out.toasts = H.toasts
    out.nav = H.nav
    out.calls = billEnv.calls.map((c) => c[0])
    expect(out).toMatchSnapshot()
  })

  test('issuer identity dialog (validation), setup-required dialog, completeness error', async () => {
    const out: Record<string, unknown> = {}
    billEnv.issuer = 'missing-admin'
    await mount()
    await addLine('ייעוץ עסקי', '500')
    await clickText('הנפק חשבונית')
    out.identity = dialog()
    await act(async () => fireEvent.click(screen.getByText('שמור והמשך')))
    out.identityErrors = dialog()
    const inputs = document.querySelectorAll('[role="dialog"] input[type="text"]')
    fireEvent.change(inputs[0], { target: { value: 'רחל כהן ייעוץ' } })
    fireEvent.click(document.querySelector('[role="dialog"] input[value="company"]')!)
    fireEvent.change(inputs[1], { target: { value: '12-34' } })
    fireEvent.blur(inputs[1])
    out.taxIdError = dialog()
    fireEvent.change(inputs[1], { target: { value: '51412345' } })
    billEnv.results.updateIssuerIdentityAction = 'throw'
    await act(async () => fireEvent.click(screen.getByText('שמור והמשך')))
    billEnv.results.updateIssuerIdentityAction = undefined
    await act(async () => fireEvent.click(screen.getByText('שמור והמשך')))
    out.afterIdentity = dialog()
    cleanup()
    billEnv.issuer = 'missing-rep'
    await mount()
    await addLine('ייעוץ עסקי', '500')
    await clickText('הנפק חשבונית')
    out.setupRequired = dialog()
    cleanup()
    billEnv.issuer = 'error'
    await mount()
    await addLine('ייעוץ עסקי', '500')
    await clickText('הנפק חשבונית')
    out.completenessError = dialog()
    out.toasts = H.toasts
    out.calls = billEnv.calls.filter((c) => c[0] === 'updateIssuerIdentityAction')
    expect(out).toMatchSnapshot()
  })
})

describe('Hebrew baseline — recipient card and the shared lead picker', () => {
  test('new-lead dialog; picker groups, current row, live search, no results, pick', async () => {
    const out: Record<string, unknown> = {}
    await mount()
    await clickText('יצירת לקוח/ה')
    out.newLead = dialog()
    fireEvent.keyDown(document.querySelector('[role="dialog"]')!, { key: 'Escape' })
    cleanup()
    const { container } = await mount()
    const trigger = container.querySelector('section button') as HTMLButtonElement
    out.trigger = html(trigger)
    fireEvent.click(trigger)
    const panel = () => html(document.body.querySelector(':scope > div[style]'))
    out.groups = panel()
    const search = document.body.querySelector(':scope > div[style] input') as HTMLInputElement
    fireEvent.change(search, { target: { value: 'א' } })
    out.oneChar = panel()
    fireEvent.change(search, { target: { value: 'אב' } })
    await wait(250)
    out.results = panel()
    fireEvent.change(search, { target: { value: 'ללא' } })
    await wait(250)
    out.none = panel()
    fireEvent.change(search, { target: { value: '' } })
    fireEvent.click(screen.getByText('רונית שמש'))
    fireEvent.click(trigger)
    fireEvent.click(screen.getByText('יצירת לקוח/ה חדש/ה'))
    out.createFromPanel = dialog()
    out.nav = H.nav
    out.searches = billEnv.calls.filter((c) => c[0] === 'searchLeads')
    expect(out).toMatchSnapshot()
  })
})
