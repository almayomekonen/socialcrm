// @vitest-environment jsdom
import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { NOW, ROWS, TBL_PREF_USER } from './leadsFixtures'

/**
 * A translated leads UI drives the SAME logic with the SAME stable values:
 * status codes, stored column preferences, search/sort/filter/pagination,
 * and Hebrew-by-default label producers (Phase C).
 */

const H = vi.hoisted(() => ({
  updateLead: vi.fn(async () => ({ ok: true })),
  /** A server action serializes its arguments when called — record them the same way. */
  saved: [] as unknown[],
  saveTblPref: vi.fn(async (...args: unknown[]) => {
    H.saved.push(structuredClone(args))
    return { ok: true }
  }),
  push: vi.fn(),
  replace: vi.fn(),
  toast: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  usePathname: () => '/leads',
  useRouter: () => ({ push: H.push, replace: H.replace, refresh: () => {} }),
  useSearchParams: () => new URLSearchParams(''),
  redirect: () => {},
}))
vi.mock('@/actions/clients', () => ({ fetchLeadsSince: async () => [], searchContacts: async () => [], searchLeads: async () => [], updateLead: H.updateLead }))
vi.mock('@/actions/global', () => ({ saveTblPref: H.saveTblPref }))
// The export dialog's image picker loads the user's gallery on mount (I/O only).
vi.mock('@/actions/files', () => ({ getUserImgs: async () => [] }))
vi.mock('@/actions/analytics/recordLeadActionEvent', () => ({ recordLeadActionEvent: async () => {} }))
vi.mock('@/lib/toast', () => ({ toast: H.toast, proToast: () => {}, setToastDefaults: () => {}, resetToastDefaults: () => {} }))

const { default: ClientsTable } = await import('@/components/clients/clientsTable')
const { default: TableFooter } = await import('@/lib/table/TableFooter')
const { shell } = await import('./leadsHarness')

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

beforeAll(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
})
afterAll(() => vi.useRealTimers())
afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

type Loc = 'he' | 'en' | 'ar'
const table = async (locale: Loc, user: unknown = null, extra: Record<string, unknown> = {}) =>
  render(await shell(locale, <ClientsTable data={ROWS} user={user} leads {...extra} />))
const headers = (c: HTMLElement) => Array.from(c.querySelectorAll('thead th')).map((th) => th.textContent?.trim()).filter(Boolean)
const firstNames = (c: HTMLElement) => Array.from(c.querySelectorAll('tbody tr a')).map((a) => a.textContent)

describe('status: labels are translated, the change path receives the CODE', () => {
  test('English option text, `contacted` sent to updateLead', async () => {
    const { container } = await table('en')
    const select = container.querySelector<HTMLSelectElement>('tbody select')!
    const contacted = Array.from(select.options).find((o) => o.value === 'contacted')!
    expect(contacted.textContent).toBe('In progress')
    await act(async () => {
      fireEvent.change(select, { target: { value: 'contacted' } })
    })
    expect(H.updateLead).toHaveBeenCalledTimes(1)
    expect(H.updateLead.mock.calls[0]).toContainEqual({ id: 1, status: 'contacted' })
    expect(screen.getByTestId('lead-status-announce').textContent).toBe('Status updated')
  })
})

describe('user.tblPref: displayed by key, saved exactly as stored', () => {
  test('stored Hebrew labels show as English headers (the stale stored label too)', async () => {
    const { container } = await table('en', TBL_PREF_USER)
    expect(headers(container).slice(0, 4)).toEqual(['Status', 'Full name', 'Phone number', 'Source'])
    const he = await table('he', TBL_PREF_USER)
    // Hebrew keeps showing the stored label, as it always has ('טלפון', not today's 'מספר טלפון').
    expect(headers(he.container).slice(0, 4)).toEqual(['סטטוס', 'שם מלא', 'טלפון', 'מקור'])
  })

  async function reorderAndToggle(locale: Loc) {
    const { container, unmount } = await table(locale, structuredClone(TBL_PREF_USER))
    const ths = container.querySelectorAll('thead th[draggable]')
    fireEvent.dragStart(ths[0])
    fireEvent.dragEnter(ths[1])
    fireEvent.dragEnd(ths[0])
    const input = within(container).getByLabelText(locale === 'he' ? 'עמודות לצפיה' : 'Visible columns', { exact: false })
    fireEvent.focus(input)
    const email = Array.from(container.querySelectorAll('button')).find((b) => b.textContent === (locale === 'he' ? 'מייל' : 'Email'))!
    fireEvent.mouseDown(email)
    const saved = H.saved.splice(0)
    unmount()
    vi.clearAllMocks()
    return saved
  }

  test('reorder + show/hide save the same stored objects in English as in Hebrew', async () => {
    const he = await reorderAndToggle('he')
    const en = await reorderAndToggle('en')
    expect(he.length).toBe(2)
    expect(en).toEqual(he)
    // Stored shape: Hebrew labels as saved, keyed by column, no translated text.
    const [tblId, cols] = en[0] as [string, { key: string; label: string }[]]
    expect(tblId).toBe('leadsTable435')
    expect(cols.slice(0, 3)).toEqual([
      { key: 'name', label: 'שם מלא', format: 'formatName' },
      { key: 'status', label: 'סטטוס', format: 'formatStatus' },
      { key: 'phone', label: 'טלפון' },
    ])
    for (const call of en) for (const c of (call as [string, { label: string }[]])[1]) expect(c.label).toMatch(/[\u0590-\u05ff]/)
  })
})

describe('search, sort, filter and pagination keep working in English', () => {
  test('status tab filters; sort reorders; search writes ?q=; clear search links to ?', async () => {
    const { container } = await table('en')
    expect(firstNames(container)).toEqual(['דנה כהן', 'יוסי לוי', 'מיכל אברהם'])
    fireEvent.click(screen.getByRole('button', { name: /^In progress/ }))
    expect(firstNames(container)).toEqual(['אבי מזרחי', 'רונית גבאי'])
    fireEvent.change(screen.getByLabelText('Sort leads'), { target: { value: 'newest' } })
    expect(firstNames(container)).toEqual(['רונית גבאי', 'אבי מזרחי'])
    expect(container.querySelector('a[aria-label="Clear search"]')!.getAttribute('href')).toBe('?')
    // The toolbar search is the first picker on the page (the columns picker shares the placeholder).
    const box = screen.getAllByPlaceholderText('Search…')[0]
    await act(async () => {
      fireEvent.change(box, { target: { value: 'דנה' } })
      await new Promise((r) => setTimeout(r, 350))
    })
    expect(H.push).toHaveBeenCalledWith(`?q=${encodeURIComponent('דנה')}`, { scroll: false })
  })

  test('pagination: next page and page size', async () => {
    const { Provider } = await import('@/lib/hooksNEvents')
    render(
      await shell(
        'en',
        <Provider props={{ tableLength: 100, params: { pageNum: '1', tableLimit: '100' } }}>
          <TableFooter />
        </Provider>,
      ),
    )
    expect(screen.getByText('100 records')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    expect(H.push).toHaveBeenCalledWith('?pageNum=2&tableLimit=100', { scroll: false })
    fireEvent.change(screen.getByRole('combobox'), { target: { value: '500' } })
    expect(H.push).toHaveBeenLastCalledWith('?pageNum=1&tableLimit=500', { scroll: false })
  })
})

describe('dialogs declare the interface language; untranslated ones do not', () => {
  test('quota paywall in English: lang/dir on the dialog, content translated', async () => {
    const { default: QuotaPaywallModal } = await import('@/components/quota/QuotaPaywallModal')
    render(await shell('en', <QuotaPaywallModal state={{ current: 48, limit: 50, attempted: 7 }} onClose={() => {}} />))
    const dialog = await screen.findByRole('dialog')
    expect(dialog.getAttribute('lang')).toBe('en')
    expect(dialog.getAttribute('dir')).toBe('ltr')
    expect(dialog.getAttribute('aria-label')).toBe('Lead limit')
    expect(dialog.textContent).toContain('The file has 7 leads; only 2 remain in the free plan.')
    expect(within(dialog).getByRole('button', { name: 'Close' })).toBeTruthy()
  })

  test('a dialog that is not marked translated keeps inheriting Hebrew', async () => {
    const { default: ModalPop } = await import('@/lib/modals/ModalPop')
    render(await shell('en', <ModalPop open onClose={() => {}} label='x'>תוכן</ModalPop>))
    expect((await screen.findByRole('dialog')).hasAttribute('lang')).toBe(false)
  })
})

describe('label producers: Hebrew by default, interface language on request', () => {
  test('delete results, block reasons, intake copy, sources, deal labels', async () => {
    const { deleteLeadsMessage, blockReasonText } = await import('@/lib/leads/deleteResult')
    const { intakeErrorCopy } = await import('@/lib/automations/connectors/intakeErrors')
    const { leadSourceLabel } = await import('@/lib/leads/leadSourceLabel')
    const { getDealActionLabel } = await import('@/components/clients/funcs')
    const r = { deletedCount: 3, blockedCount: 1, blockedLeads: [{ id: 1, name: 'א', reason: 'invoices' as const }] }
    expect(deleteLeadsMessage(r).msg).toBe('נמחקו 3 לידים. ליד אחד לא נמחק כי קיימות חשבוניות עבור הליד')
    expect(deleteLeadsMessage(r, 'en').msg).toBe("3 leads deleted. 1 lead wasn't deleted because it has invoices")
    expect(deleteLeadsMessage({ deletedCount: 11, blockedCount: 0, blockedLeads: [] }, 'ar').msg).toBe('تم حذف 11 عميلًا محتملًا بنجاح')
    expect(blockReasonText('billing_profile')).toBe('קיים פרופיל חיוב פעיל')
    expect(intakeErrorCopy('invalid_signature')?.title).toBe('יש בעיה בחיבור לטופס באתר')
    expect(intakeErrorCopy('invalid_signature', 'en')?.title).toBe("There's a problem with your website form connection")
    expect(intakeErrorCopy('not_actionable', 'en')).toBeNull()
    expect(['המלצה', 'utm_x', 'ידני'].map((s) => leadSourceLabel(s, 'en'))).toEqual(['Referral', 'utm_x', 'Manual'])
    expect(['המלצה', 'utm_x'].map((s) => leadSourceLabel(s))).toEqual(['המלצה', 'utm_x'])
    expect(getDealActionLabel('closed', 'en')).toBe('Add another deal')
    expect(getDealActionLabel('closed')).toBe('הוסף עסקה נוספת')
  })
})
