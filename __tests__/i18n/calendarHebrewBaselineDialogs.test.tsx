// @vitest-environment jsdom
import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from 'vitest'
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { NOW, calSpies, resetCalEnv, resetCalSpies } from './calendarEnv'
import { calShell } from './calendarHarness'

/**
 * HEBREW BASELINE for the /calendar NEW-MEETING dialog: the form, its lead
 * line, every client validation, every create result (success view per sync
 * state, every failure reason) and the attendee chips input (every inline
 * error, chip names). Recorded BEFORE Phase E1; Hebrew must stay
 * byte-identical. Grid + page: calendarHebrewBaseline; details / edit:
 * calendarHebrewBaselineDetails.
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
vi.mock('@/lib/toast', async () => {
  const { calSpies: s } = await import('./calendarEnv')
  return { toast: (...args: unknown[]) => s.toasts.push(args), proToast: (opts: unknown) => s.pro.push(opts) }
})

const norm = (h: string) => h.replace(/«[^»]*»/g, '«id»').replace(/_[rR]_[0-9a-zA-Z]*_/g, '«id»').replace(/:r[0-9a-z]+:/g, '«id»')
const dialogHtml = () => {
  const all = document.querySelectorAll('[role="dialog"]')
  if (!all.length) throw new Error('no dialog')
  return norm(all[all.length - 1].outerHTML)
}

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

const H = 3_600_000
const local = (ms: number) => {
  const d = new Date(ms)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`
}

async function form(props: Record<string, unknown> = {}) {
  const { default: MeetingFormDialog } = await import('@/components/calendar/MeetingFormDialog')
  const r = render(await calShell(null, <MeetingFormDialog open onClose={() => calSpies.pushes.push('closed')} {...props} />))
  await act(async () => {})
  return r
}
const field = (name: string) => document.querySelector(`[role="dialog"] input[name="${name}"]`) as HTMLInputElement
const submit = async () => act(async () => fireEvent.submit(document.querySelector('[role="dialog"] form')!))
const chips = () => document.querySelector('[role="dialog"] input[type="email"]') as HTMLInputElement

describe('Hebrew baseline — new meeting form', () => {
  test('defaults: no lead (warning), a picked lead, a lead without a name; prefilled slot', async () => {
    const out: Record<string, string> = {}
    await form()
    out.noLead = dialogHtml()
    cleanup()
    await form({ leadId: 41, defaultStart: new Date(NOW + 26 * H), defaultEnd: new Date(NOW + 27 * H) })
    out.lead = dialogHtml()
    cleanup()
    await form({ leadId: 99 })
    out.unnamedLead = dialogHtml()
    expect(out).toMatchSnapshot()
  })

  test('validation: title, invalid dates, end before start, past start', async () => {
    const out: Record<string, string> = {}
    await form()
    await submit()
    out.noTitle = dialogHtml()
    fireEvent.change(field('title'), { target: { value: 'שיחת תיאום' } })
    fireEvent.change(field('startAt'), { target: { value: '' } })
    await submit()
    out.invalidDate = dialogHtml()
    fireEvent.change(field('startAt'), { target: { value: local(NOW + 5 * H) } })
    fireEvent.change(field('endAt'), { target: { value: local(NOW + 4 * H) } })
    await submit()
    out.endBeforeStart = dialogHtml()
    fireEvent.change(field('startAt'), { target: { value: local(NOW - 5 * H) } })
    fireEvent.change(field('endAt'), { target: { value: local(NOW - 4 * H) } })
    await submit()
    out.past = dialogHtml()
    expect(out).toMatchSnapshot()
  })

  test('create: success per sync state (with / without attendees, Meet link), every failure', async () => {
    const out: unknown[] = []
    const results: unknown[] = [
      { ok: true, meetingId: 9, meetUrl: 'https://meet.google.com/x', syncStatus: 'synced' },
      { ok: true, meetingId: 9, meetUrl: null, syncStatus: 'synced' },
      { ok: true, meetingId: 9, meetUrl: null, syncStatus: 'failed' },
      { ok: true, meetingId: 9, meetUrl: null, syncStatus: 'reauth_required' },
      { ok: false, reason: 'invalid_input' },
      { ok: false, reason: 'lead_not_found' },
      { ok: false, reason: 'not_found' },
      { ok: false, reason: 'not_owner' },
      { ok: false, reason: 'already_synced' },
      { ok: false, reason: 'something_else' },
      'throw',
    ]
    for (const [i, result] of results.entries()) {
      cleanup()
      resetCalSpies()
      calSpies.createMeeting.mockImplementation(async () => {
        if (result === 'throw') throw new Error('boom')
        return result
      })
      await form({ leadId: 41 })
      fireEvent.change(field('title'), { target: { value: 'שיחת תיאום' } })
      fireEvent.change(field('startAt'), { target: { value: local(NOW + 3 * H) } })
      fireEvent.change(field('endAt'), { target: { value: local(NOW + 4 * H) } })
      if (i !== 1) {
        fireEvent.change(chips(), { target: { value: 'a@example.test' } })
        fireEvent.keyDown(chips(), { key: 'Enter' })
        if (i === 2) {
          fireEvent.change(chips(), { target: { value: 'b@example.test' } })
          fireEvent.keyDown(chips(), { key: 'Enter' })
        }
      }
      await submit()
      const sent = calSpies.createMeeting.mock.calls[0]?.[0] as Record<string, unknown> | undefined
      out.push({ result, dialog: dialogHtml(), sent: sent && { ...sent, timezone: typeof sent.timezone }, refreshes: calSpies.refreshes })
    }
    expect(out).toMatchSnapshot()
  })

  test('attendee chips: invalid on Enter / Tab / blur, multi-paste, duplicates, remove, backspace', async () => {
    const out: Record<string, string> = {}
    await form()
    const area = () => norm(chips().closest('.grid, div')!.parentElement!.outerHTML)
    fireEvent.change(chips(), { target: { value: 'not-an-email' } })
    fireEvent.keyDown(chips(), { key: 'Enter' })
    out.enterInvalid = area()
    fireEvent.change(chips(), { target: { value: 'ok@example.test' } })
    fireEvent.keyDown(chips(), { key: 'Enter' })
    out.added = area()
    fireEvent.change(chips(), { target: { value: 'bad' } })
    fireEvent.keyDown(chips(), { key: 'Tab' })
    out.tabInvalid = area()
    fireEvent.change(chips(), { target: { value: 'bad2' } })
    fireEvent.blur(chips())
    out.blurInvalid = area()
    fireEvent.change(chips(), { target: { value: '' } })
    fireEvent.paste(chips(), { clipboardData: { getData: () => 'x@example.test, nope; also-no' } })
    out.pasteMany = area()
    fireEvent.paste(chips(), { clipboardData: { getData: () => 'ok@example.test, only-bad' } })
    out.pasteOne = area()
    fireEvent.click(document.querySelector('[role="dialog"] button[aria-label^="הסר"]')!)
    out.removed = area()
    fireEvent.keyDown(chips(), { key: 'Backspace' })
    out.backspaced = area()
    expect(out).toMatchSnapshot()
  })

  test('success view: close; the create-new-lead shortcut', async () => {
    await form({ leadId: 41 })
    fireEvent.change(field('title'), { target: { value: 'שיחת תיאום' } })
    fireEvent.change(field('startAt'), { target: { value: local(NOW + 3 * H) } })
    fireEvent.change(field('endAt'), { target: { value: local(NOW + 4 * H) } })
    await submit()
    const close = Array.from(document.querySelectorAll('[role="dialog"] button')).find((b) => b.textContent === 'סגור')!
    await act(async () => fireEvent.click(close))
    expect(calSpies.pushes).toMatchSnapshot()
  })
})
