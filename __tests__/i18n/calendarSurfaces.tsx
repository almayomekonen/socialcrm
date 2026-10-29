import type { Surface } from './surfaces'
import { calShell, calendarPage, withCalEnv } from './calendarHarness'

/**
 * Leak-gate registrations for /calendar (Phase E1, desktop). Spread into
 * SURFACES (surfaces.tsx); rendering relies on the mocks in leakGate.test.tsx.
 * FullCalendar is client-only (`ssr: false`), so the grid's own text and the
 * portalled dialogs are scanned in calendarLocales.test.tsx, where they are opened.
 */

export const CALENDAR_SURFACES: Surface[] = [
  {
    name: 'calendar — not connected',
    route: '/calendar',
    render: async (locale) => calShell(locale, await withCalEnv({ connection: null }, () => calendarPage())),
    allowed: [],
  },
  {
    name: 'calendar — connected: heading, new-meeting button, grid shell',
    route: '/calendar',
    render: async (locale) => calShell(locale, await withCalEnv({}, () => calendarPage())),
    allowed: [],
  },
  {
    name: 'calendar — reconnect notice',
    route: '/calendar',
    render: async (locale) => calShell(locale, await withCalEnv({ connection: { sync_status: 'reauth_required' } }, () => calendarPage())),
    allowed: [],
  },
]

