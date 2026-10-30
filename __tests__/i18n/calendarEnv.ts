import { vi, type Mock } from 'vitest'
import { NOW } from './leadsFixtures'

/**
 * Fixed data + shared spies behind the /calendar mocks (Phase E1): the Hebrew
 * baseline, the leak gate, the locale and behaviour tests. Meeting titles,
 * attendee e-mails and Google's sync-error text are DATA (Hebrew / English on
 * purpose) — they must reach the screen untouched by any localization.
 *
 * The `vi.mock` calls live in each test file (hoisted per file); their
 * factories read `calEnv` / `calSpies`, so every file records the same way.
 */
export { NOW }

const HOUR = 3_600_000
const DAY = 24 * HOUR
const at = (ms: number) => new Date(ms).toISOString()

export const CAL_USER = { id: 7, name: 'דנה כהן', role: 'ADMIN', agencyId: 103 }

type Meeting = {
  id: number
  leadId: number | null
  title: string
  location: string | null
  timezone: string
  startAt: string
  endAt: string
  status: 'scheduled' | 'cancelled' | 'completed' | 'no_show'
  meetUrl: string | null
  syncStatus: 'pending' | 'synced' | 'failed' | 'reauth_required'
  syncError: string | null
  completedAt: string | null
  noShowAt: string | null
}

const meeting = (id: number, title: string, extra: Partial<Meeting> = {}): Meeting => ({
  id,
  leadId: 41,
  title,
  location: null,
  timezone: 'Asia/Jerusalem',
  startAt: at(NOW + id * DAY),
  endAt: at(NOW + id * DAY + HOUR),
  status: 'scheduled',
  meetUrl: null,
  syncStatus: 'synced',
  syncError: null,
  completedAt: null,
  noShowAt: null,
  ...extra,
})

/** Every sync state, every outcome, with and without a lead / Meet link / sync error. */
export const MEETINGS: Meeting[] = [
  meeting(1, 'פגישת היכרות עם יוסי', { meetUrl: 'https://meet.google.com/abc-defg-hij' }),
  meeting(2, 'שיחת תיאום', { syncStatus: 'failed', syncError: 'Google API 500: backendError' }),
  meeting(3, 'הדגמת מוצר', { syncStatus: 'reauth_required', syncError: 'invalid_grant' }),
  meeting(4, 'מעקב חוזה', { syncStatus: 'pending', leadId: null }),
  meeting(5, 'פגישה שהושלמה', { status: 'completed', startAt: at(NOW - 2 * DAY), endAt: at(NOW - 2 * DAY + HOUR), completedAt: at(NOW - 2 * DAY + HOUR) }),
  meeting(6, 'לקוח לא הגיע', { status: 'no_show', startAt: at(NOW - DAY), endAt: at(NOW - DAY + HOUR), noShowAt: at(NOW - DAY + HOUR) }),
  meeting(7, 'פגישה מבוטלת', { status: 'cancelled' }),
]

export const EDIT_MEETING = {
  id: 1,
  leadId: 41,
  title: MEETINGS[0].title,
  location: null,
  timezone: 'Asia/Jerusalem',
  startAt: MEETINGS[0].startAt,
  endAt: MEETINGS[0].endAt,
  attendees: [
    { email: 'yossi@example.test', displayName: 'יוסי' },
    { email: 'rep@example.test', displayName: null },
  ],
}

export const CAL_DEFAULTS = {
  user: CAL_USER as Record<string, unknown>,
  /** `getCalendarConnectionByUserId`: null = never connected. */
  connection: { sync_status: 'active' } as { sync_status: string } | null,
  meetings: MEETINGS as Meeting[],
  /** `listUpcomingMeetings` arguments, recorded. */
  listArgs: [] as unknown[],
}

export const calEnv = { ...CAL_DEFAULTS, listArgs: [] as unknown[] }

export function resetCalEnv() {
  Object.assign(calEnv, CAL_DEFAULTS, { listArgs: [] })
}

type Fn = Mock<(...a: any[]) => any>
const ok = (syncStatus: string) => ({ ok: true as const, syncStatus })

export const calSpies = {
  toasts: [] as unknown[][],
  pro: [] as unknown[],
  pushes: [] as string[],
  refreshes: 0,
  /** The props the FullCalendar stub last received, and the `loading` placeholder of `next/dynamic`. */
  fc: null as Record<string, any> | null,
  fcLoading: null as null | (() => unknown),
  createMeeting: vi.fn(async (..._a: unknown[]) => ({ ok: true as const, meetingId: 9, meetUrl: null as string | null, syncStatus: 'synced' })) as Fn,
  updateMeeting: vi.fn(async (..._a: unknown[]) => ok('synced')) as Fn,
  cancelMeeting: vi.fn(async (..._a: unknown[]) => ok('synced')) as Fn,
  retrySyncMeeting: vi.fn(async (..._a: unknown[]) => ok('synced')) as Fn,
  getMeetingForEdit: vi.fn(async (..._a: unknown[]) => ({ ok: true as const, meeting: structuredClone(EDIT_MEETING) })) as Fn,
  markMeetingCompleted: vi.fn(async (..._a: unknown[]) => ({ ok: true as const, suggestedLeadStatus: 'interested', leadId: 41 })) as Fn,
  markMeetingNoShow: vi.fn(async (..._a: unknown[]) => ({ ok: true as const, suggestedLeadStatus: null, leadId: 41 })) as Fn,
  updateLead: vi.fn(async (..._a: unknown[]) => ({ ok: true })) as Fn,
  searchLeads: vi.fn(async (..._a: unknown[]) => [{ id: 41, details: 'יוסי לוי', firstName: 'יוסי', lastName: 'לוי', idNum: null }]) as Fn,
  getLeadById: vi.fn(async (id: number) => (id === 99 ? { id, firstName: '', lastName: '' } : { id, firstName: 'יוסי', lastName: 'לוי' })) as Fn,
}

const FNS = [
  'createMeeting',
  'updateMeeting',
  'cancelMeeting',
  'retrySyncMeeting',
  'getMeetingForEdit',
  'markMeetingCompleted',
  'markMeetingNoShow',
  'updateLead',
  'searchLeads',
  'getLeadById',
] as const

const IMPLS = Object.fromEntries(FNS.map((k) => [k, calSpies[k].getMockImplementation()]))

export function resetCalSpies() {
  calSpies.toasts.length = 0
  calSpies.pro.length = 0
  calSpies.pushes.length = 0
  calSpies.refreshes = 0
  for (const k of FNS) {
    calSpies[k].mockReset()
    calSpies[k].mockImplementation(IMPLS[k] as never)
  }
}

/** The mocked `@/actions/calendar` module (every action the calendar screens call). */
export function calendarActionsModule() {
  return {
    listUpcomingMeetings: async (args: unknown) => (calEnv.listArgs.push(args), structuredClone(calEnv.meetings)),
    createMeeting: (...a: unknown[]) => calSpies.createMeeting(...a),
    updateMeeting: (...a: unknown[]) => calSpies.updateMeeting(...a),
    cancelMeeting: (...a: unknown[]) => calSpies.cancelMeeting(...a),
    retrySyncMeeting: (...a: unknown[]) => calSpies.retrySyncMeeting(...a),
    getMeetingForEdit: (...a: unknown[]) => calSpies.getMeetingForEdit(...a),
    markMeetingCompleted: (...a: unknown[]) => calSpies.markMeetingCompleted(...a),
    markMeetingNoShow: (...a: unknown[]) => calSpies.markMeetingNoShow(...a),
  }
}

/** `next/dynamic` for the calendar: the ssr:false FullCalendar becomes a stub that records its props. */
export function calendarDynamicMock(loader: () => Promise<unknown>, opts?: { ssr?: boolean; loading?: () => unknown }) {
  if (opts?.ssr === false) {
    calSpies.fcLoading = opts.loading ?? null
    return function FullCalendarStub(props: Record<string, any>) {
      calSpies.fc = props
      return (opts.loading?.() ?? null) as never
    }
  }
  throw new Error('unexpected next/dynamic import in the calendar')
}

/** Hebrew / external data the calendar screens render verbatim. */
export const CAL_CUSTOMER_DATA = [...MEETINGS.map((m) => m.title), 'יוסי לוי', 'יוסי']
