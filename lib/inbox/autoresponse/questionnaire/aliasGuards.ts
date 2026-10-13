/**
 * Words that change what a phrasing match means. Natural-answer reading only
 * (aliasMatch.ts). Code review 2026-10-13: a per-match 3-word reach let
 * "לא משתמשים באינסטגרם או בפייסבוק" select Facebook and "הכל חוץ מוידאו"
 * select agency 158's "הכל" option; the rules below close both.
 */

/**
 * "הכל חוץ מוידאו", "בלי מגנטים", "במקום וואטסאפ": an exclusion anywhere in the
 * message. Subtracting it is a guess this engine refuses to make, so the whole
 * reply selects nothing and is kept for the rep.
 */
export const EXCLUDING = new Set(['חוץ', 'מלבד', 'פרט', 'במקום', 'בלי', 'ובלי', 'ללא'])

/** "לא", "אין": the match it governs, and every match listed right after it. */
export const NEGATING = new Set(['לא', 'ולא', 'שלא', 'אין', 'ואין', 'שאין'])

/** "אולי", "בעתיד", "מתלבט", "לא בטוח": considering, not answering. Governs the next match only. */
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

/** Words that only join a list: a negation carries across them ("לא X או Y"). */
export const LIST_JOINERS = new Set(['או', 'ואו', 'גם', 'וגם', 'ו'])

/**
 * "אחר" as a word of its own (the Builder's and the engine's rule; otherOption.ts
 * re-exports it). Kept here, import-free, because aliasMatch.ts needs it: "לא
 * חתונה, משהו אחר" contrasts with the negated option, it does not continue the
 * list, so a negation never carries onto an "אחר" option.
 */
export const OTHER_LABEL = /(^|\s)אחר(\s|$)/

/** How many words before a match a guard word reaches. */
export const GUARD_REACH = 3
