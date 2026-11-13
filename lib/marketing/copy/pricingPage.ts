import { PRICING, TRIAL_OFFER_FAQ_ANSWER } from '@/lib/pricing'
import { TRIAL_LENGTH_DAYS } from '@/lib/trial'
import { HE } from '@/lib/marketing/copy/he'
import type { FaqSectionCopy, PricingCopy } from '@/lib/marketing/copy/types'

/**
 * Copy that exists only on `/pricing`, so the page says something the homepage
 * pricing block does not. Every billing answer is traced to the code:
 *
 *  - trial starts when the card is verified, first charge after it ends:
 *    db/trial.ts, db/payments/chargeScheduling.ts, lib/payments/charges/runChargePass.ts
 *  - a paid period is 30 days and renews automatically: lib/quota/performUpgrade.ts,
 *    chargeScheduling.ts (monthly only — there is no annual purchase)
 *  - cancel is self-serve for workspace admins in Settings → מנוי ותשלום, stops
 *    every charge not yet sent, keeps access to the end of the period:
 *    actions/subscription.ts cancelRenewal, db/payments/cancellation.ts,
 *    lib/i18n/messages/he/settings/payment.ts (cancelBody)
 *  - declined charge: access pauses, retries after 1, 3 and 7 days, a new card
 *    retries at once: lib/payments/charges/retryPolicy.ts, executeCharge.ts
 *  - data is kept when access ends; nothing deletes it: TrialExpiredScreen,
 *    performUpgrade.ts (hidden leads come back on payment)
 *  - price is per workspace, no seat logic anywhere: lib/quota, chargeScheduling.ts
 *
 * Deliberately NOT said: refunds (no refund logic exists), receipts (none are
 * generated in-app), annual billing (not sold in this release).
 */

const price = `${PRICING.currency}${PRICING.monthly}`

export const PRICING_PAGE_META = {
  title: `מחיר מערכת CRM: ${price} לחודש לכל הצוות | SocialCRM`,
  description: `מחיר מערכת CRM של SocialCRM: ${price} לחודש לכל סביבת העבודה, בלי תוספת לכל נציג. ${TRIAL_LENGTH_DAYS} ימי ניסיון במערכת המלאה, בלי חיוב בתקופת הניסיון.`,
  ogTitle: `מחיר SocialCRM: ${price} לחודש לכל הצוות`,
}

/** The pricing section, with the page's H1 in place of the homepage heading. */
export const PRICING_PAGE_HERO: PricingCopy = {
  ...HE.pricing,
  titleLine1: `מחיר SocialCRM: ${price} לחודש,`,
  titleLine2: ' בלי תוספת לכל נציג',
}

export const FLAT_PRICE = {
  title: 'מחיר אחד לכל הצוות, לא מחיר לכל משתמש',
  paragraphs: [
    `הרבה מערכות CRM מתמחרות לפי משתמש: כל נציג שמצטרף מוסיף עוד תשלום חודשי, והחשבון גדל בדיוק כשהעסק מתחיל לגדול. ב-SocialCRM המחיר הוא ${price} לחודש לכל סביבת העבודה. עובדים לבד או עם כמה נציגים, החשבון נשאר אותו חשבון.`,
    `המשמעות בפועל: מוסיפים נציג ומשייכים לו לידים בלי לחשב מחדש כמה זה יעלה. אין הגבלה על מספר הלידים במנוי, ולידים חדשים מפייסבוק, מאינסטגרם ומוואטסאפ נכנסים לאותה רשימה.`,
  ],
  included: {
    title: `מה מקבלים ב-${price} לחודש`,
    items: [
      'לידים ללא הגבלה, ברשימה אחת עם סטטוס, נציג ותאריך מעקב',
      'חיבור לטפסי לידים בפייסבוק ובאינסטגרם ולוואטסאפ העסקי',
      'ייבוא לידים מאקסל, וייצוא לאקסל ול-PDF בכל רגע',
      'שיוך לידים לנציגים וחלוקת עמלות על עסקה משותפת',
      'כל המשתמשים בסביבת העבודה, בלי תוספת לכל נציג',
    ],
  },
}

export const BILLING_FAQ: FaqSectionCopy = {
  ...HE.faq,
  title: 'שאלות על חיוב, ביטול ומה קורה אחרי היום השביעי',
  items: [
    {
      id: 'billing-1',
      question: 'כמה עולה SocialCRM?',
      answer: TRIAL_OFFER_FAQ_ANSWER,
    },
    {
      id: 'billing-2',
      question: 'מתי הכרטיס מחויב בפעם הראשונה?',
      answer: `לא בתקופת הניסיון. ${TRIAL_LENGTH_DAYS} ימי הניסיון מתחילים כשהכרטיס מאומת, והחיוב הראשון של ${price} מתבצע אחרי שהם מסתיימים. מאז המנוי מתחדש אוטומטית כל 30 יום, עד לביטול.`,
    },
    {
      id: 'billing-3',
      question: `מה קורה אחרי היום ה-${TRIAL_LENGTH_DAYS}?`,
      answer: `אם לא ביטלתם, הכרטיס מחויב ב-${price} וממשיכים לעבוד בלי הפסקה, עם כל הלידים, השיחות וההגדרות שכבר נמצאים במערכת. אין מה להעביר ואין מה להגדיר מחדש.`,
    },
    {
      id: 'billing-4',
      question: 'איך מבטלים את המנוי?',
      answer: 'בהגדרות, בעמוד "מנוי ותשלום", לוחצים על "ביטול המנוי" ומאשרים. את הביטול עושה מנהל סביבת העבודה, והוא חל על כל המשתמשים בה. אפשר לחזור בכם ולחדש את המנוי כל עוד הגישה עדיין פעילה.',
    },
    {
      id: 'billing-5',
      question: 'מה קורה אם מבטלים בתקופת הניסיון?',
      answer: `לא מתבצע חיוב. ממשיכים להשתמש במערכת עד סוף ${TRIAL_LENGTH_DAYS} הימים, ואחרי זה הגישה נסגרת. כדי שלא יהיה חיוב בכלל, מבטלים לפני סוף היום ה-${TRIAL_LENGTH_DAYS}.`,
    },
    {
      id: 'billing-6',
      question: 'מה קורה אם מבטלים אחרי שכבר שילמתי?',
      answer: 'לא יבוצעו חיובים נוספים. הגישה נמשכת עד סוף התקופה ששולמה, והלידים והנתונים נשמרים.',
    },
    {
      id: 'billing-7',
      question: 'מה קורה אם החיוב נכשל?',
      answer: 'הגישה למערכת נעצרת עד שהתשלום עובר, והחיוב מנוסה שוב אחרי יום, אחרי שלושה ימים ואחרי שבוע. אם מעדכנים כרטיס חדש בעמוד "מנוי ותשלום", החיוב מנוסה מיד. הלידים לא נמחקים בינתיים.',
    },
    {
      id: 'billing-8',
      question: 'מה קורה ללידים שלי אם אפסיק לשלם?',
      answer: 'הם נשמרים. הגישה למערכת נסגרת, אבל הלידים, השיחות וההיסטוריה נשארים במקומם, וכשמחדשים את המנוי הכול חוזר כמו שהיה.',
    },
    {
      id: 'billing-9',
      question: 'האם משלמים יותר כשמוסיפים נציגים?',
      answer: `לא. ${price} לחודש הוא המחיר של כל סביבת העבודה, בלי תוספת לכל נציג ובלי הגבלה על מספר הלידים.`,
    },
  ],
}
