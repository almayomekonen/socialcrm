// @vitest-environment jsdom
import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from 'vitest'
import { act, useState } from 'react'
import { cleanup, fireEvent, render } from '@testing-library/react'
import { EDIT_MEETING, MEETINGS, NOW, calSpies as S, resetCalEnv, resetCalSpies } from './calendarEnv'

/**
 * /calendar behaves the same in every language: create, drag, resize, edit,
 * outcome (+ the lead-status nudge, which writes the stored status CODE),
 * retry and cancel send identical arguments; reverts are identical;
 * validation is shown in the interface language; Escape closes a dialog and
 * focus returns to what opened it; icon-only controls carry translated names.
 */

vi.mock('next/navigation', async () => {
  const { calSpies: s } = await import('./calendarEnv')
  return { useRouter: () => ({ push: (to: string) => s.pushes.push(to), replace: () => {}, refresh: () => void s.refreshes++ }) }
})
vi.mock('next/dynamic', async () => ({ default: (await import('./calendarEnv')).calendarDynamicMock }))
vi.mock('@/lib/analytics/track', () => ({ track: () => {} }))
vi.mock('@/actions/calendar', async () => (await import('./calendarEnv')).calendarActionsModule())
vi.mock('@/actions/clients', async () => {
  const { calSpies: s } = await import('./calendarEnv')
  return { searchLeads: (...a: unknown[]) => s.searchLeads(...a), getLeadById: (...a: unknown[]) => s.getLeadById(...(a as [number])), updateLead: (...a: unknown[]) => s.updateLead(...a) }
})
vi.mock('@/actions/leadFollowUp', () => ({ setLeadFollowUp: async () => ({}), clearLeadFollowUp: async () => ({}) }))
vi.mock('@/actions/analytics/recordLeadActionEvent', () => ({ recordLeadActionEvent: async () => {} }))
vi.mock('@/lib/toast', async () => {
  const { calSpies: s } = await import('./calendarEnv')
  return { ...(await vi.importActual<typeof import('@/lib/toast')>('@/lib/toast')), toast: (...a: unknown[]) => s.toasts.push(a), proToast: (o: unknown) => s.pro.push(o) }
})

const { fcProps, gesture } = await import('./calendarHarness')
const { I18nProvider } = await import('@/lib/i18n/I18nProvider')
const { translatorFor } = await import('@/lib/i18n/translators')

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const LOCALES = ['he', 'en', 'ar'] as const
type Loc = (typeof LOCALES)[number]
const H = 3_600_000
const dialogs = () => Array.from(document.querySelectorAll('[role="dialog"]'))
const local = (ms: number) => {
  const d = new Date(ms)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`
}
const calls = () => ({
  create: S.createMeeting.mock.calls.map(([a]) => ({ ...(a as object), timezone: typeof (a as { timezone: unknown }).timezone })),
  update: S.updateMeeting.mock.calls,
  completed: S.markMeetingCompleted.mock.calls,
  noShow: S.markMeetingNoShow.mock.calls,
  lead: S.updateLead.mock.calls,
  retry: S.retrySyncMeeting.mock.calls,
  cancel: S.cancelMeeting.mock.calls,
})

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

/** Every write the calendar makes, driven in `locale`; returns what reached the actions. */
async function everyWrite(locale: Loc) {
  const { default: CalendarView } = await import('@/components/calendar/CalendarView')
  const { default: MeetingEditDialog } = await import('@/components/calendar/MeetingEditDialog')
  const m = MEETINGS[0]
  render(<I18nProvider locale={locale}><CalendarView meetings={structuredClone(MEETINGS)} /></I18nProvider>)
  const reverts: number[] = []
  const g1 = gesture(m, new Date(Date.parse(m.startAt) + H), new Date(Date.parse(m.endAt) + H))
  await act(async () => fcProps().eventDrop(g1.arg))
  const g2 = gesture(m, m.startAt, new Date(Date.parse(m.endAt) + H))
  await act(async () => fcProps().eventResize(g2.arg))
  const g3 = gesture({ ...m, status: 'completed' }, new Date(Date.parse(m.startAt) + H), null)
  await act(async () => fcProps().eventDrop(g3.arg))
  reverts.push(g1.reverts.count, g2.reverts.count, g3.reverts.count)
  // New meeting from a date click, with a lead and an attendee.
  await act(async () => fcProps().dateClick({ date: new Date(NOW + 2 * 24 * H) }))
  await act(async () => {})
  let dlg = dialogs().pop()!
  fireEvent.change(dlg.querySelector('input[name="title"]')!, { target: { value: 'שיחת תיאום' } })
  const chips = dlg.querySelector('input[type="email"]') as HTMLInputElement
  fireEvent.change(chips, { target: { value: 'a@example.test' } })
  fireEvent.keyDown(chips, { key: 'Enter' })
  await act(async () => fireEvent.submit(dlg.querySelector('form')!))
  cleanup()
  // Details: outcome + nudge (writes the stored status code), retry, cancel.
  render(<I18nProvider locale={locale}><CalendarView meetings={structuredClone(MEETINGS)} /></I18nProvider>)
  await act(async () => fcProps().eventClick({ event: { extendedProps: { meeting: structuredClone(MEETINGS[0]) } } }))
  dlg = dialogs().pop()!
  // Buttons are found by their label in THIS language (the catalog's), so the test drives the translated UI.
  const t = translatorFor(locale)
  const press = async (label: string) => {
    const b = Array.from(dialogs().pop()!.querySelectorAll('button')).find((x) => x.textContent === label)
    if (!b) throw new Error(`${locale}: no button ${label}`)
    await act(async () => fireEvent.click(b))
  }
  await press(t('calendar.details.markCompleted'))
  await press(t('calendar.outcome.apply', { status: t('leads.status.interested') }))
  await act(async () => fcProps().eventClick({ event: { extendedProps: { meeting: structuredClone(MEETINGS[1]) } } }))
  await press(t('calendar.details.retry'))
  cleanup()
  // Edit: change the title only — only the title is sent.
  render(<I18nProvider locale={locale}><MeetingEditDialog meetingId={EDIT_MEETING.id} onClose={() => {}} /></I18nProvider>)
  await act(async () => {})
  dlg = dialogs().pop()!
  fireEvent.change(dlg.querySelector('input[name="title"]')!, { target: { value: 'כותרת חדשה' } })
  await act(async () => fireEvent.submit(dlg.querySelector('form')!))
  cleanup()
  return { ...calls(), reverts }
}

describe('every write sends the same arguments in every language', () => {
  test('create, drag, resize, outcome + nudge, retry, edit', async () => {
    const out: Record<string, unknown> = {}
    for (const locale of LOCALES) {
      out[locale] = await everyWrite(locale)
      resetCalSpies()
    }
    expect(out.en).toEqual(out.he)
    expect(out.ar).toEqual(out.he)
    const he = out.he as ReturnType<typeof calls> & { reverts: number[] }
    expect(he.create).toHaveLength(1)
    expect(he.update).toHaveLength(3)
    expect(he.completed).toEqual([[{ meetingId: 1 }]])
    expect(he.lead).toEqual([[{ id: 41, status: 'interested' }]])
    expect(he.reverts).toEqual([0, 0, 1])
  })

  test('cancel from the details dialog: same meeting id after the translated confirmation', async () => {
    const { default: CalendarView } = await import('@/components/calendar/CalendarView')
    const sent: Record<string, unknown> = {}
    for (const locale of LOCALES) {
      render(<I18nProvider locale={locale}><CalendarView meetings={structuredClone(MEETINGS)} /></I18nProvider>)
      await act(async () => fcProps().eventClick({ event: { extendedProps: { meeting: structuredClone(MEETINGS[1]) } } }))
      const cancelLabel = translatorFor(locale)('calendar.details.cancel')
      const destructive = Array.from(dialogs().pop()!.querySelectorAll('button')).find((b) => b.textContent === cancelLabel)!
      await act(async () => fireEvent.click(destructive))
      await act(async () => fireEvent.click(Array.from(dialogs().pop()!.querySelectorAll('button')).pop()!))
      sent[locale] = S.cancelMeeting.mock.calls
      cleanup()
      resetCalSpies()
    }
    expect(sent.en).toEqual(sent.he)
    expect(sent.ar).toEqual(sent.he)
    expect(sent.he).toEqual([[2]])
  })
})

describe('validation and accessibility', () => {
  test('validation is shown in the interface language; nothing is sent', async () => {
    const { default: MeetingFormDialog } = await import('@/components/calendar/MeetingFormDialog')
    const shown: Record<string, string[]> = {}
    for (const locale of LOCALES) {
      render(<I18nProvider locale={locale}><MeetingFormDialog open onClose={() => {}} /></I18nProvider>)
      await act(async () => {})
      const dlg = dialogs().pop()!
      const err = () => dlg.querySelector('.text-red-700')?.textContent ?? ''
      const msgs: string[] = []
      await act(async () => fireEvent.submit(dlg.querySelector('form')!))
      msgs.push(err())
      fireEvent.change(dlg.querySelector('input[name="title"]')!, { target: { value: 'x' } })
      fireEvent.change(dlg.querySelector('input[name="startAt"]')!, { target: { value: local(NOW - 5 * H) } })
      fireEvent.change(dlg.querySelector('input[name="endAt"]')!, { target: { value: local(NOW - 4 * H) } })
      await act(async () => fireEvent.submit(dlg.querySelector('form')!))
      msgs.push(err())
      shown[locale] = msgs
      cleanup()
    }
    expect(shown.he).toEqual(['יש להזין כותרת לפגישה', 'לא ניתן ליצור פגישה בתאריך שעבר'])
    expect(shown.en).toEqual(['Enter a meeting title', 'A meeting cannot be created in the past'])
    expect(shown.ar).toEqual(['أدخل عنوانًا للاجتماع', 'لا يمكن إنشاء اجتماع في تاريخ مضى'])
    expect(S.createMeeting).not.toHaveBeenCalled()
  })

  test('Escape closes the dialog and focus returns to the button that opened it; icon-only controls are named', async () => {
    const { default: MeetingFormDialog } = await import('@/components/calendar/MeetingFormDialog')
    const { default: MeetingDetailsDialog } = await import('@/components/calendar/MeetingDetailsDialog')
    // The details dialog (no autofocused field: ModalPop returns focus to what was focused when it opened).
    function Opener() {
      const [open, setOpen] = useState(false)
      return (
        <>
          <button type='button' onClick={() => setOpen(true)}>open</button>
          {open && (
            <MeetingDetailsDialog meeting={MEETINGS[0] as never} onClose={() => setOpen(false)} onCancel={async () => {}} onRetry={async () => {}} onEdit={() => {}} retrying={false} cancelling={false} />
          )}
        </>
      )
    }
    for (const locale of LOCALES) {
      const { getByText } = render(<I18nProvider locale={locale}><Opener /></I18nProvider>)
      const opener = getByText('open')
      opener.focus()
      await act(async () => fireEvent.click(opener))
      await act(async () => {})
      const dlg = dialogs().pop()!
      expect(dlg.querySelector('button[aria-label]')?.getAttribute('aria-label'), locale).toBe({ he: 'סגירה', en: 'Close', ar: 'إغلاق' }[locale])
      await act(async () => fireEvent.keyDown(dlg, { key: 'Escape' }))
      expect(dialogs(), locale).toHaveLength(0)
      expect(document.activeElement, locale).toBe(opener)
      cleanup()
      // The attendee chip's remove button (icon only) is named in the interface language.
      render(<I18nProvider locale={locale}><MeetingFormDialog open onClose={() => {}} /></I18nProvider>)
      await act(async () => {})
      const chips = dialogs().pop()!.querySelector('input[type="email"]') as HTMLInputElement
      fireEvent.change(chips, { target: { value: 'a@example.test' } })
      fireEvent.keyDown(chips, { key: 'Enter' })
      const remove = dialogs().pop()!.querySelector('button[aria-label$="a@example.test"]')!
      expect(remove.getAttribute('aria-label'), locale).toBe({ he: 'הסר a@example.test', en: 'Remove a@example.test', ar: 'إزالة a@example.test' }[locale])
      cleanup()
    }
  })
})
