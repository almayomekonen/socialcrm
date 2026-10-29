// @vitest-environment jsdom
import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from 'vitest'
import { renderToString as renderRaw } from 'react-dom/server'
import { act, cleanup, render } from '@testing-library/react'
import type { ReactNode } from 'react'
import { EXPIRED } from './leadTabsEnv'
import { MEETINGS, NOW, calEnv, calSpies, resetCalEnv, resetCalSpies } from './calendarEnv'
import { calShell, calendarPage, fcProps, gesture, withCalEnv } from './calendarHarness'

/**
 * HEBREW BASELINE for /calendar (desktop): the page states, the grid
 * configuration handed to FullCalendar, the event chips, and every toast /
 * Pro prompt / revert of the grid gestures (drag, resize, date click, select)
 * and of the details-dialog retry / cancel handlers. Recorded against the code
 * BEFORE Phase E1; every Hebrew render must still match byte-for-byte.
 * Dialogs: calendarHebrewBaselineDialogs / …Details.
 *
 * FullCalendar is `next/dynamic` with `ssr: false`: the stub renders its
 * `loading` placeholder (what the server sends) and records its props, so the
 * handlers run for real. Only I/O (actions, toasts, navigation) is mocked.
 */

vi.mock('next/navigation', async () => {
  const { calSpies: s } = await import('./calendarEnv')
  return { useRouter: () => ({ push: (to: string) => s.pushes.push(to), replace: () => {}, refresh: () => void s.refreshes++ }) }
})
vi.mock('next/dynamic', async () => ({ default: (await import('./calendarEnv')).calendarDynamicMock }))
vi.mock('@/lib/requireUser', async () => ({ requireAgencyUser: async () => (await import('./calendarEnv')).calEnv.user }))
vi.mock('@/db/uiLocale', () => ({ getUiLocalePrefs: async () => ({ userLocale: null, agencyLocale: null }) }))
vi.mock('@/lib/device', () => ({ isMobileRequest: async () => false, isMobileWorkspaceRequest: async () => false }))
vi.mock('@/db/googleCalendarConnections', async () => ({
  getCalendarConnectionByUserId: async () => (await import('./calendarEnv')).calEnv.connection,
}))
vi.mock('@/actions/calendar', async () => (await import('./calendarEnv')).calendarActionsModule())
vi.mock('@/actions/clients', async () => {
  const { calSpies: s } = await import('./calendarEnv')
  return { searchLeads: (...a: unknown[]) => s.searchLeads(...a), getLeadById: (...a: unknown[]) => s.getLeadById(...(a as [number])), updateLead: (...a: unknown[]) => s.updateLead(...a) }
})
vi.mock('@/actions/leadFollowUp', () => ({ setLeadFollowUp: async () => ({}), clearLeadFollowUp: async () => ({}) }))
vi.mock('@/actions/analytics/recordLeadActionEvent', () => ({ recordLeadActionEvent: async () => {} }))
vi.mock('@/lib/toast', async () => {
  const { calSpies: s } = await import('./calendarEnv')
  return { toast: (...args: unknown[]) => s.toasts.push(args), proToast: (opts: unknown) => s.pro.push(opts) }
})

function normalizeIds(html: string) {
  return html.replace(/«[^»]*»/g, '«id»').replace(/_[rR]_[0-9a-zA-Z]*_/g, '«id»').replace(/:r[0-9a-z]+:/g, '«id»')
}
const renderToString = (node: ReactNode) => normalizeIds(renderRaw(<>{node}</>).replaceAll('<!-- -->', ''))

beforeAll(() => {
  Object.assign(HTMLElement.prototype, { showPopover() {}, hidePopover() {}, togglePopover() {} })
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
})
afterAll(() => vi.useRealTimers())
afterEach(() => {
  cleanup()
  resetCalEnv()
  resetCalSpies()
})

async function view(ent = undefined as typeof EXPIRED | undefined) {
  const { default: CalendarView } = await import('@/components/calendar/CalendarView')
  return render(await calShell(null, <CalendarView meetings={structuredClone(MEETINGS)} />, ent))
}

const H = 3_600_000
const plus = (iso: string, ms: number) => new Date(Date.parse(iso) + ms).toISOString()
const log = () => ({ toasts: [...calSpies.toasts], pro: [...calSpies.pro], refreshes: calSpies.refreshes })

describe('Hebrew baseline — /calendar (server HTML)', () => {
  test('never connected, disabled, connected, reauth required; the list read', async () => {
    const out: Record<string, unknown> = {}
    out.notConnected = renderToString(await calShell(null, await withCalEnv({ connection: null }, () => calendarPage())))
    out.disabled = renderToString(await calShell(null, await withCalEnv({ connection: { sync_status: 'disabled' } }, () => calendarPage())))
    out.connected = renderToString(await calShell(null, await calendarPage()))
    out.reauth = renderToString(await calShell(null, await withCalEnv({ connection: { sync_status: 'reauth_required' } }, () => calendarPage())))
    out.listArgs = calEnv.listArgs
    expect(out).toMatchSnapshot()
  })
})

describe('Hebrew baseline — the grid', () => {
  test('FullCalendar configuration (text, locale, direction, week start, clock)', async () => {
    await view()
    const p = fcProps()
    const config = Object.fromEntries(
      Object.entries(p).filter(([, v]) => typeof v !== 'function' && !(Array.isArray(v) && typeof v[0] === 'object' && 'extendedProps' in v[0])),
    )
    expect({ ...config, locale: p.locale?.code, plugins: (p.plugins as unknown[]).length, events: p.events.length }).toMatchSnapshot()
  })

  test('event chips for every sync state and outcome', async () => {
    await view()
    const out = (fcProps().events as any[]).map((e) =>
      renderToString(fcProps().eventContent({ event: { extendedProps: e.extendedProps }, timeText: '11:00' })),
    )
    expect(out).toMatchSnapshot()
  })

  test('date click / select open the new-meeting form; expired prompts instead', async () => {
    const out: Record<string, unknown> = {}
    const v = await view()
    await act(async () => fcProps().dateClick({ date: new Date(NOW + 2 * 24 * H) }))
    out.formTitle = document.querySelector('[role="dialog"] h2')?.textContent
    v.unmount()
    const e = await view(EXPIRED)
    await act(async () => fcProps().dateClick({ date: new Date(NOW + 2 * 24 * H) }))
    await act(async () => fcProps().select({ start: new Date(NOW + 24 * H), end: new Date(NOW + 25 * H) }))
    out.newMeetingButton = e.container.querySelector('button')?.outerHTML
    out.log = log()
    expect(out).toMatchSnapshot()
  })

  test('drag: every refusal, every sync status, every failure reason', async () => {
    const m = MEETINGS[0]
    const out: unknown[] = []
    await view()
    const drop = async (meeting: Record<string, any>, start: string | null, end: string | null, result?: unknown, thrown?: boolean) => {
      resetCalSpies()
      if (result) calSpies.updateMeeting.mockImplementation(async () => result)
      if (thrown) calSpies.updateMeeting.mockImplementation(async () => { throw new Error('boom') })
      const g = gesture(meeting, start, end)
      await act(async () => fcProps().eventDrop(g.arg))
      out.push({ ...log(), reverts: g.reverts.count, sent: calSpies.updateMeeting.mock.calls })
    }
    const s = plus(m.startAt, H)
    const e = plus(m.endAt, H)
    await drop({ ...m, status: 'completed' }, s, e)
    await drop(m, m.startAt, m.endAt)
    await drop(m, new Date(NOW - H).toISOString(), new Date(NOW).toISOString())
    await drop(m, s, null)
    for (const syncStatus of ['synced', 'not_synced', 'reauth_required', 'failed']) await drop(m, s, e, { ok: true, syncStatus })
    await drop(m, s, e, { ok: false, reason: 'conflict' })
    await drop(m, s, e, { ok: false, reason: 'not_owner' })
    await drop(m, s, e, { ok: false, reason: 'invalid_input', details: 'duration_too_short' })
    await drop(m, s, e, { ok: false, reason: 'invalid_input', details: 'startAt' })
    await drop(m, s, e, { ok: false, reason: 'not_found' })
    await drop(m, s, e, undefined, true)
    expect(out).toMatchSnapshot()
  })

  test('drag while another update is in flight; expired drag and resize', async () => {
    const m = MEETINGS[0]
    const out: Record<string, unknown> = {}
    await view()
    let release: (v: unknown) => void = () => {}
    calSpies.updateMeeting.mockImplementation(() => new Promise((r) => (release = r)))
    const first = gesture(m, plus(m.startAt, H), plus(m.endAt, H))
    let pending: Promise<unknown> = Promise.resolve()
    await act(async () => void (pending = fcProps().eventDrop(first.arg)))
    const second = gesture(m, plus(m.startAt, 2 * H), plus(m.endAt, 2 * H))
    await act(async () => fcProps().eventDrop(second.arg))
    const third = gesture(m, m.startAt, plus(m.endAt, H))
    await act(async () => fcProps().eventResize(third.arg))
    await act(async () => (release({ ok: true, syncStatus: 'synced' }), pending))
    out.busy = { ...log(), reverts: [first.reverts.count, second.reverts.count, third.reverts.count] }
    cleanup()
    resetCalSpies()
    await view(EXPIRED)
    const d = gesture(m, plus(m.startAt, H), plus(m.endAt, H))
    const r = gesture(m, m.startAt, plus(m.endAt, H))
    await act(async () => fcProps().eventDrop(d.arg))
    await act(async () => fcProps().eventResize(r.arg))
    out.expired = { ...log(), reverts: [d.reverts.count, r.reverts.count], sent: calSpies.updateMeeting.mock.calls.length }
    expect(out).toMatchSnapshot()
  })

  test('resize: every refusal, every sync status, every failure reason', async () => {
    const m = MEETINGS[0]
    const out: unknown[] = []
    await view()
    const resize = async (meeting: Record<string, any>, end: string | null, result?: unknown, thrown?: boolean) => {
      resetCalSpies()
      if (result) calSpies.updateMeeting.mockImplementation(async () => result)
      if (thrown) calSpies.updateMeeting.mockImplementation(async () => { throw new Error('boom') })
      const g = gesture(meeting, meeting.startAt, end)
      await act(async () => fcProps().eventResize(g.arg))
      out.push({ ...log(), reverts: g.reverts.count, sent: calSpies.updateMeeting.mock.calls })
    }
    const e = plus(m.endAt, H)
    await resize({ ...m, status: 'no_show' }, e)
    await resize(m, null)
    await resize(m, m.endAt)
    await resize(m, plus(m.startAt, 60_000))
    for (const syncStatus of ['synced', 'not_synced', 'reauth_required', 'failed']) await resize(m, e, { ok: true, syncStatus })
    await resize(m, e, { ok: false, reason: 'conflict' })
    await resize(m, e, { ok: false, reason: 'not_owner' })
    await resize(m, e, { ok: false, reason: 'invalid_input', details: 'duration_too_short' })
    await resize(m, e, { ok: false, reason: 'invalid_input', details: 'end_before_start' })
    await resize(m, e, { ok: false, reason: 'not_found' })
    await resize(m, e, undefined, true)
    expect(out).toMatchSnapshot()
  })

  test('details dialog retry / cancel from the grid: every result; expired prompts', async () => {
    const out: unknown[] = []
    const click = (id: number) => fcProps().eventClick({ event: { extendedProps: { meeting: structuredClone(MEETINGS.find((m) => m.id === id)) } } })
    const button = (text: string) => Array.from(document.querySelectorAll('button')).find((b) => b.textContent === text)!
    const run = async (ent: typeof EXPIRED | undefined, action: 'retry' | 'cancel', result?: unknown) => {
      cleanup()
      resetCalSpies()
      if (result) calSpies[action === 'retry' ? 'retrySyncMeeting' : 'cancelMeeting'].mockImplementation(async () => result)
      await view(ent)
      await act(async () => click(2))
      if (action === 'retry') await act(async () => button('נסה לסנכרן שוב').click())
      else {
        await act(async () => button('ביטול הפגישה').click())
        const dialogs = document.querySelectorAll('[role="dialog"]')
        await act(async () => Array.from(dialogs[dialogs.length - 1].querySelectorAll('button')).pop()!.click())
      }
      out.push({ action, ...log(), dialogOpen: document.querySelectorAll('[role="dialog"]').length })
    }
    for (const r of [{ ok: true, syncStatus: 'synced' }, { ok: true, syncStatus: 'reauth_required' }, { ok: true, syncStatus: 'failed' }, { ok: false, reason: 'not_found' }]) await run(undefined, 'retry', r)
    for (const r of [{ ok: true, syncStatus: 'synced' }, { ok: true, syncStatus: 'reauth_required' }, { ok: true, syncStatus: 'failed' }, { ok: false, reason: 'not_owner' }]) await run(undefined, 'cancel', r)
    await run(EXPIRED, 'retry')
    await run(EXPIRED, 'cancel')
    expect(out).toMatchSnapshot()
  })
})
