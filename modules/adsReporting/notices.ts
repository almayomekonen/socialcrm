import type { ConnectionNotice } from '@/lib/connections/messages'

/**
 * Every non-data state of the ad report, each distinct — "no activity" is never
 * shown as an error, and an access problem is never shown as zero spend.
 * Shape and tone follow lib/connections/messages.ts.
 */
export type AdsNoticeKind =
  | 'connect'
  | 'declined'
  | 'expired'
  | 'no_accounts'
  | 'permission'
  | 'rate_limited'
  | 'meta_error'
  | 'no_activity'
  | 'invalid_range'

export const ADS_NOTICES: Record<AdsNoticeKind, ConnectionNotice & { cta?: 'connect' | 'retry' }> = {
  connect: {
    tone: 'attention',
    title: 'חבר את חשבון המודעות כדי לראות ביצועים',
    explanation: 'כדי להציג כאן הוצאה, חשיפות וקליקים של הקמפיינים שלך, פייסבוק דורש אישור לקריאת נתוני המודעות (קריאה בלבד, ללא שינוי קמפיינים).',
    nextStep: 'לאשר את ההרשאה במסך של פייסבוק ולבחור את חשבונות המודעות.',
    action: 'חבר חשבון מודעות',
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
    explanation: 'פייסבוק לא החזיר נתוני ביצועים לחשבון הזה בטווח התאריכים שנבחר — לא הייתה הוצאה או חשיפה.',
    nextStep: 'אפשר לבחור טווח תאריכים אחר או חשבון מודעות אחר.',
  },
  invalid_range: {
    tone: 'attention',
    title: 'טווח התאריכים לא תקין',
    explanation: 'הטווח שנבחר אינו תקין או חורג מ-37 החודשים שפייסבוק מאפשר, ולכן מוצגים 30 הימים האחרונים.',
  },
}
