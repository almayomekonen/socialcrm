/**
 * Words that, just before a phrasing, mean the customer is not choosing it.
 * Natural-answer reading only (aliasMatch.ts); each drops the ONE match it
 * precedes, never the whole message.
 */

/** "לא", "בלי", "חוץ מ…", "מלבד", "במקום": not this one. */
export const EXCLUDING = new Set([
  'לא',
  'ולא',
  'שלא',
  'אין',
  'ואין',
  'שאין',
  'בלי',
  'ובלי',
  'ללא',
  'חוץ',
  'מלבד',
  'פרט',
  'במקום',
])

/** "אולי", "בעתיד", "מתלבט", "לא בטוח": considering, not answering. */
export const HEDGING = new Set([
  'אולי',
  'בעתיד',
  'אם',
  'ואם',
  'מתלבט',
  'מתלבטת',
  'מתלבטים',
  'שוקל',
  'שוקלת',
  'שוקלים',
  'בטוח',
  'בטוחה',
])

/** How many words before a match a guard word reaches. */
export const GUARD_REACH = 3
