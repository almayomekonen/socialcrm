import type { AuthStrategy, ConnectionHealth, SourceSubscriptionState } from '@/lib/automations/catalog/vocabularies'
import type { DeliveryState } from '@/lib/automations/connectors/overview'
import type { StatusRole } from '@/lib/StatusBadge'
import type { SetupGuide } from '@/lib/automations/connectors/types'
import type { UiLocale } from '@/lib/i18n/config'
import type { MessageKey } from '@/lib/i18n/translate'
import { translatorFor } from '@/lib/i18n/translators'

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
  /**
   * Arriving, and being refused. The hint is deliberately the customer-facing
   * explanation's subject and not the technical reason — the card renders the
   * mapped copy from `INTAKE_ERRORS` beneath it, which names what was lost.
   */
  rejected: { role: 'error', label: 'פניות נדחות', hint: 'מגיעות פניות לחיבור הזה אבל הן לא נכנסות למערכת.' },
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

// ── The same copy in the interface language (Phase E5b) ─────────────────────
// Display only. Hebrew returns the maps above exactly; other languages word
// the same CODE from the catalog (`admin.connections.*`). Roles, codes and
// the order of every decision are unchanged.

const HEALTH_KEYS: Record<ConnectionHealth, MessageKey> = {
  ok: 'admin.connections.health.ok',
  needs_reauth: 'admin.connections.health.needs_reauth',
  degraded: 'admin.connections.health.degraded',
  revoked: 'admin.connections.health.revoked',
}
const SUBSCRIPTION_KEYS: Record<SourceSubscriptionState, MessageKey> = {
  subscribed: 'admin.connections.subscription.subscribed',
  pending: 'admin.connections.subscription.pending',
  failed: 'admin.connections.subscription.failed',
}
const HOW_KEYS: Record<AuthStrategy, MessageKey> = {
  oauth2: 'admin.connections.strategy.oauth2',
  api_key: 'admin.connections.strategy.apiKey.how',
  embedded_signup: 'admin.connections.strategy.embeddedSignup',
  none: 'admin.connections.strategy.none',
}
const DELIVERY_KEYS: Record<DeliveryState, { label: MessageKey; hint?: MessageKey }> = {
  disconnected: { label: 'admin.connections.delivery.disconnected.label', hint: 'admin.connections.delivery.disconnected.hint' },
  never_received: { label: 'admin.connections.delivery.neverReceived.label', hint: 'admin.connections.delivery.neverReceived.hint' },
  receiving: { label: 'admin.connections.delivery.receiving' },
  rejected: { label: 'admin.connections.delivery.rejected.label', hint: 'admin.connections.delivery.rejected.hint' },
  unknown: { label: 'admin.connections.delivery.unknown.label', hint: 'admin.connections.delivery.unknown.hint' },
}
const ERROR_KEYS: Record<string, MessageKey> = {
  forbidden: 'admin.connections.error.forbidden',
  integration_unknown: 'admin.connections.error.integration_unknown',
  wrong_auth_strategy: 'admin.connections.error.wrong_auth_strategy',
  site_url_invalid: 'admin.connections.error.site_url_invalid',
  connection_unknown: 'admin.connections.error.connection_unknown',
  not_available: 'admin.connections.error.not_available',
}

export function healthIn(health: ConnectionHealth, locale: UiLocale = 'he') {
  return locale === 'he' ? HEALTH[health] : { ...HEALTH[health], label: translatorFor(locale)(HEALTH_KEYS[health]) }
}

export function subscriptionIn(state: SourceSubscriptionState, locale: UiLocale = 'he') {
  return locale === 'he' ? SUBSCRIPTION[state] : { ...SUBSCRIPTION[state], label: translatorFor(locale)(SUBSCRIPTION_KEYS[state]) }
}

/** The strategy with its `how` (and the api_key button labels) worded; `needsConnection` unchanged. */
export function strategyIn(auth: AuthStrategy, locale: UiLocale = 'he') {
  const base = STRATEGY[auth]
  if (locale === 'he') return base
  const t = translatorFor(locale)
  const buttons = base.needsConnection ? { connect: t('admin.connections.strategy.apiKey.connect'), reconnect: t('admin.connections.strategy.apiKey.reconnect') } : {}
  return { ...base, ...buttons, how: t(HOW_KEYS[auth]) }
}

export function deliveryIn(state: DeliveryState, locale: UiLocale = 'he') {
  const base = DELIVERY[state]
  if (locale === 'he') return base
  const t = translatorFor(locale)
  const keys = DELIVERY_KEYS[state]
  return { ...base, label: t(keys.label), hint: keys.hint ? t(keys.hint) : '' }
}

export const errorMessageIn = (reason: string, locale: UiLocale = 'he') =>
  locale === 'he' ? errorMessage(reason) : translatorFor(locale)(ERROR_KEYS[reason] ?? 'admin.connections.error.unknown')

/** `timeAgo` in `locale` (Hebrew: `timeAgo` itself). */
export function timeAgoIn(iso: string | null, locale: UiLocale = 'he'): string | null {
  if (locale === 'he') return timeAgo(iso)
  if (!iso) return null
  const diff = Date.now() - new Date(iso).getTime()
  if (!Number.isFinite(diff) || diff < 0) return null
  const t = translatorFor(locale)
  const minutes = Math.floor(diff / 60_000)
  if (minutes < 1) return t('admin.connections.ago.moment')
  if (minutes < 60) return t('admin.connections.ago.minutes', { count: minutes })
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return t('admin.connections.ago.hours', { count: hours })
  const days = Math.floor(hours / 24)
  return days === 1 ? t('admin.connections.ago.yesterday') : t('admin.connections.ago.days', { count: days })
}

/**
 * The connector's set-up guide in `locale`. A connector words its guide in
 * Hebrew with no codes, so each line is matched by EXACT sentence; a line this
 * map does not know is shown as the connector wrote it. The code snippet, its
 * language and the link's destination are never changed (they are what the
 * customer copies and opens).
 */
const GUIDE_SENTENCES: Record<string, MessageKey> = {
  'חיבור אתר וורדפרס בשלושה צעדים': 'admin.connections.guide.title',
  'החיבור הזה מתאים לאתר שבנוי על וורדפרס. אם האתר שלכם בנוי אחרת, דברו איתנו.': 'admin.connections.guide.step1',
  'היכנסו לניהול וורדפרס של האתר.': 'admin.connections.guide.step2',
  'הוסיפו את קטע הקוד הבא ל-functions.php של ערכת העיצוב, או לתוסף קטעי קוד.': 'admin.connections.guide.step3',
  'שלחו טופס אחד לבדיקה — הטופס יופיע כאן תוך שניות.': 'admin.connections.guide.step4',
  'לא מגיע מידע? בדקו שקטע הקוד נשמר': 'admin.connections.guide.link',
  'קוד לוורדפרס': 'admin.connections.guide.snippet',
}

export function setupGuideIn(guide: SetupGuide | null, locale: UiLocale = 'he'): SetupGuide | null {
  if (!guide || locale === 'he') return guide
  const t = translatorFor(locale)
  const say = (text: string) => (GUIDE_SENTENCES[text] ? t(GUIDE_SENTENCES[text]) : text)
  return {
    ...guide,
    title: say(guide.title),
    steps: guide.steps.map(say),
    ...(guide.snippet ? { snippet: { ...guide.snippet, label: say(guide.snippet.label) } } : {}),
    ...(guide.link ? { link: { ...guide.link, label: say(guide.link.label) } } : {}),
  }
}
