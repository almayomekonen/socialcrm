// @vitest-environment jsdom
import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from 'vitest'
import { renderToString as renderRaw } from 'react-dom/server'
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { EXPIRED } from './leadTabsEnv'
import { EDIT_MEETING, MEETINGS, NOW, calSpies, resetCalEnv, resetCalSpies } from './calendarEnv'
import { calShell } from './calendarHarness'

/**
 * HEBREW BASELINE for the /calendar MEETING DETAILS and EDIT dialogs: every
 * meeting variant, outcome marking (+ the lead-status nudge for every
 * suggestion, apply / dismiss / failures), the cancel confirmation, Pro
 * prompts, and the edit dialog (loading, load failures, validation, no-op,
 * every update result). Also the two badges as data. Recorded BEFORE Phase
 * E1; Hebrew must stay byte-identical.
 */

vi.mock('next/navigation', async () => {
  const { calSpies: s } = await import('./calendarEnv')
  return { useRouter: () => ({ push: (to: string) => s.pushes.push(to), replace: () => {}, refresh: () => void s.refreshes++ }) }
})
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

const norm = (h: string) => h.replace(/«[^»]*»/g, '«id»').replace(/_[rR]_[0-9a-zA-Z]*_/g, '«id»').replace(/:r[0-9a-z]+:/g, '«id»')
const dialogs = () => Array.from(document.querySelectorAll('[role="dialog"]'))
const top = () => norm(dialogs().pop()!.outerHTML)
const btn = (text: string) => Array.from(document.querySelectorAll('[role="dialog"] button')).find((b) => b.textContent === text) as HTMLButtonElement
const log = () => ({ toasts: [...calSpies.toasts], pro: [...calSpies.pro], refreshes: calSpies.refreshes, closes: calSpies.pushes.length })

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

async function details(meeting = MEETINGS[0], ent?: typeof EXPIRED) {
  const { default: MeetingDetailsDialog } = await import('@/components/calendar/MeetingDetailsDialog')
  const close = () => void calSpies.pushes.push('close')
  const r = render(
    await calShell(
      null,
      <MeetingDetailsDialog meeting={structuredClone(meeting) as never} onClose={close} onCancel={async () => {}} onRetry={async () => {}} onEdit={() => calSpies.pushes.push('edit')} retrying={false} cancelling={false} />,
      ent,
    ),
  )
  await act(async () => {})
  return r
}

async function edit() {
  const { default: MeetingEditDialog } = await import('@/components/calendar/MeetingEditDialog')
  const r = render(await calShell(null, <MeetingEditDialog meetingId={1} onClose={() => calSpies.pushes.push('close')} />))
  return r
}

describe('Hebrew baseline — meeting details', () => {
  test('every meeting variant; busy labels', async () => {
    const out: Record<string, string> = {}
    for (const m of MEETINGS) {
      await details(m)
      out[`${m.id}:${m.status}:${m.syncStatus}`] = top()
      cleanup()
    }
    const { default: MeetingDetailsDialog } = await import('@/components/calendar/MeetingDetailsDialog')
    render(await calShell(null, <MeetingDetailsDialog meeting={MEETINGS[1] as never} onClose={() => {}} onCancel={async () => {}} onRetry={async () => {}} onEdit={() => {}} retrying cancelling />))
    out.busy = top()
    expect(out).toMatchSnapshot()
  })

  test('outcome: completed with a nudge (apply, dismiss, apply fails), no-show, every refusal, throw', async () => {
    const out: Record<string, unknown> = {}
    await details()
    await act(async () => fireEvent.click(btn('סמן כהושלמה')))
    out.nudge = top()
    await act(async () => fireEvent.click(btn('עדכן סטטוס למעוניין')))
    out.applied = { ...log(), sent: calSpies.updateLead.mock.calls }
    cleanup(); resetCalSpies()
    await details()
    await act(async () => fireEvent.click(btn('סמן כהושלמה')))
    await act(async () => fireEvent.click(btn('לא עכשיו')))
    out.dismissed = log()
    cleanup(); resetCalSpies()
    calSpies.updateLead.mockImplementation(async () => { throw new Error('x') })
    await details()
    await act(async () => fireEvent.click(btn('סמן כהושלמה')))
    await act(async () => fireEvent.click(btn('עדכן סטטוס למעוניין')))
    out.applyFailed = log()
    cleanup(); resetCalSpies()
    await details()
    await act(async () => fireEvent.click(btn('סמן כלא הגיע')))
    out.noShow = { ...log(), sent: calSpies.markMeetingNoShow.mock.calls }
    const refusals: Record<string, unknown> = {}
    for (const reason of ['invalid_input', 'not_found', 'not_owner', 'already_cancelled', 'already_completed', 'already_no_show', 'other', 'throw']) {
      cleanup(); resetCalSpies()
      const impl = async () => {
        if (reason === 'throw') throw new Error('x')
        return { ok: false, reason }
      }
      calSpies.markMeetingCompleted.mockImplementation(impl)
      calSpies.markMeetingNoShow.mockImplementation(impl)
      await details()
      await act(async () => fireEvent.click(btn('סמן כהושלמה')))
      await act(async () => fireEvent.click(btn('סמן כלא הגיע')))
      refusals[reason] = log()
    }
    out.refusals = refusals
    expect(out).toMatchSnapshot()
  })

  test('the nudge for every suggested status', async () => {
    const { default: LeadStatusNudge } = await import('@/components/calendar/LeadStatusNudge')
    const out = ['contacted', 'interested', 'closed'].map((s) => [
      norm(renderRaw(<LeadStatusNudge suggested={s as never} onApply={() => {}} onDismiss={() => {}} busy={false} />).replaceAll('<!-- -->', '')),
      norm(renderRaw(<LeadStatusNudge suggested={s as never} onApply={() => {}} onDismiss={() => {}} busy />).replaceAll('<!-- -->', '')),
    ])
    expect(out).toMatchSnapshot()
  })

  test('cancel confirmation; expired: edit and outcome prompt, edit hand-off when active', async () => {
    const out: Record<string, unknown> = {}
    await details()
    await act(async () => fireEvent.click(btn('ביטול הפגישה')))
    out.confirm = top()
    cleanup()
    await details(MEETINGS[0], EXPIRED)
    await act(async () => fireEvent.click(btn('עריכת פגישה')))
    await act(async () => fireEvent.click(btn('סמן כהושלמה')))
    await act(async () => fireEvent.click(btn('סמן כלא הגיע')))
    out.expired = { ...log(), marked: calSpies.markMeetingCompleted.mock.calls.length }
    cleanup(); resetCalSpies()
    await details()
    await act(async () => fireEvent.click(btn('עריכת פגישה')))
    out.edit = calSpies.pushes
    expect(out).toMatchSnapshot()
  })

  test('badges as data: every sync status, every outcome with and without a date', async () => {
    const { default: SyncStatusBadge } = await import('@/components/calendar/SyncStatusBadge')
    const { default: MeetingOutcomeBadge } = await import('@/components/calendar/MeetingOutcomeBadge')
    const r = (n: React.ReactElement) => norm(renderRaw(n).replaceAll('<!-- -->', ''))
    const at = '2026-10-26T10:00:00.000Z'
    expect({
      sync: ['pending', 'synced', 'failed', 'reauth_required'].map((s) => r(<SyncStatusBadge status={s as never} />)),
      outcome: ['scheduled', 'completed', 'no_show', 'cancelled'].flatMap((s) => [
        r(<MeetingOutcomeBadge status={s as never} />),
        r(<MeetingOutcomeBadge status={s as never} completedAt={at} noShowAt={at} />),
      ]),
    }).toMatchSnapshot()
  })
})

describe('Hebrew baseline — edit meeting', () => {
  test('loading, load failures, the form', async () => {
    const out: Record<string, string> = {}
    let release: (v: unknown) => void = () => {}
    calSpies.getMeetingForEdit.mockImplementation(() => new Promise((r) => (release = r)))
    await edit()
    out.loading = top()
    await act(async () => release({ ok: true, meeting: structuredClone(EDIT_MEETING) }))
    out.form = top()
    for (const reason of ['not_found', 'not_owner', 'invalid_input']) {
      cleanup()
      calSpies.getMeetingForEdit.mockImplementation(async () => ({ ok: false, reason }))
      await edit()
      await act(async () => {})
      out[reason] = top()
    }
    expect(out).toMatchSnapshot()
  })

  test('validation, no changes, every update result; what is sent', async () => {
    const out: Record<string, unknown> = {}
    const input = (n: string) => document.querySelector(`[role="dialog"] input[name="${n}"]`) as HTMLInputElement
    const submit = async () => act(async () => fireEvent.submit(document.querySelector('[role="dialog"] form')!))
    const open = async () => {
      cleanup()
      resetCalSpies()
      await edit()
      await act(async () => {})
    }
    await open()
    fireEvent.change(input('title'), { target: { value: ' ' } })
    await submit()
    out.noTitle = top()
    fireEvent.change(input('title'), { target: { value: 'כותרת חדשה' } })
    fireEvent.change(input('startAt'), { target: { value: '' } })
    await submit()
    out.invalidDate = top()
    await open()
    const s = input('startAt').value
    fireEvent.change(input('endAt'), { target: { value: s } })
    await submit()
    out.endBeforeStart = top()
    fireEvent.change(input('startAt'), { target: { value: '2026-10-01T10:00' } })
    fireEvent.change(input('endAt'), { target: { value: '2026-10-01T11:00' } })
    await submit()
    out.past = top()
    await open()
    await submit()
    out.noChanges = log()
    const results: unknown[] = [
      { ok: true, syncStatus: 'synced' },
      { ok: true, syncStatus: 'not_synced' },
      { ok: true, syncStatus: 'reauth_required' },
      { ok: true, syncStatus: 'failed' },
      { ok: false, reason: 'conflict' },
      { ok: false, reason: 'not_owner' },
      { ok: false, reason: 'not_found' },
      { ok: false, reason: 'invalid_input', details: 'duration_too_short' },
      { ok: false, reason: 'invalid_input', details: 'end_before_start' },
      { ok: false, reason: 'invalid_input', details: 'cancelled' },
      { ok: false, reason: 'invalid_input', details: 'startAt' },
      'throw',
    ]
    const res: unknown[] = []
    for (const result of results) {
      await open()
      calSpies.updateMeeting.mockImplementation(async () => {
        if (result === 'throw') throw new Error('x')
        return result
      })
      fireEvent.change(input('title'), { target: { value: 'כותרת חדשה' } })
      await submit()
      res.push({ result, ...log(), error: document.querySelector('[role="dialog"] .text-red-700')?.textContent ?? null, sent: calSpies.updateMeeting.mock.calls })
    }
    out.results = res
    expect(out).toMatchSnapshot()
  })
})
