import { vi } from 'vitest'

/**
 * `vi.mock` factories for the notification tests (Phase F3). Only I/O, the
 * router and the toast are replaced; the page, the center, the panel, the bell,
 * the rows, the filters and every copy producer run for real. Each reads
 * `notifEnv` (notificationsEnv.ts).
 */

export const notifSpies = {
  push: vi.fn(),
  refresh: vi.fn(),
  toast: vi.fn(),
}

export function resetNotifSpies() {
  for (const spy of Object.values(notifSpies)) spy.mockClear()
}

export function navigationModule() {
  return {
    usePathname: () => '/notifications',
    useRouter: () => ({ push: notifSpies.push, refresh: notifSpies.refresh, back: () => {}, replace: () => {} }),
    redirect: (to: string) => {
      throw new Error('REDIRECT ' + to)
    },
    notFound: () => {
      throw new Error('NEXT_NOT_FOUND')
    },
  }
}

export function toastModule() {
  return {
    get toast() {
      return notifSpies.toast
    },
    setToastDefaults: () => {},
    resetToastDefaults: () => {},
    default: () => null,
  }
}

export async function authModule() {
  const { notifEnv } = await import('./notificationsState')
  return { getUser: async () => notifEnv.user }
}

export async function uiLocaleModule() {
  const { notifEnv } = await import('./notificationsState')
  return { getUiLocalePrefs: async () => ({ userLocale: notifEnv.userLocale, agencyLocale: null }) }
}

export async function deviceModule() {
  const { notifEnv } = await import('./notificationsState')
  return {
    isMobileRequest: async () => notifEnv.mobile,
    isMobileWorkspaceRequest: async () => notifEnv.mobile,
    getInAppBrowser: async () => null,
  }
}

export async function flagsModule() {
  const { notifEnv } = await import('./notificationsState')
  return {
    isNotificationsEnabled: () => notifEnv.enabled,
    isNotificationsAgencyAllowlisted: () => notifEnv.allowlisted,
    isNotificationsPushEnabled: () => false,
  }
}

export function presenceDbModule() {
  return { readPresence: async () => null, toPresenceRow: () => null }
}

/**
 * The feed read: filters applied to the fixture rows like the SQL does (unread,
 * category, limit). `nextCursorFrom` is the module's own rule, restated (the
 * real module imports the database client).
 */
export async function feedDbModule() {
  const { notifEnv } = await import('./notificationsState')
  return {
    nextCursorFrom: (items: { createdAt: string; id: number }[], limit: number) => {
      if (items.length < limit || items.length === 0) return null
      const last = items[items.length - 1]
      return { createdAt: last.createdAt, id: last.id }
    },
    listNotifications: async (args: { limit: number; unreadOnly?: boolean; category?: string | null }) => {
      notifEnv.feedCalls.push({ ...args })
      return notifEnv.rows
        .filter((r) => !args.unreadOnly || r.readAt === null)
        .filter((r) => !args.category || r.category === args.category)
        .slice(0, args.limit)
        .map(({ toastEligible: _t, ...row }) => row)
    },
  }
}

/** The feed loop polls exactly once, on mount — deterministic, no timers. */
export async function pollModule() {
  const { useEffect } = await import('react')
  return {
    useAdaptivePoll: (poll: () => Promise<unknown>) => {
      useEffect(() => {
        void poll()
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, [])
    },
  }
}
