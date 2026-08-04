import type { AuthStrategy, ConnectionHealth, SourceSubscriptionState } from '@/lib/automations/catalog/vocabularies'
import type { DeliveryState } from '@/lib/automations/connectors/overview'
import type { StatusRole } from '@/lib/StatusBadge'

/**
 * Every user-facing string on the Connections page, keyed by a CLOSED
 * vocabulary value.
 *
 * `Record<K, …>` throughout: adding a health state, a subscription state or an
 * auth strategy to the catalog vocabulary without deciding its Hebrew is a
 * compile error, not a blank chip in production. That is the whole reason this
 * file exists separately from the components.
 */

export const HEALTH: Record<ConnectionHealth, { role: StatusRole; label: string }> = {
  ok: { role: 'success', label: 'מחובר' },
  needs_reauth: { role: 'warning', label: 'נדרש חיבור מחדש' },
  degraded: { role: 'warning', label: 'החיבור אינו שלם' },
  revoked: { role: 'error', label: 'החיבור נותק' },
}

export const SUBSCRIPTION: Record<SourceSubscriptionState, { role: StatusRole; label: string }> = {
  subscribed: { role: 'success', label: 'פעיל' },
  pending: { role: 'neutral', label: 'ממתין' },
  failed: { role: 'error', label: 'נכשל' },
}

/**
 * What each auth strategy MEANS to the person reading the page, and what the
 * button that starts it should say. One entry per strategy — never a branch in
 * a component.
 */
export const STRATEGY: Record<AuthStrategy, { connect: string; reconnect: string; how: string; needsConnection: boolean }> = {
  /**
   * PROVIDER-HOSTED FLOWS ARE NOT IMPLEMENTED, so they offer no button.
   *
   * `needsConnection: false` is the honest state, not a hidden feature: no
   * registered integration uses either strategy, and the hand-off route that
   * used to answer for them never did anything but say "not open yet". A button
   * leading nowhere is worse than no button.
   *
   * Both stay in the vocabulary. The exhaustive `Record<AuthStrategy, …>` is what
   * forces whoever adds a provider-hosted integration to come back here and
   * build the flow before the card can offer one.
   */
  oauth2: {
    connect: '',
    reconnect: '',
    how: 'החיבור לשירות הזה יתאפשר בהמשך.',
    needsConnection: false,
  },
  api_key: {
    connect: 'יצירת חיבור',
    reconnect: 'יצירת חיבור חדש',
    how: 'נפיק כתובת וקוד סודי שצריך להזין במערכת שלכם.',
    needsConnection: true,
  },
  embedded_signup: {
    connect: '',
    reconnect: '',
    how: 'ההרשמה לשירות הזה תתאפשר בהמשך.',
    needsConnection: false,
  },
  none: {
    connect: '',
    reconnect: '',
    how: 'לא נדרש חיבור — האפשרויות זמינות מיד.',
    needsConnection: false,
  },
}

/**
 * The question a business is actually asking while wiring a webhook up:
 * "is anything getting through?" `never_received` is deliberately a WARNING —
 * a connection that has never received data is not working yet, and saying
 * "מחובר" about it is the lie C3 exists to remove.
 */
export const DELIVERY: Record<DeliveryState, { role: StatusRole; label: string; hint: string }> = {
  disconnected: { role: 'error', label: 'מנותק', hint: 'החיבור אינו פעיל.' },
  never_received: {
    role: 'warning',
    label: 'טרם התקבלו נתונים',
    hint: 'החיבור נוצר, אבל עדיין לא הגיע אליו מידע. שלחו טופס אחד לבדיקה.',
  },
  receiving: { role: 'success', label: 'מקבל אירועים', hint: '' },
  unknown: { role: 'neutral', label: 'מחובר', hint: 'החיבור הזה אינו מדווח על קליטת מידע.' },
}

export const ERRORS: Record<string, string> = {
  forbidden: 'אין לך הרשאה לבצע פעולה זו',
  integration_unknown: 'החיבור המבוקש אינו קיים',
  wrong_auth_strategy: 'סוג החיבור הזה אינו נוצר כך',
  site_url_invalid: 'כתובת האתר אינה תקינה',
  connection_unknown: 'החיבור לא נמצא',
  not_available: 'החיבורים אינם זמינים בחשבון הזה',
}

export const errorMessage = (reason: string) => ERRORS[reason] ?? 'הפעולה נכשלה. נסו שוב.'

/** "לפני 3 שעות" — relative, because an exact timestamp helps nobody here. */
export function timeAgo(iso: string | null): string | null {
  if (!iso) return null
  const diff = Date.now() - new Date(iso).getTime()
  if (!Number.isFinite(diff) || diff < 0) return null
  const minutes = Math.floor(diff / 60_000)
  if (minutes < 1) return 'לפני רגע'
  if (minutes < 60) return `לפני ${minutes} דקות`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `לפני ${hours} שעות`
  const days = Math.floor(hours / 24)
  return days === 1 ? 'אתמול' : `לפני ${days} ימים`
}
