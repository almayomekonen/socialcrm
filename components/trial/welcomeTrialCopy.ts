/**
 * The welcome modal's copy, one headline and one sentence per state (moved out
 * of WelcomeTrialModal.tsx unchanged, i18n Phase F5).
 */

/**
 * ONE headline and ONE sentence per state, in a single table.
 *
 * The defect this replaces: a fixed header — "SocialCRM Pro פתוח לכם ל־7 ימים"
 * over "ללא עלות · ללא כרטיס אשראי" — rendered above whichever body applied,
 * so an account with no billing path read that Pro was open to it, that no card
 * was needed, and then that the trial had not opened yet. Three claims, two of
 * them false, on the one screen a new customer cannot dismiss.
 *
 * Keeping the copy beside the state it belongs to is what stops a state from
 * inheriting another's promise. Nothing here says a trial is running: the trial
 * begins when Grow's callback is verified, never when this modal renders.
 */
export type View = 'setup' | 'awaiting' | 'unavailable' | 'later' | 'start'

export const COPY: Record<View, { title: string; sub: string }> = {
  setup: { title: 'מתחילים עם 7 ימי ניסיון', sub: 'תקופת הניסיון מתחילה רק לאחר אימות הכרטיס. היום לא יבוצע חיוב.' },
  awaiting: { title: 'הכרטיס נשמר, ואנחנו מאמתים אותו', sub: 'תקופת הניסיון תתחיל מיד לאחר האימות, ולא בוצע חיוב.' },
  unavailable: { title: 'לא ניתן להתחיל כרגע', sub: 'מערכת התשלומים אינה זמינה זמנית, ולכן תקופת הניסיון עדיין לא נפתחה. לא בוצע חיוב.' },
  later: { title: 'תקופת הניסיון תיפתח כאן בקרוב', sub: 'אנחנו משלימים את חיבור התשלומים. החשבון שלכם שמור, לא בוצע חיוב, ואין צורך בשום פעולה.' },
  /* Click-to-start, no card. Unreachable while hasBillingPath() and the card
     variant share one flag, but it is a real no-card path, so it is the one
     state where "ללא כרטיס אשראי" is true and it keeps saying so. */
  start: { title: 'מתחילים עם SocialCRM Pro', sub: 'הצעד הבא: להכניס את הלידים שלכם למערכת.' },
}

/** A closing line for the states that have no action to offer. */
export const TAIL: Record<'awaiting' | 'unavailable' | 'later', string> = {
  awaiting: 'האימות נמשך בדרך כלל מספר שניות. אפשר לרענן את העמוד.',
  unavailable: 'אפשר לנסות שוב מאוחר יותר, או לפנות אלינו ונטפל בזה.',
  later: 'נעדכן אתכם ברגע שאפשר יהיה להתחיל.',
}
