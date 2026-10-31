import type { NotificationFeedItem } from '@/modules/notifications/types'

/**
 * The mutable notification fixtures (Phase F3) — session user, flags, device,
 * stored language preference, feed rows. Kept free of runtime imports: the
 * `vi.mock` factories read it while the registry (imported by the row builders
 * in notificationsEnv.ts) may still be loading the very modules they replace.
 */

export const NOTIF_USER = { id: 7, name: 'דנה כהן', email: 'dana@example.com', role: 'ADMIN', agencyId: 103 }

/** Customer / business data that appears inside notification sentences — never translated. */
export const NOTIF_CUSTOMER_DATA = ['יוסי לוי', 'מיכל אברהם', 'רונית', 'סטודיו נגה']

const DEFAULTS = {
  user: NOTIF_USER as typeof NOTIF_USER | null,
  enabled: true,
  allowlisted: true,
  mobile: false,
  userLocale: null as string | null,
  rows: [] as NotificationFeedItem[],
  /** Arguments the feed read was called with, newest last. */
  feedCalls: [] as Record<string, unknown>[],
}

export const notifEnv = { ...DEFAULTS, rows: [] as NotificationFeedItem[], feedCalls: [] as Record<string, unknown>[] }

export function resetNotifEnv() {
  Object.assign(notifEnv, DEFAULTS, { rows: [], feedCalls: [] })
}
