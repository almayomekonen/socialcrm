// @vitest-environment jsdom
import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from 'vitest'
import { renderToString } from 'react-dom/server'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { billEnv, document as pdfDoc, DRAFT_RECEIPT, EXPIRED, ISSUED, ISSUED_RECEIPT, NOW, resetBillEnv } from './billingEnv'
import { billShell, invoicePage } from './billingHarness'

/**
 * HEBREW BASELINE for the draft editor's and the issued view's interactions
 * (Phase E3): line add / update / delete toasts, the advanced-options save,
 * the draft delete confirmation, issuing from a draft (confirm, failures, the
 * expired lock), the payment block's save failure; the post-issue banner in
 * every PDF state, the send dialog (validation, advanced options, every
 * failure reason, the expired lock), duplicate and re-render, the live PDF
 * chip; plus a JSON snapshot of the billing label producers (default
 * arguments). Recorded BEFORE Phase E3 on unmodified product code.
 */

const H = vi.hoisted(() => ({ toasts: [] as unknown[][], nav: [] as string[] }))

vi.mock('next/navigation', () => ({
  usePathname: () => '/clients/41/billing/9',
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
vi.mock('@/config/db', async () => (await import('./billingMocks')).configDbModule())
vi.mock('@/db/billing/invoices', async () => (await import('./billingMocks')).invoicesDbModule())
vi.mock('@/db/billing/profiles', async () => (await import('./billingMocks')).profilesDbModule())
vi.mock('@/db/billing/documents', async () => (await import('./billingMocks')).documentsDbModule())
vi.mock('@/db/billing/events', async () => (await import('./billingMocks')).eventsDbModule())
vi.mock('@/actions/billing/drafts', async () => (await import('./billingMocks')).draftsActionsModule())
vi.mock('@/actions/billing/issue', async () => (await import('./billingMocks')).issueActionsModule())
vi.mock('@/actions/billing/render', async () => (await import('./billingMocks')).renderActionsModule())
vi.mock('@/actions/billing/duplicate', async () => (await import('./billingMocks')).duplicateActionsModule())
vi.mock('@/actions/billing/send', async () => (await import('./billingMocks')).sendActionsModule())
vi.mock('@/actions/billing/documentStatus', async () => (await import('./billingMocks')).documentStatusModule())

const norm = (s: string) => s.replace(/«[^»]*»/g, '«id»').replace(/_[rR]_[0-9a-zA-Z]*_/g, '«id»').replace(/:r[0-9a-z]+:/g, '«id»')
const html = (el: Element | null | undefined) => (el ? norm(el.outerHTML) : 'ABSENT')
const dialog = () => html(document.querySelector('[role="dialog"]'))
const byTestId = (id: string) => document.querySelector(`[data-testid="${id}"]`) as HTMLInputElement
const wait = (ms: number) => act(async () => void (await new Promise((r) => setTimeout(r, ms))))
const click = async (el: Element | null | undefined) => act(async () => void fireEvent.click(el!))
const clickText = (text: string, index = 0) => click(screen.getAllByText(text)[index])
const lastDialogButton = () => [...document.querySelectorAll('[role="dialog"] button')].at(-1)
const mount = async (ent = undefined as typeof EXPIRED | undefined) => render(await billShell(null, await invoicePage(), ent))

beforeAll(() => {
  Object.assign(HTMLElement.prototype, { showPopover() {}, hidePopover() {}, togglePopover() {} })
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
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

describe('Hebrew baseline — draft editor interactions', () => {
  test('line add / update / delete, meta save, draft delete — success then failure', async () => {
    const out: Record<string, unknown> = {}
    for (const fail of [false, true]) {
      if (fail) for (const k of ['addLineAction', 'updateLineAction', 'removeLineAction', 'updateDraftMetaAction', 'deleteDraftAction']) billEnv.results[k] = 'throw'
      const { container } = await mount()
      fireEvent.change(byTestId('invoice-newline-title'), { target: { value: 'שעת עבודה' } })
      fireEvent.change(byTestId('invoice-newline-unit-price'), { target: { value: '300' } })
      await act(async () => fireEvent.keyDown(byTestId('invoice-newline-title'), { key: 'Enter' }))
      const title = container.querySelector('[data-testid="invoice-line-title"]')!
      fireEvent.change(title, { target: { value: 'ייעוץ עסקי מורחב' } })
      await act(async () => fireEvent.blur(title))
      fireEvent.click(container.querySelector('[data-testid="invoice-line-delete"]')!)
      if (!fail) out.lineDelete = dialog()
      await clickText('מחק פריט')
      await act(async () => fireEvent.submit(container.querySelector('details form')!))
      await clickText('מחק טיוטה')
      if (!fail) out.draftDelete = dialog()
      await click(lastDialogButton())
      cleanup()
    }
    out.toasts = H.toasts
    out.nav = H.nav
    out.calls = billEnv.calls
    expect(out).toMatchSnapshot()
  })

  test('issue from a draft: confirm, success, failures, thrown; expired lock; payment save failure', async () => {
    const out: Record<string, unknown> = {}
    await mount()
    await clickText('הנפק חשבונית')
    out.confirm = dialog()
    await click(lastDialogButton())
    for (const reason of ['not_draft', 'profile_archived', 'empty_legal_name', 'line_not_found', 'throw']) {
      billEnv.results.issueInvoiceAction = reason
      await clickText('הנפק חשבונית')
      await click(lastDialogButton())
    }
    cleanup()
    out.expired = html((await mount(EXPIRED)).container.querySelector('.fixed'))
    cleanup()
    billEnv.invoice = DRAFT_RECEIPT
    billEnv.results.updateDraftKindAndPaymentAction = 'throw'
    await mount()
    await act(async () => fireEvent.change(document.querySelector('section.p-5 select')!, { target: { value: 'cash' } }))
    out.toasts = H.toasts
    out.nav = H.nav
    out.calls = billEnv.calls
    expect(out).toMatchSnapshot()
  })
})

describe('Hebrew baseline — issued view interactions', () => {
  test('post-issue banner in every PDF state, both kinds; "later" hides it', async () => {
    const out: Record<string, unknown> = {}
    for (const [inv, doc] of [[ISSUED, null], [ISSUED, pdfDoc('ready')], [ISSUED, pdfDoc('failed')], [ISSUED_RECEIPT, pdfDoc('rendering')], [ISSUED_RECEIPT, pdfDoc('ready')]] as const) {
      Object.assign(billEnv, { invoice: inv, document: doc })
      sessionStorage.setItem('billing.justIssued.9', '1')
      await mount()
      await wait(0)
      out[`${inv.kind}:${doc?.status ?? 'none'}`] = html(byTestId('post-issue-send-banner'))
      cleanup()
    }
    sessionStorage.setItem('billing.justIssued.9', '1')
    await mount()
    await wait(0)
    await clickText('מאוחר יותר')
    out.later = html(byTestId('post-issue-send-banner'))
    expect(out).toMatchSnapshot()
  })

  test('send dialog: validation, advanced options, success, every failure reason, thrown; expired', async () => {
    const out: Record<string, unknown> = {}
    Object.assign(billEnv, { invoice: ISSUED_RECEIPT, document: pdfDoc('ready') })
    await mount()
    await clickText('שלח חשבונית')
    out.dialog = dialog()
    fireEvent.change(byTestId('send-invoice-recipient'), { target: { value: 'not-an-email' } })
    out.invalid = html(byTestId('send-invoice-submit'))
    fireEvent.change(byTestId('send-invoice-recipient'), { target: { value: 'yossi@example.test' } })
    await clickText('אפשרויות נוספות')
    out.advanced = dialog()
    await click(byTestId('send-invoice-submit'))
    for (const reason of ['no_permission', 'lead_not_found', 'invoice_not_found', 'invoice_not_issued', 'pdf_not_ready', 'invalid_email', 'rate_limited', 'transport_failed', 'failed', 'throw']) {
      billEnv.results.sendInvoiceEmailAction = reason
      await clickText('שלח חשבונית')
      await click(byTestId('send-invoice-submit'))
      fireEvent.keyDown(document.querySelector('[role="dialog"]')!, { key: 'Escape' })
    }
    cleanup()
    Object.assign(billEnv, { invoice: ISSUED, document: pdfDoc('ready') })
    await mount(EXPIRED)
    await clickText('שלח חשבונית')
    out.expired = dialog()
    out.toasts = H.toasts
    out.calls = billEnv.calls
    expect(out).toMatchSnapshot()
  })

  test('duplicate and re-render (success, failure, thrown); hero titles; the live PDF chip', async () => {
    const out: Record<string, unknown> = {}
    Object.assign(billEnv, { invoice: ISSUED, document: pdfDoc('failed') })
    const { container } = await mount()
    out.hero = html(container.querySelector('section.bg-dark'))
    for (const r of [undefined, 'failed', 'throw']) {
      Object.assign(billEnv.results, { duplicateInvoiceAction: r, rerenderInvoicePdfAction: r })
      await clickText('צור חשבונית חדשה מבוססת על זו')
      await clickText('נסה שוב')
    }
    cleanup()
    Object.assign(billEnv, { document: pdfDoc('rendering'), pdfStatus: { status: 'ready', url: 'https://files.example.test/invoice-42.pdf', errorReason: null } })
    const live = await mount()
    out.rendering = html(live.container.querySelector('.flex.items-center.gap-2.flex-wrap'))
    await wait(1700)
    out.afterPoll = html(live.container.querySelector('.flex.items-center.gap-2.flex-wrap'))
    out.heroAfterPoll = html(live.container.querySelector('section.bg-dark'))
    out.toasts = H.toasts
    out.nav = H.nav
    expect(out).toMatchSnapshot()
  })
})

describe('Hebrew baseline — billing label producers (default arguments)', () => {
  test('issue errors, PDF chips, kinds, legal titles, payment methods, issuer registry and validation', async () => {
    const { issueErrorMessage } = await import('@/lib/billing/issueErrorMessages')
    const { PdfStatusChip } = await import('@/components/billing/chips')
    const kinds = await import('@/lib/billing/documentKinds')
    const methods = await import('@/lib/billing/payment/methods')
    const fields = await import('@/lib/billing/issuer/fields')
    const { validateIssuerValues } = await import('@/lib/billing/issuer/validation')
    const reasons = ['payment_exceeds_total', 'payment_incomplete', 'issuer_identity_incomplete', 'no_permission', 'lead_not_found', 'invoice_not_found', 'not_draft', 'invoice_not_draft', 'empty_lines', 'profile_archived', 'empty_legal_name', 'zero_total', 'line_not_found', 'invalid_input', 'failed', 'weird', undefined]
    expect({
      issueErrors: reasons.map((r) => issueErrorMessage(r)),
      pdfChips: (['not_applicable', 'scheduled', 'rendering', 'ready', 'failed'] as const).map((s) => renderToString(<PdfStatusChip status={s} />)),
      kindLabels: ['invoice', 'invoice_receipt', null].map((k) => kinds.documentKindLabel(k as never)),
      legalTitles: ['invoice', 'invoice_receipt', null].map((k) => kinds.documentLegalTitle(k as never)),
      methods: methods.PAYMENT_METHOD_OPTIONS,
      methodLabels: ['cash', 'check', 'barter', null].map((m) => methods.paymentMethodLabel(m)),
      businessTypes: fields.BUSINESS_TYPE_OPTIONS,
      issuerFields: fields.ISSUER_FIELDS.map((f) => [f.key, f.label, f.helpText, f.placeholder, f.tier, f.inputType]),
      validation: [
        {},
        { name: '', businessType: null, taxId: '' },
        { name: 'א', businessType: 'company', taxId: '12-34' },
        { name: 'א', businessType: 'exempt', taxId: '12345678' },
        { name: 'א', businessType: 'company', taxId: '12345678', email: 'bad' },
      ].map((v) => validateIssuerValues(v)),
    }).toMatchSnapshot()
  })
})
