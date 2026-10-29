// @vitest-environment jsdom
import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from 'vitest'
import { act } from 'react'
import { renderToString } from 'react-dom/server'
import { hydrateRoot } from 'react-dom/client'
import { cleanup, fireEvent, render } from '@testing-library/react'
import { EXPIRED } from './leadTabsEnv'
import { CAL_CUSTOMER_DATA, MEETINGS, NOW, calEnv, calSpies as S, resetCalEnv, resetCalSpies } from './calendarEnv'
import { findHebrewLeaks } from './leakScan'

/**
 * /calendar in en / ar: the page states, the grid configuration handed to
 * FullCalendar (text, locale pack, direction, week start, clock), every
 * dialog (new, success, details, nudge, cancel confirmation, edit) scanned for
 * Hebrew, toasts and Pro prompts, tab title, hydration and a language switch.
 * Behaviour: calendarBehaviour.test.tsx. Hebrew is pinned by
 * calendarHebrewBaseline*.
 */

const prefs = vi.hoisted(() => ({ userLocale: 'en' as string | null }))
vi.mock('next/navigation', async () => {
  const { calSpies: s } = await import('./calendarEnv')
  return { useRouter: () => ({ push: (to: string) => s.pushes.push(to), replace: () => {}, refresh: () => void s.refreshes++ }) }
})
vi.mock('next/dynamic', async () => ({ default: (await import('./calendarEnv')).calendarDynamicMock }))
vi.mock('@/db/auth', async () => ({ getUser: async () => (await import('./calendarEnv')).calEnv.user }))
vi.mock('@/lib/requireUser', async () => ({ requireAgencyUser: async () => (await import('./calendarEnv')).calEnv.user }))
vi.mock('@/db/uiLocale', () => ({ getUiLocalePrefs: async () => ({ userLocale: prefs.userLocale, agencyLocale: null }) }))
vi.mock('@/lib/device', () => ({ isMobileRequest: async () => false, isMobileWorkspaceRequest: async () => false }))
vi.mock('@/lib/analytics/track', () => ({ track: () => {} }))
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
  return { ...(await vi.importActual<typeof import('@/lib/toast')>('@/lib/toast')), toast: (...a: unknown[]) => s.toasts.push(a), proToast: (o: unknown) => s.pro.push(o) }
})

const { calShell, calendarPage, fcProps, gesture, withCalEnv } = await import('./calendarHarness')

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

type Loc = 'he' | 'en' | 'ar'
const textOf = (el: Element) => (el.textContent ?? '').replace(/[‎‏]/g, '').replace(/\s+/g, ' ')
const has = (text: string, ...parts: string[]) => {
  for (const p of parts) expect(text, p).toContain(p)
}
const regionOf = (el: Element | null) => [el?.getAttribute('lang') ?? null, el?.getAttribute('dir') ?? null]
const DIR = { en: 'ltr', ar: 'rtl' } as const
const data = [...CAL_CUSTOMER_DATA, 'Google API 500: backendError'].map((text) => ({ text, reason: 'customer-data' as const }))
const hebrewIn = (v: unknown) => /[֐-׿]/.test(JSON.stringify(v))
const dialogs = () => Array.from(document.querySelectorAll('[role="dialog"]'))
const btn = (text: string) => Array.from(document.querySelectorAll('[role="dialog"] button')).find((b) => b.textContent === text) as HTMLButtonElement

async function page(locale: Loc, overrides: Partial<typeof calEnv> = {}) {
  prefs.userLocale = locale
  return calShell(locale, await withCalEnv(overrides, () => calendarPage()))
}
async function view(locale: Loc, ent?: typeof EXPIRED) {
  const { default: CalendarView } = await import('@/components/calendar/CalendarView')
  const { I18nProvider } = await import('@/lib/i18n/I18nProvider')
  const { EntitlementProvider } = await import('@/lib/entitlement/EntitlementContext')
  const node = <CalendarView meetings={structuredClone(MEETINGS)} />
  return render(<I18nProvider locale={locale}>{ent ? <EntitlementProvider value={ent}>{node}</EntitlementProvider> : node}</I18nProvider>)
}

const savedEnv = { ...process.env }
beforeAll(() => {
  Object.assign(HTMLElement.prototype, { showPopover() {}, hidePopover() {}, togglePopover() {} })
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
  resetCalEnv()
  resetCalSpies()
})

describe('/calendar page in en / ar', () => {
  test('not connected, connected, reconnect notice; region; Hebrew declares nothing', async () => {
    for (const locale of ['en', 'ar'] as const) {
      const nc = render(await page(locale, { connection: null }))
      has(textOf(nc.container), ...(locale === 'en' ? ['Meetings', 'Connect your calendar', 'Connect calendar'] : ['الاجتماعات', 'اربط تقويمك', 'ربط التقويم']))
      expect(regionOf(nc.container.firstElementChild), locale).toEqual([locale, DIR[locale]])
      expect(findHebrewLeaks(nc.container, [])).toEqual([])
      cleanup()
      const re = render(await page(locale, { connection: { sync_status: 'reauth_required' } }))
      has(textOf(re.container), ...(locale === 'en' ? ['New meeting', 'Your Google Calendar connection has expired', 'Reconnect', 'Loading calendar…'] : ['اجتماع جديد', 'إعادة الربط', 'جارٍ تحميل التقويم…']))
      expect(findHebrewLeaks(re.container, [])).toEqual([])
      cleanup()
    }
    const he = render(await page('he'))
    expect(he.container.querySelector('[lang], [dir]')).toBeNull()
    has(textOf(he.container), 'פגישות', 'פגישה חדשה')
  })

  test('tab title', async () => {
    const mod = await import('@/app/(app)/calendar/page')
    prefs.userLocale = 'en'
    expect(await mod.generateMetadata()).toEqual({ title: 'Meetings' })
    prefs.userLocale = 'ar'
    expect(await mod.generateMetadata()).toEqual({ title: 'الاجتماعات' })
    process.env.UI_LOCALE_ENABLED = ''
    expect(await mod.generateMetadata()).toEqual({ title: 'פגישות' })
    process.env.UI_LOCALE_ENABLED = '1'
  })
})

describe('the grid configuration', () => {
  test('toolbar text, locale pack (Arabic with Latin digits), direction; week start and 24h clock unchanged', async () => {
    const out: Record<string, unknown> = {}
    for (const locale of ['he', 'en', 'ar'] as const) {
      await view(locale)
      const p = fcProps()
      out[locale] = { buttonText: p.buttonText, locale: typeof p.locale === 'string' ? p.locale : p.locale.code, direction: p.direction }
      expect([p.firstDay, p.slotLabelFormat.hour12, p.eventTimeFormat.hour12], locale).toEqual([0, false, false])
      cleanup()
    }
    expect(out).toEqual({
      he: { buttonText: { today: 'היום', month: 'חודש', week: 'שבוע', day: 'יום' }, locale: 'he', direction: 'rtl' },
      en: { buttonText: { today: 'Today', month: 'Month', week: 'Week', day: 'Day' }, locale: 'en', direction: 'ltr' },
      ar: { buttonText: { today: 'اليوم', month: 'شهر', week: 'أسبوع', day: 'يوم' }, locale: 'ar-u-nu-latn', direction: 'rtl' },
    })
    expect(new Intl.DateTimeFormat('ar-u-nu-latn', { day: 'numeric' }).format(new Date(NOW))).toBe('28')
  })

  test('gesture toasts and Pro prompts are translated (no Hebrew) in en and ar', async () => {
    const m = MEETINGS[0]
    for (const locale of ['en', 'ar'] as const) {
      await view(locale)
      const plus = (iso: string, h: number) => new Date(Date.parse(iso) + h * 3_600_000).toISOString()
      await act(async () => fcProps().eventDrop(gesture({ ...m, status: 'completed' }, plus(m.startAt, 1), plus(m.endAt, 1)).arg))
      await act(async () => fcProps().eventDrop(gesture(m, plus(m.startAt, 1), plus(m.endAt, 1)).arg))
      S.updateMeeting.mockImplementation(async () => ({ ok: false, reason: 'not_owner' }))
      await act(async () => fcProps().eventResize(gesture(m, m.startAt, plus(m.endAt, 1)).arg))
      await act(async () => fcProps().eventResize(gesture(m, m.startAt, plus(m.startAt, 0.01)).arg))
      await act(async () => fcProps().eventClick({ event: { extendedProps: { meeting: structuredClone(MEETINGS[1]) } } }))
      await act(async () => btn(locale === 'en' ? 'Try syncing again' : 'إعادة محاولة المزامنة').click())
      cleanup()
      await view(locale, EXPIRED)
      await act(async () => fcProps().dateClick({ date: new Date(NOW + 86_400_000) }))
      await act(async () => fcProps().eventDrop(gesture(m, plus(m.startAt, 1), plus(m.endAt, 1)).arg))
      await act(async () => fcProps().eventClick({ event: { extendedProps: { meeting: structuredClone(MEETINGS[1]) } } }))
      await act(async () => btn(locale === 'en' ? 'Try syncing again' : 'إعادة محاولة المزامنة').click())
      await act(async () => btn(locale === 'en' ? 'Edit meeting' : 'تعديل الاجتماع').click())
      await act(async () => btn(locale === 'en' ? 'Mark as completed' : 'تحديد كمكتمل').click())
      expect(S.toasts.length, locale).toBe(5)
      expect(S.pro.length, locale).toBe(5)
      expect(hebrewIn(S.toasts), JSON.stringify(S.toasts)).toBe(false)
      expect(hebrewIn(S.pro), JSON.stringify(S.pro)).toBe(false)
      if (locale === 'en') {
        expect(S.toasts.map((t) => t[1])).toEqual([
          'A meeting that is already marked cannot be moved',
          'Meeting moved and synced to Google Calendar',
          'You are not allowed to update this meeting',
          'A meeting must be at least 5 minutes long',
          'Meeting synced',
        ])
      }
      cleanup()
      resetCalSpies()
    }
  })
})

describe('dialogs in en / ar: no Hebrew outside data, the region is declared', () => {
  test('new meeting (no lead, a lead, validation, chips error) and every success view', async () => {
    const { default: MeetingFormDialog } = await import('@/components/calendar/MeetingFormDialog')
    const { default: SuccessView } = await import('@/components/calendar/MeetingSuccessView')
    const { I18nProvider } = await import('@/lib/i18n/I18nProvider')
    for (const locale of ['en', 'ar'] as const) {
      for (const leadId of [undefined, 41, 99]) {
        render(<I18nProvider locale={locale}><MeetingFormDialog open onClose={() => {}} leadId={leadId} /></I18nProvider>)
        await act(async () => {})
        const dlg = dialogs().pop()!
        await act(async () => fireEvent.submit(dlg.querySelector('form')!))
        const chips = dlg.querySelector('input[type="email"]') as HTMLInputElement
        fireEvent.change(chips, { target: { value: 'nope' } })
        fireEvent.keyDown(chips, { key: 'Enter' })
        expect(regionOf(dlg), locale).toEqual([locale, DIR[locale]])
        expect(findHebrewLeaks(dlg, data), `${locale} lead=${leadId}`).toEqual([])
        if (locale === 'en') has(textOf(dlg), 'New meeting', 'Enter a meeting title', 'Invalid address: nope', leadId === 99 ? 'Lead #99' : leadId ? 'יוסי לוי' : 'Choose a lead')
        cleanup()
      }
      for (const [syncStatus, attendeeCount, meetUrl] of [['synced', 2, 'https://meet.google.com/x'], ['synced', 0, null], ['synced', 1, null], ['failed', 1, null], ['reauth_required', 0, null]] as const) {
        const { container } = render(
          <I18nProvider locale={locale}>
            <SuccessView data={{ title: 'שיחת תיאום', startAt: new Date(NOW + 3_600_000), endAt: new Date(NOW + 7_200_000), attendeeCount, meetUrl, syncStatus }} onClose={() => {}} />
          </I18nProvider>,
        )
        expect(findHebrewLeaks(container, [{ text: 'שיחת תיאום', reason: 'customer-data' }], new Set()), `${locale} ${syncStatus}`).toEqual([])
        if (locale === 'en' && attendeeCount === 2) has(textOf(container), 'Meeting created', '2 attendees · Google sent an invitation', 'Open Google Meet')
        if (locale === 'en' && attendeeCount === 1 && syncStatus === 'synced') has(textOf(container), '1 attendee · Google sent an invitation')
        cleanup()
      }
    }
  })

  test('details for every meeting, the nudge, the cancel confirmation, and edit', async () => {
    const { default: MeetingDetailsDialog } = await import('@/components/calendar/MeetingDetailsDialog')
    const { default: MeetingEditDialog } = await import('@/components/calendar/MeetingEditDialog')
    const { I18nProvider } = await import('@/lib/i18n/I18nProvider')
    for (const locale of ['en', 'ar'] as const) {
      for (const m of MEETINGS) {
        render(<I18nProvider locale={locale}><MeetingDetailsDialog meeting={m as never} onClose={() => {}} onCancel={async () => {}} onRetry={async () => {}} onEdit={() => {}} retrying={false} cancelling={false} /></I18nProvider>)
        await act(async () => {})
        const dlg = dialogs().pop()!
        expect(regionOf(dlg), locale).toEqual([locale, DIR[locale]])
        expect(findHebrewLeaks(dlg, data), `${locale} ${m.id}`).toEqual([])
        if (m.id === 1) {
          await act(async () => fireEvent.click(btn(locale === 'en' ? 'Mark as completed' : 'تحديد كمكتمل')))
          expect(findHebrewLeaks(dialogs().pop()!, data), `${locale} nudge`).toEqual([])
          if (locale === 'en') has(textOf(dialogs().pop()!), 'We recommend updating the lead status to', 'Interested', 'Update status to Interested', 'Not now')
        }
        if (m.id === 2) {
          await act(async () => fireEvent.click(btn(locale === 'en' ? 'Cancel meeting' : 'إلغاء الاجتماع')))
          const confirm = dialogs().pop()!
          expect(regionOf(confirm)).toEqual([locale, DIR[locale]])
          expect(findHebrewLeaks(confirm, data), `${locale} confirm`).toEqual([])
          if (locale === 'en') has(textOf(confirm), 'Cancel the meeting "שיחת תיאום"?', 'Attendees will receive a cancellation notice.')
        }
        if (locale === 'en' && m.id === 5) has(textOf(dlg), 'Completed', 'View lead →')
        cleanup()
      }
      for (const result of [{ ok: true }, { ok: false, reason: 'not_owner' }]) {
        if (!result.ok) S.getMeetingForEdit.mockImplementation(async () => result)
        render(<I18nProvider locale={locale}><MeetingEditDialog meetingId={1} onClose={() => {}} /></I18nProvider>)
        await act(async () => {})
        const dlg = dialogs().pop()!
        expect(regionOf(dlg), locale).toEqual([locale, DIR[locale]])
        expect(findHebrewLeaks(dlg, data), `${locale} edit ${result.ok}`).toEqual([])
        if (locale === 'en') has(textOf(dlg), ...(result.ok ? ['Edit meeting', 'Save changes', 'Attendees'] : ['Error', 'You are not allowed to edit this meeting']))
        if (locale === 'en' && result.ok) expect(dlg.querySelector('[aria-label="Remove yossi@example.test"]')).not.toBeNull()
        cleanup()
        resetCalSpies()
      }
    }
  })
})

describe('language switch and hydration', () => {
  test('the view re-renders in the new language within one session', async () => {
    const { default: CalendarView } = await import('@/components/calendar/CalendarView')
    const { I18nProvider } = await import('@/lib/i18n/I18nProvider')
    const v = render(<I18nProvider locale='en'><CalendarView meetings={[]} needsReauth /></I18nProvider>)
    has(textOf(v.container), 'New meeting', 'Reconnect')
    v.rerender(<I18nProvider locale='ar'><CalendarView meetings={[]} needsReauth /></I18nProvider>)
    has(textOf(v.container), 'اجتماع جديد', 'إعادة الربط')
    expect(fcProps().direction).toBe('rtl')
    v.rerender(<I18nProvider locale='he'><CalendarView meetings={[]} needsReauth /></I18nProvider>)
    has(textOf(v.container), 'פגישה חדשה', 'חבר מחדש')
  })

  for (const locale of ['he', 'en', 'ar'] as const) {
    for (const [name, overrides] of [['not connected', { connection: null }], ['connected', {}], ['reauth', { connection: { sync_status: 'reauth_required' } }]] as const) {
      test(`hydration ${locale} · ${name}`, async () => {
        const node = await page(locale, overrides as Partial<typeof calEnv>)
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
