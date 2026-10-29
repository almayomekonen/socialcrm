import type { ReactNode } from 'react'
import type { UiLocale } from '@/lib/i18n/config'
import { resolveAsync } from './dashboardHarness'
import { ACTIVE } from './leadTabsEnv'
import { CAL_DEFAULTS, calEnv, calSpies } from './calendarEnv'

/**
 * Renders /calendar the way the (app) layout does: the interface-language
 * provider and the entitlement state around the REAL server page. Mocks live
 * in each test file (see calendarEnv for the module factories).
 */

type Ent = { hasAccess: boolean; status: string; expiresAt: string | null }

export async function calShell(locale: UiLocale | null, node: ReactNode, ent: Ent = ACTIVE) {
  const { I18nProvider } = await import('@/lib/i18n/I18nProvider')
  const { EntitlementProvider } = await import('@/lib/entitlement/EntitlementContext')
  const inner = <EntitlementProvider value={ent}>{node}</EntitlementProvider>
  // `null`: no provider at all — the Hebrew baseline renders exactly as before i18n.
  return locale ? <I18nProvider locale={locale}>{inner}</I18nProvider> : inner
}

export async function calendarPage() {
  const { default: Page } = await import('@/app/(app)/calendar/page')
  return resolveAsync(await Page())
}

/** Run the page's server reads under `overrides`, then restore the defaults other surfaces expect. */
export async function withCalEnv<T>(overrides: Partial<typeof CAL_DEFAULTS>, build: () => Promise<T>): Promise<T> {
  Object.assign(calEnv, CAL_DEFAULTS, overrides)
  try {
    return await build()
  } finally {
    Object.assign(calEnv, CAL_DEFAULTS)
  }
}

/** A FullCalendar gesture argument: the meeting as an event at new times, with a revert counter. */
export function gesture(meeting: Record<string, any>, start: string | Date | null, end: string | Date | null, oldEnd?: string) {
  const reverts = { count: 0 }
  const toDate = (v: string | Date | null) => (v == null ? null : new Date(v))
  return {
    reverts,
    arg: {
      event: { start: toDate(start), end: toDate(end), extendedProps: { meeting } },
      oldEvent: { end: toDate(oldEnd ?? meeting.endAt) },
      revert: () => void reverts.count++,
    } as never,
  }
}

/** The props the FullCalendar stub received on the last render. */
export function fcProps() {
  if (!calSpies.fc) throw new Error('FullCalendar stub not rendered')
  return calSpies.fc
}
