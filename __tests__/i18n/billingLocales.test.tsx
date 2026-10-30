// @vitest-environment jsdom
import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from 'vitest'
import { renderToString } from 'react-dom/server'
import { hydrateRoot } from 'react-dom/client'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { ReactElement } from 'react'
import { findHebrewLeaks } from './leakScan'
import { BILL_CUSTOMER_DATA, billEnv, document as pdfDoc, DRAFT_RECEIPT, EXPIRED, ISSUED, ISSUED_RECEIPT, NOW, resetBillEnv } from './billingEnv'

/**
 * Billing screens (Phase E3) in en / ar: page text and region, Hebrew declares
 * nothing, tab titles, every dialog / the lead picker's portalled panel / the
 * send dialog scanned for Hebrew outside data, toasts, the live PDF chip, a
 * language switch within one session, hydration he / en / ar.
 */

const H = vi.hoisted(() => ({ prefs: { userLocale: 'en' as string | null }, toasts: [] as unknown[][] }))
vi.mock('next/navigation', () => ({
  usePathname: () => '/clients/41/billing/new',
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }),
  useSearchParams: () => new URLSearchParams(''),
  redirect: (to: string) => {
    throw new Error('REDIRECT ' + to)
  },
}))
vi.mock('@/lib/toast', async () => ({ ...(await vi.importActual<typeof import('@/lib/toast')>('@/lib/toast')), toast: (...a: unknown[]) => H.toasts.push(a), proToast: () => {} }))
vi.mock('@/lib/analytics/track', () => ({ track: () => {} }))
vi.mock('@/db/auth', async () => ({ getUser: async () => (await import('./billingEnv')).billEnv.user }))
vi.mock('@/lib/requireUser', async () => ({ requireUser: async () => (await import('./billingEnv')).billEnv.user }))
vi.mock('@/db/uiLocale', () => ({ getUiLocalePrefs: async () => ({ userLocale: H.prefs.userLocale, agencyLocale: null }) }))
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
vi.mock('@/components/clients/ClientFormPop', () => ({ default: () => <div data-stub='ClientFormPop' /> }))

const { billShell, invoicePage, newInvoicePage, withBillEnv } = await import('./billingHarness')

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

type Loc = 'he' | 'en' | 'ar'
const DIR = { en: 'ltr', ar: 'rtl' } as const
const textOf = (el: Element) => (el.textContent ?? '').replace(/[‎‏]/g, '').replace(/\s+/g, ' ')
const has = (text: string, ...parts: string[]) => parts.forEach((p) => expect(text, p).toContain(p))
const regionOf = (el: Element | null | undefined) => [el?.getAttribute('lang') ?? null, el?.getAttribute('dir') ?? null]
const data = BILL_CUSTOMER_DATA.map((text) => ({ text, reason: 'customer-data' as const }))
const leaks = (el: Element) => findHebrewLeaks(el, data, new Set())
const dialog = () => [...document.querySelectorAll('[role="dialog"]')].pop() as HTMLElement
const byTestId = (id: string) => document.querySelector(`[data-testid="${id}"]`) as HTMLInputElement
const wait = (ms: number) => act(async () => void (await new Promise((r) => setTimeout(r, ms))))
const click = async (el: Element | null | undefined) => act(async () => void fireEvent.click(el!))
const hebrewIn = (v: unknown) => /[֐-׿]/.test(JSON.stringify(v))

async function page(locale: Loc, overrides: Partial<typeof billEnv>, kind?: string, ent?: typeof EXPIRED, which: 'new' | 'invoice' = 'invoice') {
  H.prefs.userLocale = locale
  return billShell(locale, await withBillEnv(overrides, () => (which === 'new' ? newInvoicePage(kind) : invoicePage())), ent)
}
async function addLine(title: string, price: string) {
  fireEvent.change(byTestId('invoice-newline-title'), { target: { value: title } })
  fireEvent.change(byTestId('invoice-newline-unit-price'), { target: { value: price } })
  await act(async () => fireEvent.keyDown(byTestId('invoice-newline-title'), { key: 'Enter' }))
}

const savedEnv = { ...process.env }
beforeAll(() => {
  Object.assign(HTMLElement.prototype, { showPopover() {}, hidePopover() {}, togglePopover() {} })
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
  Object.assign(process.env, { UI_LOCALE_ENABLED: '1', UI_LOCALE_AGENCY_ALLOWLIST: '103' })
})
afterAll(() => {
  vi.useRealTimers()
  process.env = { ...savedEnv }
})
afterEach(() => {
  cleanup()
  resetBillEnv()
  sessionStorage.clear()
  H.toasts.length = 0
})

describe('billing pages in en / ar', () => {
  test('new invoice (both kinds, expired), draft, issued, not found: text, region, no Hebrew outside data', async () => {
    for (const locale of ['en', 'ar'] as const) {
      const en = locale === 'en'
      const cases: Array<[string, () => Promise<ReactElement>, string[]]> = [
        ['new', () => page(locale, {}, undefined, undefined, 'new'), en ? ['New invoice', 'New billing document for', 'Bill to', 'Items', '+ New item', 'Summary', 'Total due', 'Save draft', 'Issue invoice', 'Draft · not saved automatically', 'Business / Company ID: 514123456'] : ['فاتورة جديدة', 'إلى', 'البنود', 'حفظ المسودة', 'إصدار الفاتورة']],
        ['receipt', () => page(locale, { profile: null }, 'invoice_receipt', undefined, 'new'), en ? ['New invoice/receipt', 'Payment received', 'Payment method', 'Amount paid', "Billing details will be set when you save, based on the lead's name:"] : ['فاتورة/إيصال جديد', 'طريقة الدفع']],
        ['expired', () => page(locale, { hasAccess: false }, undefined, EXPIRED, 'new'), en ? ['Renewing your subscription brings back creating invoices.'] : ['تجديد الاشتراك يعيد إمكانية إنشاء الفواتير.']],
        ['draft', () => page(locale, {}), en ? ['Draft, no number', 'Draft', 'Invoice', 'A draft can be edited until it is issued', 'Currency: ILS', 'More options', 'Delete draft', 'Issue invoice', 'Line total'] : ['مسودة بدون رقم', 'العملة: ILS', 'حذف المسودة']],
        ['draftReceipt', () => page(locale, { invoice: DRAFT_RECEIPT, profile: null }), en ? ['Billing details are missing — the invoice cannot be issued', 'Payment received', 'Invoice/receipt'] : ['بيانات الفوترة ناقصة — لا يمكن الإصدار']],
        ['issued', () => page(locale, { invoice: ISSUED }), en ? ['Invoice #00042', 'Issued', 'Awaiting payment', 'PDF coming soon', 'Generating…', 'Bill to (as signed on the document)', 'Balance due', 'Note to customer', 'Activity', 'Draft created', 'Issued Invoice #00042 · amount', ' by Credit card', 'Payment received · ', 'invoice.reminder_scheduled', 'Create a new invoice based on this one'] : ['فاتورة #00042', 'صادرة', 'النشاط', 'تم إنشاء مسودة', 'عبر بطاقة ائتمان']],
        ['receiptReady', () => page(locale, { invoice: ISSUED_RECEIPT, document: pdfDoc('ready') }), en ? ['Invoice/receipt #00042', 'Partially paid', 'Document ready', 'Download PDF', 'Rounding', 'Payment received (as signed on the document)', 'Credit card'] : ['فاتورة/إيصال #00042', 'تنزيل PDF', 'التقريب']],
        ['failed', () => page(locale, { invoice: { ...ISSUED, legalNameSnapshot: '' }, document: pdfDoc('failed'), events: [] }), en ? ['Generation failed', '· Generation error: Chromium timeout after 30s', 'No name', 'Try again', 'No recorded activity yet'] : ['خطأ في الإنشاء', 'بدون اسم', 'إعادة المحاولة']],
        ['notFound', () => page(locale, { invoice: null }), en ? ['Invoice not found', 'Back to invoices'] : ['لم يتم العثور على الفاتورة']],
      ]
      for (const [name, node, words] of cases) {
        const { container } = render(await node())
        const root = container.firstElementChild
        if (name !== 'expired') expect(regionOf(root), `${locale} ${name}`).toEqual([locale, DIR[locale]])
        else expect(container.querySelector(`[lang="${locale}"]`), 'expired state declares its language').not.toBeNull()
        expect(leaks(container), `${locale} ${name}`).toEqual([])
        expect(container.querySelector('[lang="he"]'), `${locale} ${name}: nothing declared Hebrew`).toBeNull()
        has(textOf(container), ...words)
        cleanup()
        sessionStorage.clear() // the new editor's autosave would restore the previous case's draft
      }
    }
    for (const node of [() => page('he', {}, undefined, undefined, 'new'), () => page('he', {}), () => page('he', { invoice: ISSUED })]) {
      const { container } = render(await node())
      expect(container.querySelector('[lang]'), 'Hebrew declares nothing').toBeNull()
      expect(container.firstElementChild?.getAttribute('dir')).toBeNull()
      cleanup()
    }
  })

  test('tab titles mirror the lead layout in every language', async () => {
    for (const path of ['new/page', '[invoiceId]/page'] as const) {
      const mod = await import(`@/app/(app)/clients/[clientId]/billing/${path}`)
      for (const [locale, title] of [['en', 'Lead details'], ['ar', null], ['he', 'נתוני ליד']] as const) {
        H.prefs.userLocale = locale
        const meta = await mod.generateMetadata()
        if (title) expect(meta.title, `${path} ${locale}`).toBe(title)
        else expect(hebrewIn(meta), `${path} ${locale}`).toBe(false)
      }
    }
  })
})

describe('dialogs, picker and toasts in en / ar: no Hebrew outside data, the region is declared', () => {
  test('new editor: confirm, line delete, new lead, identity (with errors), setup required, picker panel, issue failures', async () => {
    for (const locale of ['en', 'ar'] as const) {
      const scan = (name: string) => {
        const dlg = dialog()
        expect(regionOf(dlg), `${locale} ${name}`).toEqual([locale, DIR[locale]])
        expect(leaks(dlg), `${locale} ${name}`).toEqual([])
        return textOf(dlg)
      }
      const { container } = render(await page(locale, {}, undefined, undefined, 'new'))
      await addLine('ייעוץ עסקי', '500')
      fireEvent.click(container.querySelector('[data-testid="invoice-line-delete"]')!)
      if (locale === 'en') has(scan('lineDelete'), 'Delete the item "ייעוץ עסקי"?', 'Delete item', 'Cancel')
      else scan('lineDelete')
      fireEvent.keyDown(dialog(), { key: 'Escape' })
      await click(screen.getByText(locale === 'en' ? 'Create customer' : 'إنشاء عميل'))
      if (locale === 'en') expect(dialog().getAttribute('aria-label')).toBe('New lead')
      scan('newLead')
      fireEvent.keyDown(dialog(), { key: 'Escape' })
      // The picker's portalled panel.
      fireEvent.click(container.querySelector('section button')!)
      const panel = () => document.body.querySelector(':scope > div[style]') as HTMLElement
      expect(regionOf(panel())).toEqual([locale, DIR[locale]])
      expect(leaks(panel()), `${locale} picker`).toEqual([])
      if (locale === 'en') has(textOf(panel()), 'Already billed', 'Recent leads', 'Current', 'No name', 'Create a new customer')
      if (locale === 'en') expect(panel().querySelector('input')!.getAttribute('placeholder')).toBe('Search customers...')
      if (locale === 'en') expect(panel().querySelector('[title]')!.getAttribute('title')).toBe('3 invoices')
      fireEvent.change(panel().querySelector('input')!, { target: { value: 'ללא' } })
      await wait(250)
      has(textOf(panel()), locale === 'en' ? 'No results' : 'لا توجد نتائج')
      fireEvent.mouseDown(document.body)
      await click(screen.getAllByText(locale === 'en' ? 'Issue invoice' : 'إصدار الفاتورة')[0])
      if (locale === 'en') has(scan('confirm'), 'The invoice will get a number and be locked for editing.')
      else scan('confirm')
      for (const reason of ['payment_exceeds_total', 'issuer_identity_incomplete', 'not_draft', 'weird', 'throw']) {
        billEnv.results.saveAndIssueTransientAction = reason
        await click([...dialog().querySelectorAll('button')].at(-1))
        await click(screen.getAllByText(locale === 'en' ? 'Issue invoice' : 'إصدار الفاتورة')[0])
      }
      fireEvent.keyDown(dialog(), { key: 'Escape' })
      cleanup()
      for (const state of ['missing-admin', 'missing-rep'] as const) {
        render(await page(locale, { issuer: state }, undefined, undefined, 'new'))
        billEnv.issuer = state
        await addLine('ייעוץ עסקי', '500')
        await click(screen.getAllByText(locale === 'en' ? 'Issue invoice' : 'إصدار الفاتورة')[0])
        if (state === 'missing-admin') {
          await click(screen.getByText(locale === 'en' ? 'Save and continue' : 'حفظ ومتابعة'))
          const text = scan('identityErrors')
          if (locale === 'en') has(text, 'Before you issue your first invoice', 'Business name', 'Business type', 'Licensed dealer (Osek Murshe)', 'Business name is required', 'Choose a business type', 'Business / Company ID is required', 'These details will appear on the documents you issue')
          if (locale === 'en') expect(dialog().querySelector('input')!.getAttribute('placeholder')).toBe('For example: Rachel Cohen Consulting')
        } else if (locale === 'en') has(scan('setup'), 'Business details are needed first', 'Only the account admin can do this', 'Got it')
        else scan('setup')
        cleanup()
      }
      expect(hebrewIn(H.toasts), `${locale} toasts ${JSON.stringify(H.toasts)}`).toBe(false)
      if (locale === 'en') expect(H.toasts.map((t) => t[1])).toEqual(['The amount received cannot be more than the document total', 'Complete the business details', 'The invoice has already been issued', "Couldn't issue the invoice", "Couldn't issue the invoice", "Couldn't issue the invoice"])
      H.toasts.length = 0
    }
  })

  test('draft and issued: delete / issue confirmations, expired lock, send dialog (+expired), banner, PDF chip after the poll', async () => {
    for (const locale of ['en', 'ar'] as const) {
      const en = locale === 'en'
      render(await page(locale, {}))
      await click(screen.getByText(en ? 'Delete draft' : 'حذف المسودة'))
      expect(regionOf(dialog())).toEqual([locale, DIR[locale]])
      expect(leaks(dialog())).toEqual([])
      if (en) has(textOf(dialog()), 'Delete the draft? This cannot be undone.')
      fireEvent.keyDown(dialog(), { key: 'Escape' })
      await click(screen.getAllByText(en ? 'Issue invoice' : 'إصدار الفاتورة')[0])
      expect(regionOf(dialog())).toEqual([locale, DIR[locale]])
      expect(leaks(dialog())).toEqual([])
      cleanup()
      const expired = render(await page(locale, {}, undefined, EXPIRED))
      expect(leaks(expired.container)).toEqual([])
      if (en) has(textOf(expired.container), 'Renewing your subscription brings back issuing invoices')
      cleanup()
      sessionStorage.setItem('billing.justIssued.9', '1')
      render(await page(locale, { invoice: ISSUED_RECEIPT, document: pdfDoc('ready') }))
      await wait(0)
      if (en) has(textOf(byTestId('post-issue-send-banner')), 'The invoice/receipt is ready', 'Send it to the customer now?', 'Send invoice/receipt', 'Later')
      await click(byTestId('post-issue-send-banner-send'))
      fireEvent.change(byTestId('send-invoice-recipient'), { target: { value: 'nope' } })
      await click(screen.getByText(en ? 'More options' : 'خيارات إضافية', { selector: '[role="dialog"] button' }))
      expect(regionOf(dialog())).toEqual([locale, DIR[locale]])
      expect(leaks(dialog()), `${locale} send`).toEqual([])
      if (en) has(textOf(dialog()), 'Send invoice/receipt', 'Invoice/receipt #00042', 'The customer will get an email', 'Email address to send to', 'Hide more options', 'Personal message (optional)')
      if (en) expect(byTestId('send-invoice-submit').getAttribute('title')).toBe('Enter a valid email address')
      fireEvent.change(byTestId('send-invoice-recipient'), { target: { value: 'yossi@example.test' } })
      for (const reason of [undefined, 'rate_limited', 'pdf_not_ready', 'throw']) {
        billEnv.results.sendInvoiceEmailAction = reason
        await click(byTestId('send-invoice-submit'))
        if (!document.querySelector('[data-testid="send-invoice-submit"]')) await click(byTestId('post-issue-send-banner-send'))
      }
      cleanup()
      render(await page(locale, { invoice: ISSUED, document: pdfDoc('ready') }, undefined, EXPIRED))
      await click(screen.getByText(en ? 'Send invoice' : 'إرسال الفاتورة'))
      expect(regionOf(dialog())).toEqual([locale, DIR[locale]])
      expect(leaks(dialog()), `${locale} send expired`).toEqual([])
      cleanup()
      const live = render(await page(locale, { invoice: ISSUED, document: pdfDoc('rendering'), pdfStatus: { status: 'failed', url: null, errorReason: 'boom' } }))
      billEnv.pdfStatus = { status: 'failed', url: null, errorReason: 'boom' }
      await wait(1700)
      expect(leaks(live.container)).toEqual([])
      has(textOf(live.container), en ? 'Generation failed' : 'خطأ في الإنشاء')
      cleanup()
      expect(hebrewIn(H.toasts), `${locale} toasts ${JSON.stringify(H.toasts)}`).toBe(false)
      if (en) expect(H.toasts.filter((t) => t[0] !== 'loading').map((t) => t[1])).toEqual(['Invoice sent', 'A request was just sent — try again in a few seconds', 'The PDF file is not ready yet', "Couldn't send the invoice"])
      H.toasts.length = 0
    }
  })
})

describe('language switch and hydration', () => {
  test('the editor re-renders in the new language within one session', async () => {
    const node = await withBillEnv({}, () => newInvoicePage())
    const v = render(await billShell('en', node))
    has(textOf(v.container), 'New invoice', 'Save draft')
    v.rerender(await billShell('ar', node))
    has(textOf(v.container), 'فاتورة جديدة', 'حفظ المسودة')
    expect(regionOf(v.container.firstElementChild)).toEqual(['ar', 'rtl'])
    v.rerender(await billShell('he', node))
    has(textOf(v.container), 'חשבונית חדשה', 'שמור טיוטה')
    expect(v.container.firstElementChild?.getAttribute('lang')).toBeNull()
  })

  for (const locale of ['he', 'en', 'ar'] as const) {
    for (const [name, overrides, which] of [['new', {}, 'new'], ['draft', {}, 'invoice'], ['issued', { invoice: ISSUED, document: pdfDoc('ready') }, 'invoice']] as const) {
      test(`hydration ${locale} · ${name}`, async () => {
        const node = await page(locale, overrides as Partial<typeof billEnv>, undefined, undefined, which)
        const container = document.createElement('div')
        container.innerHTML = renderToString(node)
        document.body.appendChild(container)
        const errors: unknown[] = []
        const spy = vi.spyOn(console, 'error').mockImplementation((...a) => errors.push(a))
        let root: ReturnType<typeof hydrateRoot> | undefined
        await act(async () => {
          root = hydrateRoot(container, node, { onRecoverableError: (e) => errors.push(e) })
        })
        spy.mockRestore()
        expect(errors.map((e) => (Array.isArray(e) ? e.map(String).join(' ') : String(e)).slice(0, 400))).toEqual([])
        act(() => root!.unmount())
        container.remove()
      })
    }
  }
})
