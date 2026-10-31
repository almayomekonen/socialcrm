// @vitest-environment jsdom
import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { EXPIRED, MORE_ROWS, NOW, resetPhoneEnv, phoneEnv } from './phoneLeadsEnv'
import { actionCalls, takeToasts } from './phoneLeadsMocks'
import { phoneLeadsPage, phoneShell, setPhone } from './phoneLeadsHarness'

/**
 * HEBREW BASELINE, part 2 (i18n Phase F2): the phone lead LIST after acting —
 * selection mode and its bar, the per-lead actions sheet, the status and
 * follow-up sheets (every preset, custom date, clear, every toast, expired),
 * delete confirmation (one / several) with every result, load more (loading,
 * failure), the status filter sheet and the active-filter strip, the add
 * chooser. Every action's arguments are recorded. Recorded BEFORE Phase F2 on
 * unmodified code, with NO i18n provider. The add form and the import:
 * phoneLeadsHebrewBaselineForms.test.tsx.
 *
 * Normalized: React `useId` values only.
 */

vi.mock('next/navigation', async () => (await import('./phoneLeadsMocks')).navigationModule())
vi.mock('next/server', async () => (await import('./phoneLeadsMocks')).serverModule())
vi.mock('@/lib/analytics/track', () => ({ track: async () => {} }))
vi.mock('@/db/auth', async () => (await import('./phoneLeadsMocks')).authModule())
vi.mock('@/db/uiLocale', async () => (await import('./phoneLeadsMocks')).uiLocaleModule())
vi.mock('@/lib/device', async () => (await import('./phoneLeadsMocks')).deviceModule())
vi.mock('@/lib/flags/mobileFlags', () => ({ canEnterMobileWorkspace: () => true }))
vi.mock('@/modules/leads/queries', async () => (await import('./phoneLeadsMocks')).queriesModule())
vi.mock('@/db/whatsapp', async () => (await import('./phoneLeadsMocks')).whatsappDbModule())
vi.mock('@/db/facebook', async () => (await import('./phoneLeadsMocks')).facebookDbModule())
vi.mock('@/actions/clients', async () => (await import('./phoneLeadsMocks')).clientsActionsModule())
vi.mock('@/actions/leads/loadMoreMobileLeads', async () => (await import('./phoneLeadsMocks')).loadMoreModule())
vi.mock('@/actions/leadFollowUp', async () => (await import('./phoneLeadsMocks')).followUpModule())
vi.mock('@/actions/leadOutcome', async () => (await import('./phoneLeadsMocks')).outcomeModule())
vi.mock('@/actions/leadDuplicates', async () => (await import('./phoneLeadsMocks')).duplicatesModule())
vi.mock('@/modules/inbox/actions', async () => (await import('./phoneLeadsMocks')).inboxActionsModule())
vi.mock('@/actions/analytics/recordLeadActionEvent', () => ({ recordLeadActionEvent: async () => {} }))
vi.mock('@/actions/analytics/recordFirstLeadEvent', () => ({ recordFirstLeadEvent: async () => {} }))
vi.mock('@/components/education/AutoTour', () => ({ default: () => null }))
vi.mock('@/lib/toast', async () => (await import('./phoneLeadsMocks')).toastModule())

function normalizeIds(html: string) {
  return html.replace(/«[^»]*»/g, '«id»').replace(/_[rR]_[0-9a-zA-Z]*_/g, '«id»').replace(/:r[0-9a-z]+:/g, '«id»')
}
const html = (el: Element | null | undefined) => {
  if (!el) throw new Error('element not found')
  return normalizeIds(el.outerHTML)
}
const dialog = () => [...document.querySelectorAll('[role="dialog"]')].at(-1)
const click = async (el: Element) => act(async () => fireEvent.click(el))
const byText = (text: string) => screen.getAllByText(text).at(-1)!
const rows = () => screen.getAllByTestId('lead-row')
/** Leave selection mode if it is on, then a fresh long press on row `i` (touch down/up resets the hook first). */
const select = async (i: number) => {
  const bar = screen.queryByTestId('leads-selection-bar')
  if (bar) await click(screen.getAllByText('ביטול').find((b) => b.closest('button')?.className.includes('min-h-11'))!)
  const el = rows()[i]
  fireEvent.pointerDown(el, { pointerType: 'touch', button: 0, clientX: 8, clientY: 8 })
  fireEvent.pointerUp(el, { pointerType: 'touch', button: 0, clientX: 8, clientY: 8 })
  await act(async () => fireEvent.contextMenu(el))
}
const mount = async (params: Record<string, string> = {}, ent?: typeof EXPIRED) =>
  render(await phoneShell(null, await phoneLeadsPage(params), ent))

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

beforeAll(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
})
afterAll(() => vi.useRealTimers())
afterEach(() => {
  cleanup()
  resetPhoneEnv()
})

describe('Hebrew baseline — phone list selection, actions, status, follow-up', () => {
  test('selection bar (one / two), the actions sheet, the status sheet and its toasts', async () => {
    await mount()
    const out: Record<string, unknown> = {}
    await select(0)
    out.selectedOne = html(screen.getByTestId('leads-selection-bar'))
    out.stickyOne = html(byText('מחק').closest('div.flex-col'))
    await click(byText('פעולות'))
    out.actionsSheet = html(dialog())
    await click(byText('שינוי סטטוס'))
    out.statusSheet = html(dialog())
    await click(byText('בטיפול'))
    out.statusToasts = takeToasts()
    await select(4)
    await click(byText('פעולות'))
    out.actionsSheetChatOnly = html(dialog())
    phoneEnv.results.updateLead = 'throw'
    await click(byText('שינוי סטטוס'))
    await click(byText('מעוניין'))
    out.statusFailToasts = takeToasts()
    await select(0)
    await click(rows()[1])
    out.selectedTwo = html(screen.getByTestId('leads-selection-bar'))
    out.stickyTwo = html(byText('מחק').closest('div.flex-col'))
    out.calls = actionCalls()
    expect(out).toMatchSnapshot()
  })

  test('the follow-up sheet: presets, custom date, clear, toasts, failures, expired', async () => {
    await mount()
    const out: Record<string, unknown> = {}
    const openFollowUp = async (index: number) => {
      await select(index)
      await click(byText('פעולות'))
      await click(byText('הוספת מעקב'))
    }
    await openFollowUp(1)
    out.sheetWithCurrent = html(dialog())
    fireEvent.change(screen.getByPlaceholderText('הערה (לא חובה)'), { target: { value: 'להתקשר בבוקר' } })
    await click(byText('מחר'))
    out.setToasts = takeToasts()
    await openFollowUp(0)
    out.sheetNoCurrent = html(dialog())
    await click(byText('תאריך אחר…'))
    out.custom = html(dialog())
    await act(async () => fireEvent.change(dialog()!.querySelector('input[type="date"]')!, { target: { value: '2026-11-12' } }))
    out.customToasts = takeToasts()
    await openFollowUp(1)
    await click(byText('הסר מעקב'))
    out.clearToasts = takeToasts()
    phoneEnv.results.setLeadFollowUp = 'throw'
    await openFollowUp(2)
    await click(byText('היום'))
    phoneEnv.results.clearLeadFollowUp = { err: true, msg: 'אין הרשאה' }
    await click(byText('הסר מעקב'))
    out.failToasts = takeToasts()
    out.calls = actionCalls().map((c) => (c[0] === 'setLeadFollowUp' ? [c[0], { ...(c[1] as object), at: 'AT' }] : c))
    cleanup()
    await mount({}, EXPIRED)
    await openFollowUp(1)
    out.expiredSheet = html(dialog())
    expect(out).toMatchSnapshot()
  })
})

describe('Hebrew baseline — phone list delete, load more, filters, add chooser', () => {
  test('delete confirmation (one / several) and every result', async () => {
    await mount()
    const out: Record<string, unknown> = {}
    await select(0)
    await click(byText('מחק'))
    out.confirmOne = html(dialog())
    await click(byText('מחק ליד'))
    out.deletedOne = takeToasts()
    await select(0)
    await click(rows()[1])
    await click(rows()[2])
    await click(byText('מחק'))
    out.confirmMany = html(dialog())
    phoneEnv.results.deleteManyLeads = { deletedCount: 0, blockedCount: 0, blockedLeads: [] }
    await click(byText('מחק לידים'))
    out.noneDeleted = takeToasts()
    out.afterNone = html(screen.getByTestId('leads-selection-bar'))
    phoneEnv.results.deleteManyLeads = { deletedCount: 2, blockedCount: 1, blockedLeads: [{ id: 13, reason: 'invoices' }] }
    await click(byText('מחק'))
    await click(byText('מחק לידים'))
    out.partial = takeToasts()
    out.afterPartial = html(screen.getByTestId('leads-selection-bar'))
    phoneEnv.results.deleteManyLeads = 'throw'
    await click(byText('מחק'))
    await click(byText('מחק ליד'))
    out.failed = takeToasts()
    out.calls = actionCalls()
    out.rowsLeft = rows().map((r) => r.getAttribute('data-lead-id'))
    expect(out).toMatchSnapshot()
  })

  test('load more (loading, appended, failure), the filter sheet, active filters, the add chooser', async () => {
    setPhone({ hasMore: true })
    await mount({ q: 'יוסי', status: 'new,contacted' })
    const out: Record<string, unknown> = {}
    out.filterBar = html(screen.getByRole('search').closest('div.sticky'))
    const { loadMoreMobileLeads } = await import('@/actions/leads/loadMoreMobileLeads')
    let release: (v: { rows: typeof MORE_ROWS; hasMore: boolean; page: number }) => void = () => {}
    vi.mocked(loadMoreMobileLeads).mockImplementationOnce(() => new Promise((r) => (release = r)) as never)
    await click(byText('טען עוד'))
    out.loading = html(screen.getByRole('button', { name: /טוען/ }))
    await act(async () => release({ rows: structuredClone(MORE_ROWS), hasMore: true, page: 2 }))
    out.afterLoad = rows().map((r) => r.getAttribute('data-lead-id'))
    phoneEnv.results.loadMoreMobileLeads = 'throw'
    await click(byText('טען עוד'))
    out.loadFailToasts = takeToasts()
    await click(screen.getByRole('button', { name: /סינון לפי סטטוס/ }))
    out.filterSheet = html(dialog())
    await click(byText('כל הסטטוסים'))
    await click(screen.getByRole('button', { name: 'הסר חדש' }))
    await click(screen.getByRole('button', { name: 'נקה חיפוש' }))
    await click(byText('נקה הכל'))
    await click(screen.getByTestId('leads-add-action'))
    out.addAction = html(screen.getByTestId('leads-add-action'))
    out.addChooser = html(dialog())
    out.calls = phoneEnv.calls.filter((c) => c[0] !== 'toast')
    expect(out).toMatchSnapshot()
  })
})
