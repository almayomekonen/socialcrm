// @vitest-environment jsdom
import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from 'vitest'
import { renderToString } from 'react-dom/server'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { billEnv, document as pdfDoc, DRAFT_RECEIPT, ISSUED_RECEIPT, LINES, NOW, resetBillEnv } from './billingEnv'

/**
 * Billing screens (Phase E3) behave identically in every language: each action
 * receives the same arguments (stored codes, typed data untouched), disabled
 * reasons and validation are worded in the interface language, dialogs close on
 * Escape and return focus, the producers keep Hebrew byte-identical, and the
 * LEGAL document (the PDF HTML) never takes the interface language.
 */

const H = vi.hoisted(() => ({ prefs: { userLocale: 'en' as string | null }, toasts: [] as unknown[][], nav: [] as string[] }))
vi.mock('next/navigation', () => ({
  usePathname: () => '/clients/41/billing/new',
  useRouter: () => ({ push: (to: string) => H.nav.push(to), replace: () => {}, refresh: () => H.nav.push('refresh') }),
  useSearchParams: () => new URLSearchParams(''),
  redirect: (to: string) => {
    throw new Error('REDIRECT ' + to)
  },
}))
vi.mock('@/lib/toast', async () => ({ ...(await vi.importActual<typeof import('@/lib/toast')>('@/lib/toast')), toast: (...a: unknown[]) => H.toasts.push(a), proToast: () => {} }))
vi.mock('@/db/auth', async () => ({ getUser: async () => (await import('./billingEnv')).billEnv.user }))
vi.mock('@/lib/requireUser', async () => ({ requireUser: async () => (await import('./billingEnv')).billEnv.user }))
vi.mock('@/db/uiLocale', () => ({ getUiLocalePrefs: async () => ({ userLocale: H.prefs.userLocale, agencyLocale: null }) }))
vi.mock('@/lib/device', () => ({ isMobileRequest: async () => false, isMobileWorkspaceRequest: async () => false }))
vi.mock('@/db/filter', () => ({ getPerms: async () => ({ gotPermIds: [12], gotPermUsers: [], allPermUsers: [] }) }))
vi.mock('@/lib/access/productAccess', async () => ({ getAgencyProductAccess: async () => ({ hasAccess: true }) }))
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

type Loc = 'he' | 'en' | 'ar'
const LOCALES: Loc[] = ['he', 'en', 'ar']
const ISSUE = { he: 'הנפק חשבונית', en: 'Issue invoice', ar: 'إصدار الفاتورة' }
const byTestId = (id: string) => document.querySelector(`[data-testid="${id}"]`) as HTMLInputElement
const dialog = () => [...document.querySelectorAll('[role="dialog"]')].pop() as HTMLElement
const lastButton = () => [...dialog().querySelectorAll('button')].at(-1)!
const click = async (el: Element | null | undefined) => act(async () => void fireEvent.click(el!))
const titles = () => [...document.querySelectorAll('.fixed button')].map((b) => b.getAttribute('title'))
const hebrewIn = (v: unknown) => /[֐-׿]/.test(JSON.stringify(v))

async function mount(locale: Loc, overrides: Partial<typeof billEnv> = {}, which: 'new' | 'invoice' = 'new', kind?: string) {
  H.prefs.userLocale = locale
  const node = await withBillEnv(overrides, () => (which === 'new' ? newInvoicePage(kind) : invoicePage()))
  Object.assign(billEnv, overrides) // client-side reads (issuer step, PDF poll) see the same fixtures
  return render(await billShell(locale, node))
}
async function addLine(title: string, price: string, description = '') {
  fireEvent.change(byTestId('invoice-newline-title'), { target: { value: title } })
  if (description) fireEvent.change(byTestId('invoice-newline-description'), { target: { value: description } })
  fireEvent.change(byTestId('invoice-newline-unit-price'), { target: { value: price } })
  await act(async () => fireEvent.keyDown(byTestId('invoice-newline-title'), { key: 'Enter' }))
}
const callsBy = async (run: (locale: Loc) => Promise<void>) => {
  const out: Record<string, unknown> = {}
  for (const locale of LOCALES) {
    await run(locale)
    out[locale] = structuredClone(billEnv.calls)
    cleanup()
    resetBillEnv()
    sessionStorage.clear()
  }
  return out as Record<Loc, unknown[][]>
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
  H.nav.length = 0
})

describe('every action receives the same arguments in he / en / ar', () => {
  test('new invoice/receipt: save draft and issue (payment method sent as its stored code)', async () => {
    const calls = await callsBy(async (locale) => {
      await mount(locale, {}, 'new', 'invoice_receipt')
      await addLine('ייעוץ עסקי', '500', 'פגישה של שעתיים')
      fireEvent.change(document.querySelector('section.p-5 select')!, { target: { value: 'cash' } })
      await click(screen.getAllByText(ISSUE[locale])[0])
      await click(lastButton())
      await click(document.querySelectorAll('.fixed button')[1])
    })
    expect(calls.en).toEqual(calls.he)
    expect(calls.ar).toEqual(calls.he)
    const payload = (calls.he.find((c) => c[0] === 'saveAndIssueTransientAction')![1] as { payment: { method: string }; lines: { title: string }[] })
    expect(payload.payment.method).toBe('cash')
    expect(payload.lines[0].title).toBe('ייעוץ עסקי')
    expect(calls.he.map((c) => c[0])).toEqual(['saveAndIssueTransientAction', 'saveTransientDraftAction'])
  })

  test('draft editor: line add / update / remove, options, payment, delete, issue', async () => {
    const calls = await callsBy(async (locale) => {
      const { container } = await mount(locale, { invoice: DRAFT_RECEIPT }, 'invoice')
      await addLine('שעת עבודה', '300')
      const title = container.querySelector('[data-testid="invoice-line-title"]')!
      fireEvent.change(title, { target: { value: 'ייעוץ עסקי מורחב' } })
      await act(async () => fireEvent.blur(title))
      fireEvent.click(container.querySelector('[data-testid="invoice-line-delete"]')!)
      await click(lastButton())
      await act(async () => fireEvent.change(document.querySelector('section.p-5 select')!, { target: { value: 'check' } }))
      await act(async () => fireEvent.submit(container.querySelector('details form')!))
      await click(screen.getAllByText(ISSUE[locale])[0])
      await click(lastButton())
      await click(document.querySelector('.fixed button'))
      await click(lastButton())
    })
    expect(calls.en).toEqual(calls.he)
    expect(calls.ar).toEqual(calls.he)
    expect(calls.he.map((c) => c[0])).toEqual(['addLineAction', 'updateLineAction', 'removeLineAction', 'updateDraftKindAndPaymentAction', 'updateDraftMetaAction', 'issueInvoiceAction', 'deleteDraftAction'])
    expect((calls.he[3][1] as { paymentMethod: string }).paymentMethod).toBe('check')
  })

  test('issued view: send (typed message untouched), duplicate, re-render', async () => {
    const SEND = { he: 'שלח חשבונית', en: 'Send invoice', ar: 'إرسال الفاتورة' }
    const RETRY = { he: 'נסה שוב', en: 'Try again', ar: 'إعادة المحاولة' }
    const DUP = { he: 'צור חשבונית חדשה מבוססת על זו', en: 'Create a new invoice based on this one', ar: 'إنشاء فاتورة جديدة استنادًا إلى هذه' }
    const seen: unknown[][] = []
    const calls = await callsBy(async (locale) => {
      await mount(locale, { invoice: ISSUED_RECEIPT, document: pdfDoc('failed') }, 'invoice')
      await click(screen.getByText(RETRY[locale]))
      await click(screen.getByText(DUP[locale]))
      seen.push(...structuredClone(billEnv.calls)) // the next mount starts a fresh call log
      cleanup()
      await mount(locale, { invoice: ISSUED_RECEIPT, document: pdfDoc('ready') }, 'invoice')
      billEnv.calls.unshift(...seen.splice(0))
      await click(screen.getByText(SEND[locale]))
      fireEvent.click(dialog().querySelectorAll('button')[1])
      fireEvent.change(dialog().querySelector('textarea')!, { target: { value: 'שלום יוסי, מצורף' } })
      await click(byTestId('send-invoice-submit'))
    })
    expect(calls.en).toEqual(calls.he)
    expect(calls.ar).toEqual(calls.he)
    expect(calls.he.map((c) => c[0])).toEqual(['rerenderInvoicePdfAction', 'duplicateInvoiceAction', 'sendInvoiceEmailAction'])
    expect(calls.he[2][1]).toEqual({ invoiceId: 9, leadId: 41, recipientEmail: 'yossi@example.test', customMessage: 'שלום יוסי, מצורף' })
  })

  test('issuer identity: the stored business-type CODE and the typed values', async () => {
    const SAVE = { he: 'שמור והמשך', en: 'Save and continue', ar: 'حفظ ومتابعة' }
    const calls = await callsBy(async (locale) => {
      await mount(locale, { issuer: 'missing-admin' })
      await addLine('ייעוץ עסקי', '500')
      await click(screen.getAllByText(ISSUE[locale])[0])
      const inputs = dialog().querySelectorAll('input[type="text"]')
      fireEvent.change(inputs[0], { target: { value: 'רחל כהן ייעוץ' } })
      fireEvent.click(dialog().querySelector('input[value="company"]')!)
      fireEvent.change(inputs[1], { target: { value: '51 412 345' } })
      await click(screen.getByText(SAVE[locale]))
    })
    expect(calls.en).toEqual(calls.he)
    expect(calls.ar).toEqual(calls.he)
    expect(calls.he).toEqual([['updateIssuerIdentityAction', { name: 'רחל כהן ייעוץ', businessType: 'company', taxId: '51412345' }]])
  })
})

describe('reasons and validation are worded in the interface language', () => {
  test('disabled-reason titles: no lines, zero total, payment missing, no permission', async () => {
    const out: Record<string, unknown> = {}
    for (const locale of LOCALES) {
      await mount(locale, {}, 'new', 'invoice_receipt')
      const empty = titles()
      await addLine('ייעוץ עסקי', '500')
      const payment = titles()
      cleanup()
      sessionStorage.clear()
      await mount(locale, { user: { ...billEnv.user, role: 'AGNT' } })
      await addLine('ייעוץ עסקי', '0')
      out[locale] = [empty, payment, titles()]
      cleanup()
      sessionStorage.clear()
    }
    expect(out.he).toEqual([[null, 'יש להוסיף לפחות פריט אחד לפני שמירה', 'יש להוסיף לפחות פריט אחד'], [null, null, 'יש למלא את פרטי התשלום שהתקבל'], [null, null, 'אין הרשאה להנפיק']])
    expect(out.en).toEqual([[null, 'Add at least one item before saving', 'Add at least one item'], [null, null, 'Fill in the payment received'], [null, null, "You don't have permission to issue"]])
    expect(hebrewIn(out.ar)).toBe(false)
  })

  test('issuer validation (blur and submit) in en / ar; Hebrew is the registry sentence', async () => {
    const SAVE = { he: 'שמור והמשך', en: 'Save and continue', ar: 'حفظ ومتابعة' }
    const out: Record<string, string[]> = {}
    for (const locale of LOCALES) {
      await mount(locale, { issuer: 'missing-admin' })
      await addLine('ייעוץ עסקי', '500')
      await click(screen.getAllByText(ISSUE[locale])[0])
      await click(screen.getByText(SAVE[locale]))
      const submitErrors = [...dialog().querySelectorAll('.text-red-600, [class*="text-red"]')].map((e) => e.textContent ?? '')
      const tax = dialog().querySelectorAll('input[type="text"]')[1]
      fireEvent.change(tax, { target: { value: '12-34' } })
      fireEvent.blur(tax)
      out[locale] = [...submitErrors, ...[...dialog().querySelectorAll('[class*="text-red"]')].map((e) => e.textContent ?? '')]
      cleanup()
      sessionStorage.clear()
    }
    expect(out.he.join('|')).toContain('שם העסק חובה')
    expect(out.he.join('|')).toContain('מספר עוסק / ח.פ לא נראה תקין')
    expect(out.en.join('|')).toContain('Business name is required')
    expect(out.en.join('|')).toContain("The Business / Company ID doesn't look valid")
    expect(out.en.length).toBe(out.he.length)
    expect(hebrewIn(out.en) || hebrewIn(out.ar)).toBe(false)
  })
})

describe('dialogs: Escape closes and focus returns; named controls', () => {
  test('issue confirmation and send dialog close on Escape and return focus to their opener (en)', async () => {
    await mount('en', {})
    await addLine('ייעוץ עסקי', '500')
    const issueBtn = screen.getAllByText('Issue invoice')[0].closest('button')!
    issueBtn.focus()
    await click(issueBtn)
    expect(dialog()).toBeTruthy()
    expect(dialog().querySelector('button[aria-label="Close"]')).not.toBeNull()
    await act(async () => fireEvent.keyDown(dialog(), { key: 'Escape' }))
    expect(document.querySelector('[role="dialog"]')).toBeNull()
    expect(document.activeElement).toBe(issueBtn)
    cleanup()
    await mount('ar', { invoice: ISSUED_RECEIPT, document: pdfDoc('ready') }, 'invoice')
    const send = screen.getByText('إرسال الفاتورة').closest('button')!
    send.focus()
    await click(send)
    expect(dialog().getAttribute('aria-label')).toBe('إرسال فاتورة')
    expect(dialog().querySelector('button[aria-label]')!.getAttribute('aria-label')).not.toMatch(/[֐-׿]/)
    await act(async () => fireEvent.keyDown(dialog(), { key: 'Escape' }))
    expect(document.querySelector('[role="dialog"]')).toBeNull()
    expect(document.activeElement).toBe(send)
  })
})

describe('producers: Hebrew byte-identical, codes in, words out', () => {
  test('issue errors, kinds, payment methods, PDF chips', async () => {
    const { issueErrorMessage } = await import('@/lib/billing/issueErrorMessages')
    const { documentKindDisplay, paymentMethodDisplay, paymentMethodOptions } = await import('@/components/billing/labels')
    const { documentKindLabel } = await import('@/lib/billing/documentKinds')
    const methods = await import('@/lib/billing/payment/methods')
    const { PdfStatusChip } = await import('@/components/billing/chips')
    const { he } = await import('@/lib/i18n/messages/he')
    const reasons = Object.keys(he.billing.issueError)
    for (const r of reasons) expect(issueErrorMessage(r), r).toBe(he.billing.issueError[r as keyof typeof he.billing.issueError])
    expect(issueErrorMessage('invoice_not_draft', 'en')).toBe('The invoice has already been issued')
    expect(issueErrorMessage('weird', 'en')).toBe(issueErrorMessage(undefined, 'en'))
    expect(hebrewIn([...reasons, 'weird'].map((r) => issueErrorMessage(r, 'ar')))).toBe(false)
    for (const k of ['invoice', 'invoice_receipt', null, 'legacy']) expect(documentKindDisplay(k as never)).toBe(documentKindLabel(k as never))
    expect(['invoice', 'invoice_receipt'].map((k) => documentKindDisplay(k as never, 'en'))).toEqual(['Invoice', 'Invoice/receipt'])
    for (const m of [...methods.PAYMENT_METHODS, 'barter', '', null]) expect(paymentMethodDisplay(m)).toBe(methods.paymentMethodLabel(m))
    expect(paymentMethodOptions()).toEqual(methods.PAYMENT_METHOD_OPTIONS.map((o) => ({ id: o.value, name: o.label })))
    expect(paymentMethodOptions('en').map((o) => o.id)).toEqual([...methods.PAYMENT_METHODS])
    expect(paymentMethodDisplay('barter', 'en')).toBe('')
    expect(paymentMethodOptions('en').find((o) => o.id === 'other')!.name).toBe('Other')
    const chip = (locale: Loc) => (['not_applicable', 'scheduled', 'rendering', 'ready', 'failed'] as const).map((s) => renderToString(<PdfStatusChip status={s} locale={locale} />))
    expect(chip('he')).toEqual((['not_applicable', 'scheduled', 'rendering', 'ready', 'failed'] as const).map((s) => renderToString(<PdfStatusChip status={s} />)))
    expect(hebrewIn(chip('en')) || hebrewIn(chip('ar'))).toBe(false)
  })

  test('the issuer registry: Hebrew catalog pinned to it; localized copies keep keys, codes, validators', async () => {
    const fields = await import('@/lib/billing/issuer/fields')
    const { TAX_ID_LOOKS_INVALID } = await import('@/lib/billing/issuer/taxId')
    const { localizeIssuerFields, localizeIssuerError } = await import('@/components/billing/issuer/localizedFields')
    const { he } = await import('@/lib/i18n/messages/he')
    const I = he.billing.issuer
    const tier1 = fields.fieldsByTier([1])
    expect(tier1.map((f) => [f.key, f.label, f.helpText, f.placeholder])).toEqual([
      ['name', I.field.name.label, I.field.name.help, I.field.name.placeholder],
      ['businessType', I.field.businessType.label, I.field.businessType.help, undefined],
      ['taxId', I.field.taxId.label, I.field.taxId.help, '123456789'],
    ])
    expect(fields.BUSINESS_TYPE_OPTIONS.map((o) => [o.label, o.description])).toEqual(['exempt', 'authorized', 'company'].map((c) => [I.businessType[c as 'exempt'].label, I.businessType[c as 'exempt'].description]))
    const messages = [fields.getFieldByKey('name')!.validate('', {}), fields.getFieldByKey('businessType')!.validate(null, {}), fields.getFieldByKey('taxId')!.validate('', {}), TAX_ID_LOOKS_INVALID, fields.getFieldByKey('email')!.validate('x', {})]
    expect(messages).toEqual(Object.values(I.error))
    expect(localizeIssuerFields(tier1, 'he')).toBe(tier1)
    const en = localizeIssuerFields(fields.fieldsByTier([1, 2]), 'en')
    en.forEach((f, i) => {
      const src = fields.fieldsByTier([1, 2])[i]
      expect([f.key, f.tier, f.inputType, f.validate, f.sanitize]).toEqual([src.key, src.tier, src.inputType, src.validate, src.sanitize])
      expect(f.options?.map((o) => o.value)).toEqual(src.options?.map((o) => o.value))
    })
    expect(hebrewIn(en.filter((f) => f.tier === 1).map((f) => [f.label, f.helpText, f.placeholder, f.options]))).toBe(false)
    // Tier 2 (settings → business details) is worded too since Phase E4; a Latin-script sample placeholder keeps the registry's.
    expect(hebrewIn(en.filter((f) => f.tier === 2).map((f) => [f.label, f.helpText, f.placeholder]))).toBe(false)
    expect(en.filter((f) => f.tier === 2).map((f) => [f.key, f.placeholder === fields.getFieldByKey(f.key)!.placeholder])).toEqual([['address', false], ['phone', true], ['email', true], ['img', true]])
    for (const m of messages) expect(localizeIssuerError(m as string, 'he')).toBe(m)
    expect(hebrewIn(messages.map((m) => localizeIssuerError(m as string, 'ar')))).toBe(false)
    expect(localizeIssuerError('server said no', 'en')).toBe('server said no')
  })
})

describe('the LEGAL document never takes the interface language', () => {
  test('the PDF HTML is Hebrew (legal title, payment method) and identical with an English interface', async () => {
    const { renderInvoiceHtml } = await import('@/lib/billing/pdf/html/InvoiceTemplate')
    const input = { invoice: structuredClone(ISSUED_RECEIPT) as never, lines: structuredClone(LINES) as never, issuer: null, fallbackName: 'רחל כהן ייעוץ' }
    H.prefs.userLocale = null
    const before = await renderInvoiceHtml(input)
    H.prefs.userLocale = 'en'
    await mount('en', { invoice: ISSUED_RECEIPT, document: pdfDoc('ready') }, 'invoice')
    const after = await renderInvoiceHtml(input)
    expect(after).toBe(before)
    expect(after).toContain('חשבונית מס/קבלה')
    expect(after).toContain('כרטיס אשראי')
    for (const english of ['Credit card', 'Invoice/receipt', 'Total due', 'Payment received']) expect(after).not.toContain(english)
  })
})
