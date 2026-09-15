import type { AdsFailure } from '@/lib/facebook/ads/insights'
import type { ConnectionNotice } from '@/lib/connections/messages'

/**
 * Every non-data state of the ad report, each distinct — "no activity" is never
 * shown as an error, and an access problem is never shown as zero spend.
 * Shape and tone follow lib/connections/messages.ts.
 */
export type AdsNoticeKind =
  | 'connect'
  | 'connect_failed'
  | 'declined'
  | 'expired'
  | 'no_accounts'
  | 'permission'
  | 'rate_limited'
  | 'meta_error'
  | 'no_activity'
  | 'invalid_range'

/** Meta's failure reason → the notice that explains it (never rendered as zero). */
export const FAILURE_NOTICE: Record<AdsFailure, AdsNoticeKind> = {
  reconnect_required: 'expired',
  permission_missing: 'permission',
  rate_limited: 'rate_limited',
  meta_error: 'meta_error',
}

export const ADS_NOTICES: Record<AdsNoticeKind, ConnectionNotice & { cta?: 'connect' | 'retry' }> = {
  connect: {
    tone: 'attention',
    title: 'חבר את חשבון המודעות כדי לראות ביצועים',
    explanation: 'כדי להציג כאן הוצאה, חשיפות וקליקים של הקמפיינים שלך, פייסבוק דורש אישור לקריאת נתוני המודעות (קריאה בלבד, ללא שינוי קמפיינים).',
    nextStep: 'לאשר את ההרשאה במסך של פייסבוק ולבחור את חשבונות המודעות.',
    action: 'חבר חשבון מודעות',
    cta: 'connect',
  },
  // The OAuth return itself failed (token exchange, permission read, save, or an
  // expired CSRF state). Distinct from "never connected": the user just tried.
  connect_failed: {
    tone: 'error',
    title: 'החיבור לחשבון המודעות לא הושלם',
    explanation: 'חזרת מפייסבוק, אבל לא הצלחנו להשלים ולשמור את החיבור. לא נשמר חיבור ולא נקראו נתונים.',
    reasons: ['מסך האישור של פייסבוק נשאר פתוח יותר מ-10 דקות', 'תקלה זמנית בפייסבוק או אצלנו'],
    nextStep: 'לחבר שוב.',
    action: 'חבר שוב',
    cta: 'connect',
  },
  declined: {
    tone: 'attention',
    title: 'ההרשאה לקריאת נתוני המודעות לא אושרה',
    explanation: 'במסך האישור של פייסבוק ההרשאה לא סומנה, ולכן לא נשמר חיבור ולא נקראו נתונים.',
    nextStep: 'אפשר לנסות שוב ולסמן את ההרשאה.',
    action: 'לנסות שוב',
    cta: 'connect',
  },
  expired: {
    tone: 'attention',
    title: 'החיבור לחשבון המודעות פג',
    explanation: 'הגישה לנתוני המודעות פגה או בוטלה בפייסבוק. לא נמחקו נתונים.',
    nextStep: 'לחבר מחדש כדי להמשיך לראות ביצועים.',
    action: 'חבר מחדש',
    cta: 'connect',
  },
  no_accounts: {
    tone: 'attention',
    title: 'לא נמצאו חשבונות מודעות',
    explanation: 'החיבור הצליח, אבל פייסבוק לא החזיר אף חשבון מודעות שהמשתמש המחובר מורשה לצפות בו.',
    reasons: ['לא נבחר חשבון מודעות במסך האישור', 'למשתמש אין הרשאה לחשבון המודעות ב-Business Manager'],
    nextStep: 'לחבר מחדש ולבחור את חשבון המודעות, או לבקש גישה לחשבון.',
    action: 'חבר מחדש ובחר חשבון',
    cta: 'connect',
  },
  permission: {
    tone: 'error',
    title: 'אין גישה לנתוני חשבון המודעות הזה',
    explanation: 'פייסבוק סירב לקריאת הביצועים של החשבון שנבחר. זו בעיית הרשאה — לא היעדר פעילות.',
    reasons: ['ההרשאה לחשבון הוסרה', 'הגישה לחשבון ב-Business Manager השתנתה'],
    nextStep: 'לחבר מחדש ולוודא שחשבון המודעות נבחר ושיש לך גישה אליו.',
    action: 'חבר מחדש',
    cta: 'connect',
  },
  rate_limited: {
    tone: 'attention',
    title: 'פייסבוק מגביל כרגע את קצב הבקשות',
    explanation: 'הנתונים לא נטענו כי חשבון המודעות הגיע למגבלת הבקשות של פייסבוק.',
    nextStep: 'לנסות שוב בעוד כמה דקות.',
    action: 'נסה שוב',
    cta: 'retry',
  },
  meta_error: {
    tone: 'error',
    title: 'לא הצלחנו לטעון את נתוני המודעות',
    explanation: 'פייסבוק לא החזיר תשובה תקינה. זה לא אומר שאין פעילות.',
    nextStep: 'לנסות שוב בעוד רגע.',
    action: 'נסה שוב',
    cta: 'retry',
  },
  no_activity: {
    tone: 'attention',
    title: 'אין פעילות בטווח הזה',
    explanation:
      'Meta לא החזירה נתוני ביצועים לחשבון הזה בטווח התאריכים שנבחר — לא הייתה הוצאה או חשיפה בטווח הזה. זה לא אומר שהחשבון לא פרסם בתקופות אחרות.',
    nextStep: 'אפשר לבחור טווח תאריכים אחר (למשל טווח מותאם) או חשבון מודעות אחר.',
  },
  invalid_range: {
    tone: 'attention',
    title: 'טווח התאריכים לא תקין',
    explanation: 'הטווח שנבחר אינו תקין או חורג מ-37 החודשים שפייסבוק מאפשר, ולכן מוצגים 30 הימים האחרונים.',
  },
}

/**
 * The state for a user with NO stored ad connection, from the OAuth return's
 * `ads_error` (lib/facebook/ads/handleAdsOAuthCallback.ts). Cancelling on Meta's
 * screen and unticking the permission are both a decline; a failure after Meta
 * returned is `connect_failed`, never the neutral first-time prompt.
 */
export function noConnectionNotice(adsError: string | undefined): AdsNoticeKind {
  if (adsError === 'declined' || adsError === 'denied') return 'declined'
  if (adsError === 'token' || adsError === 'save' || adsError === 'state') return 'connect_failed'
  return 'connect'
}
