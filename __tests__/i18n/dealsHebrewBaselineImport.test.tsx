// @vitest-environment jsdom
import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from 'vitest'
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { DEALS_USER, NOW, PERM_TEAMS, PERM_USERS, RICH_FILTER, dealsEnv, resetDealsEnv } from './dealsEnv'
import { dealsSpies, resetDealsSpies } from './dealsMocks'
import { dealsShell } from './dealsHarness'
import { EXPIRED } from './leadTabsEnv'

/**
 * HEBREW BASELINE for the deal import dialog (`UploadDealsData`) and the shared
 * sales filter used by /deals and every /sum_sales page (`Filter`, `FilterBtn`,
 * `FilterChips`, `SelectDateRange`). Recorded BEFORE Phase E2; Hebrew must stay
 * byte-identical, and the filter URL / stored values must stay what they are.
 */

vi.mock('next/navigation', async () => (await import('./dealsMocks')).navigationModule())
vi.mock('next/cache', () => ({ revalidatePath: () => {}, revalidateTag: () => {}, unstable_cache: (fn: unknown) => fn }))
vi.mock('@/actions/dealImport', async () => (await import('./dealsMocks')).dealImportModule())
vi.mock('@/actions/clients', async () => (await import('./dealsMocks')).clientsActionsModule())
vi.mock('@/actions/filter', async () => (await import('./dealsMocks')).filterActionsModule())
vi.mock('@/lib/toast', async () => (await import('./dealsMocks')).toastModule())

const html = (el: Element | null) => {
  if (!el) throw new Error('element not found')
  return el.outerHTML.replace(/«[^»]*»/g, '«id»').replace(/_[rR]_[0-9a-zA-Z]*_/g, '«id»').replace(/:r[0-9a-z]+:/g, '«id»')
}
const lastDialog = () => Array.from(document.querySelectorAll('[role="dialog"]')).at(-1) ?? null
const file = () => new File(['x'], 'deals.xlsx', { type: 'application/vnd.ms-excel' })

async function pick(container: HTMLElement) {
  await act(async () => {
    fireEvent.change(container.querySelector('input[type="file"]')!, { target: { files: [file()] } })
  })
}

beforeAll(() => {
  Object.assign(HTMLElement.prototype, { showPopover() {}, hidePopover() {}, togglePopover() {} })
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
})
afterAll(() => vi.useRealTimers())
afterEach(() => {
  cleanup()
  resetDealsEnv()
  resetDealsSpies()
})

const REJECTED = [
  { row: 4, reason: 'סכום חסר או לא תקין', label: '0501234567' },
  { row: 2, reason: 'סטטוס לא מוכר: אולי', label: '' },
]

describe('Hebrew baseline — deal import', () => {
  test('chooser, parse error from the server, unreadable file, confirmation, results, paywall, expired', async () => {
    const { default: UploadDealsData } = await import('@/components/sales/UploadDealsData')
    const out: Record<string, unknown> = {}
    let { container } = render(await dealsShell(null, <UploadDealsData />))
    out.chooser = html(container.firstElementChild)

    dealsSpies.uploadDealData.mockImplementation(async () => ({ data: [], wrongData: [], error: 'לא זיהינו עמודות מתאימות בקובץ.' }))
    await pick(container)
    out.serverError = html(lastDialog())
    await act(async () => fireEvent.click(lastDialog()!.querySelector('button:last-of-type')!))

    dealsSpies.uploadDealData.mockImplementation(async () => {
      throw new Error('boom')
    })
    await pick(container)
    out.unreadable = html(lastDialog())
    await act(async () => fireEvent.click(lastDialog()!.querySelector('button:last-of-type')!))

    dealsSpies.uploadDealData.mockImplementation(async () => ({ data: [], wrongData: REJECTED }))
    await pick(container)
    out.nothingValid = html(container.firstElementChild)

    const rows = [{ amount: 100 }, { amount: 200 }, { amount: 300 }]
    dealsSpies.uploadDealData.mockImplementation(async () => ({ data: rows, wrongData: REJECTED }))
    await pick(container)
    out.confirmWithWrong = html(lastDialog())
    dealsSpies.importDeals.mockImplementation(async () => ({ imported: 2, duplicates: 1, createdLeads: 1, rejected: [{ row: 3, reason: 'לא נמצא ליד תואם', label: 'a@b.co' }] }))
    await act(async () => fireEvent.click(Array.from(lastDialog()!.querySelectorAll('button')).find((b) => b.textContent === 'ייבוא עסקאות')!))
    out.result = html(container.firstElementChild)

    dealsSpies.uploadDealData.mockImplementation(async () => ({ data: rows, wrongData: [] }))
    await pick(container)
    out.confirmClean = html(lastDialog())
    dealsSpies.importDeals.mockImplementation(async () => {
      throw new Error('db')
    })
    await act(async () => fireEvent.click(Array.from(lastDialog()!.querySelectorAll('button')).find((b) => b.textContent === 'ייבוא עסקאות')!))
    out.importFailed = html(lastDialog())
    await act(async () => fireEvent.click(lastDialog()!.querySelector('button:last-of-type')!))

    await pick(container)
    dealsSpies.importDeals.mockImplementation(async () => ({ error: 'quota_exceeded', current: 50, limit: 50, attempted: 3 }))
    await act(async () => fireEvent.click(Array.from(lastDialog()!.querySelectorAll('button')).find((b) => b.textContent === 'ייבוא עסקאות')!))
    out.paywall = html(lastDialog())
    cleanup()

    ;({ container } = render(await dealsShell(null, <UploadDealsData />, EXPIRED)))
    await pick(container)
    out.toasts = dealsSpies.toasts
    out.calls = dealsSpies.calls
    expect(out).toMatchSnapshot()
  })
})

describe('Hebrew baseline — sales filter', () => {
  test('filter panel: defaults, custom date range fields, submit URL; reset', async () => {
    const { default: Filter } = await import('@/components/filter')
    const props = { users: PERM_USERS, teams: PERM_TEAMS, rawFilter: { dateRange: 'מותאם אישית', start: '2026-09-01', end: '2026-09-30', status: ['שולם'] }, handlers: PERM_USERS }
    const { container } = render(await dealsShell(null, <Filter props={props} />))
    const out: Record<string, unknown> = {}
    out.panel = html(container.firstElementChild)
    const range = container.querySelector('select[name="saleDtRange"]') as HTMLSelectElement
    fireEvent.change(range, { target: { value: 'מותאם אישית' } })
    out.customSaleDates = html(range.closest('div')!.parentElement)
    const status = Array.from(container.querySelectorAll('input[role="combobox"], input')).find((i) => (i as HTMLInputElement).placeholder && i.closest('div')?.textContent?.includes('סטטוס')) as HTMLInputElement
    if (status) {
      fireEvent.focus(status)
      out.statusOptions = html(status.closest('.relative'))
      fireEvent.blur(status)
    }
    await act(async () => fireEvent.submit(container.querySelector('form')!))
    out.replaces = dealsSpies.replaces
    expect(out).toMatchSnapshot()
  })

  test('filter button: chips for every kind, tooltip overflow, remove a chip; saved filters; save a filter', async () => {
    const { default: FilterBtn } = await import('@/components/filter/FilterBtn')
    const user = { ...DEALS_USER, savedFilters: [{ name: 'הסינון של דנה', href: '?filter={}' }] }
    const many = { ...RICH_FILTER, userNames: Array.from({ length: 10 }, (_, i) => `נציג ${i + 1}`), userIds: Array.from({ length: 10 }, (_, i) => i + 1) }
    const { container } = render(await dealsShell(null, <FilterBtn user={user} filter={many} />))
    const out: Record<string, unknown> = {}
    out.bar = html(container.firstElementChild)
    const repsChip = Array.from(container.querySelectorAll('.inline-flex')).find((el) => el.textContent?.startsWith('נציגים'))!
    fireEvent.mouseEnter(repsChip)
    out.tooltip = html(container.querySelector('[role="tooltip"]'))
    fireEvent.mouseLeave(repsChip)
    const removes = Array.from(container.querySelectorAll('button[aria-label]')).filter((b) => b.getAttribute('aria-label')?.startsWith('הסרת סינון'))
    fireEvent.click(removes[0])
    fireEvent.click(removes[3])
    fireEvent.click(removes.at(-1)!)
    const pop = document.getElementById('savefilterPop')!
    fireEvent.change(pop.querySelector('input[name="name"]')!, { target: { value: 'החודש שלי' } })
    await act(async () => fireEvent.submit(pop.querySelector('form')!))
    out.replaces = dealsSpies.replaces
    out.toasts = dealsSpies.toasts
    out.calls = dealsSpies.calls
    expect(out).toMatchSnapshot()
  })

  test('chips for the preset ranges and both checkboxes', async () => {
    const { FilterChips } = await import('@/components/sumSales/FilterChips')
    const out: string[] = []
    for (const dateRange of ['כל התאריכים', 'החודש הנוכחי', 'החודש הקודם', 'השבוע הנוכחי', 'השבוע הקודם', 'השנה הנוכחית', 'השנה הקודמת']) {
      const { container } = render(await dealsShell(null, <FilterChips filter={{ dateRange, saleDtRange: dateRange, action: 'מכירה', status: ['בהצעה'], replace: true }} />))
      out.push(html(container.firstElementChild))
      cleanup()
    }
    expect(out).toMatchSnapshot()
    expect(dealsEnv.search).toBe('')
  })
})
