/**
 * THE WHATSAPP ASSISTANT REGRESSION SET — what the owner types, and what a good
 * reply must and must not be.
 *
 * PROVENANCE. `real` cases are the owner questions recorded in production
 * `agent_investigations` (57 rows, 2026-08-24 → 2026-10-31, agencies 103 and
 * 161), de-duplicated. Lead names are swapped for leads that exist in the eval
 * tenant, so a lead question exercises a real lookup instead of a not-found.
 * Multi-turn cases carry the turns that preceded them in production, with the
 * assistant side as the headline it actually sent. `synthetic` cases cover the
 * short social messages and the product areas the owner asked to be covered
 * (2026-10-31 P0 brief) that no recorded question reached yet.
 *
 * WHAT IS ASSERTED. Only what can be checked without a judge: no fallback, no
 * unnecessary tool calls, the reply format, no refused answer, and per-case
 * patterns for the few answers whose correct content is a fixed fact. Everything
 * else is recorded for a human to read side by side (results/).
 *
 * The expectations were written BEFORE the baseline run and are the same for
 * both runs.
 */

export type CaseKind = 'social' | 'product' | 'financial' | 'business' | 'lead' | 'meeting'

export type Turn = { role: 'user' | 'assistant'; content: string }

export type EvalCase = {
  id: string
  kind: CaseKind
  origin: 'real' | 'synthetic'
  /** The production investigation id this case was recovered from, when real. */
  prodId?: number
  question: string
  history?: Turn[]
  /** A tool the answer must have called; omitted = not checked. */
  tool?: string
  /** Upper bound on tool calls; omitted = not checked. */
  maxTools?: number
  /** A plain conversational reply: no bold report headline, no bullets, no app link. */
  plain?: boolean
  /** Every pattern must appear in the reply. */
  mustMatch?: readonly RegExp[]
  /** No pattern may appear in the reply. */
  mustNotMatch?: readonly RegExp[]
}

/** The documented failures this phase must change, by case id. */
export const DOCUMENTED_FAILURES = {
  casual: 'S2', // "אלוף" → the generic no-data reply (prod #41)
  ambiguousFollowUp: 'M7', // "סלמתאק" mid meeting flow (prod #47)
  product: 'P1', // "מה חדש במערכת?" (prod #24, #43)
  financial: 'F1', // "כמה העסק שלי עשה השנה?" (prod #50)
  recommendation: 'B12', // "מי הליד הכי חם?" refused RULE_05 (prod #52)
} as const

const SOCIAL = { kind: 'social', maxTools: 0, plain: true, mustNotMatch: [/לא מצאתי/, /מספיק נתונים/] } as const
const PRODUCT = { kind: 'product', maxTools: 0, mustNotMatch: [/לא מצאתי במערכת מספיק נתונים/] } as const

const MEETING_OPEN: Turn[] = [
  { role: 'user', content: 'תקבע לי פגישה עם ליד' },
  { role: 'assistant', content: 'עם איזה ליד לקבוע את הפגישה?' },
  { role: 'user', content: 'עם יוסי' },
  { role: 'assistant', content: 'מצאתי את יוסי הזדמנות. מה כותרת הפגישה, באיזה תאריך ושעה, ולכמה דקות?' },
  { role: 'user', content: 'מחר בשעה 10 וחצי' },
  { role: 'assistant', content: 'מה כותרת הפגישה ולכמה דקות לקבוע אותה?' },
]

export const CASES: readonly EvalCase[] = [
  // ── social ──────────────────────────────────────────────────────────────
  { id: 'S1', ...SOCIAL, origin: 'real', prodId: 21, question: 'hey' },
  { id: 'S2', ...SOCIAL, origin: 'real', prodId: 41, question: 'אלוף' },
  { id: 'S3', ...SOCIAL, origin: 'synthetic', question: 'תודה' },
  { id: 'S4', ...SOCIAL, origin: 'synthetic', question: 'מה נשמע?' },
  { id: 'S5', ...SOCIAL, origin: 'synthetic', question: 'סלמתאק' },
  {
    id: 'S6',
    ...SOCIAL,
    origin: 'synthetic',
    question: 'אלוף, תודה',
    history: [
      { role: 'user', content: 'סכם לי את היום' },
      { role: 'assistant', content: 'יש היום 10 לידים שממתינים לטיפול, והראשון בתור הוא דנה.' },
    ],
  },

  // ── product ─────────────────────────────────────────────────────────────
  {
    id: 'P1',
    ...PRODUCT,
    origin: 'real',
    prodId: 43,
    question: 'מה חדש במערכת?',
    mustNotMatch: [...PRODUCT.mustNotMatch, /אין לי (כרגע )?מידע מוסמך/],
  },
  { id: 'P2', ...PRODUCT, origin: 'real', prodId: 10, question: 'איך אני מחבר את חשבון הוואטסאפ?', mustMatch: [/אינטגרציות/] },
  { id: 'P3', ...PRODUCT, origin: 'real', prodId: 32, question: 'תעזור לי לבנות בוט בוואטסאפ' },
  {
    id: 'P4',
    ...PRODUCT,
    origin: 'real',
    prodId: 33,
    question: 'יש שאלון וואטסאפ',
    history: [
      { role: 'user', content: 'תעזור לי לבנות בוט בוואטסאפ' },
      { role: 'assistant', content: 'אפשר לתכנן את הבוט, אבל אין לי מידע שמאשר ש-SocialCRM עצמה כוללת כלי לבניית בוט וואטסאפ.' },
    ],
  },
  { id: 'P5', ...PRODUCT, origin: 'synthetic', question: 'כמה עולה SocialCRM?', mustMatch: [/89/] },
  { id: 'P6', ...PRODUCT, origin: 'synthetic', question: 'יש אוטומציות במערכת?' },
  { id: 'P7', ...PRODUCT, origin: 'synthetic', question: 'אפשר לענות להודעות מפייסבוק מסנג׳ר מתוך המערכת?' },
  { id: 'P8', ...PRODUCT, origin: 'synthetic', question: 'יש דוח על המודעות שלי בפייסבוק?' },
  { id: 'P9', ...PRODUCT, origin: 'synthetic', question: 'איך אני מייבא עסקאות מאקסל?' },
  { id: 'P10', ...PRODUCT, origin: 'synthetic', question: 'אפשר שהמערכת תענה ללידים בוואטסאפ לבד?' },
  { id: 'P11', ...PRODUCT, origin: 'synthetic', question: 'מה אתה יכול לעשות בשבילי?' },

  // ── financial ───────────────────────────────────────────────────────────
  {
    id: 'F1',
    kind: 'financial',
    origin: 'real',
    prodId: 50,
    question: 'כמה העסק שלי עשה השנה?',
    mustMatch: [/ביצועים/],
    mustNotMatch: [/אין (כרגע )?דוח הכנסות/, /לא מצאתי במערכת מספיק נתונים/],
  },
  {
    id: 'F2',
    kind: 'financial',
    origin: 'synthetic',
    question: 'כמה כסף נכנס החודש?',
    mustMatch: [/ביצועים/],
    mustNotMatch: [/לא מצאתי במערכת מספיק נתונים/],
  },

  // ── business (CRM) ─────────────────────────────────────────────────────
  { id: 'B1', kind: 'business', origin: 'real', prodId: 14, question: 'מה דורש טיפול היום?' },
  { id: 'B2', kind: 'business', origin: 'real', prodId: 6, question: 'מה הכי דחוף?' },
  { id: 'B3', kind: 'business', origin: 'real', prodId: 7, question: 'מי מחכה לטיפול?' },
  { id: 'B4', kind: 'business', origin: 'real', prodId: 18, question: 'במה כדאי לי להתמקד?' },
  { id: 'B5', kind: 'business', origin: 'real', prodId: 20, question: 'מה הלוז<' },
  { id: 'B6', kind: 'business', origin: 'real', prodId: 22, question: 'מה מצב העסק?' },
  { id: 'B7', kind: 'business', origin: 'real', prodId: 26, question: 'הצג לידים שלא קיבלו מענה' },
  { id: 'B8', kind: 'business', origin: 'real', prodId: 28, question: 'כמה לידים יש לי היום במערכת?' },
  { id: 'B9', kind: 'business', origin: 'real', prodId: 29, question: 'דבר אליי מה חדש בעסק' },
  { id: 'B10', kind: 'business', origin: 'real', prodId: 34, question: 'סכם לי את היום' },
  { id: 'B11', kind: 'business', origin: 'real', prodId: 55, question: 'סכם לי את היום האחרון' },
  { id: 'B12', kind: 'business', origin: 'real', prodId: 52, question: 'מי הליד הכי חם?' },
  { id: 'B13', kind: 'business', origin: 'real', prodId: 56, question: 'מה חדש?' },
  { id: 'B14', kind: 'business', origin: 'real', prodId: 51, question: 'תיכנס ל/leads ותגיד לי מה המספר שאתה רואה שם' },

  // ── a specific lead ─────────────────────────────────────────────────────
  { id: 'L1', kind: 'lead', origin: 'real', prodId: 15, question: 'מי זה יוסי?' },
  { id: 'L2', kind: 'lead', origin: 'real', prodId: 16, question: 'מה קרה עם יוסי?' },
  { id: 'L3', kind: 'lead', origin: 'real', prodId: 30, question: 'מה עם דנה התקדם?' },
  {
    id: 'L4',
    kind: 'lead',
    origin: 'real',
    prodId: 31,
    question: 'תקרא את השיחה ותגיד לי מה היא אמרה',
    history: [
      { role: 'user', content: 'מה עם דנה התקדם?' },
      { role: 'assistant', content: 'דנה הזדמנות בסטטוס „בטיפול”, ואין לה צעד הבא.' },
    ],
  },
  { id: 'L5', kind: 'lead', origin: 'real', prodId: 53, question: 'שי חדד מראה התעניינות?' },
  { id: 'L6', kind: 'lead', origin: 'real', prodId: 57, question: 'סכם לי את הליד החדש שהצטרף לא מזמן' },

  // ── meeting flow (multi-turn) ───────────────────────────────────────────
  {
    id: 'M1',
    kind: 'meeting',
    origin: 'real',
    prodId: 44,
    question: 'תקבע לי פגישה עם ליד',
    plain: true,
    mustNotMatch: [/לא מצאתי במערכת מספיק נתונים/],
  },
  {
    id: 'M2',
    kind: 'meeting',
    origin: 'real',
    prodId: 45,
    question: 'עם יוסי',
    history: MEETING_OPEN.slice(0, 2),
    mustNotMatch: [/לא מצאתי במערכת מספיק נתונים/],
  },
  {
    id: 'M3',
    kind: 'meeting',
    origin: 'real',
    prodId: 46,
    question: 'מחר בשעה 10 וחצי',
    history: MEETING_OPEN.slice(0, 4),
    mustNotMatch: [/לא מצאתי במערכת מספיק נתונים/],
  },
  {
    id: 'M4',
    kind: 'meeting',
    origin: 'real',
    prodId: 35,
    question: 'תקבע לי פגישה עם הליד הראשון שמופיע ברשימה',
    mustNotMatch: [/לא מצאתי במערכת מספיק נתונים/],
  },
  {
    id: 'M5',
    kind: 'meeting',
    origin: 'real',
    prodId: 39,
    question: 'תקבע לי פגישה עם אבי \nלמחר בבוקר בשעה 10:00',
    mustNotMatch: [/לא מצאתי במערכת מספיק נתונים/],
  },
  {
    id: 'M6',
    kind: 'meeting',
    origin: 'real',
    prodId: 54,
    question: 'תקבע לי פגישה עם Shay Hadad ליום ראשון בשעה 12:00',
    mustNotMatch: [/לא מצאתי במערכת מספיק נתונים/],
  },
  {
    // An unrelated short message while a question is open: a thanks, not a duration.
    id: 'M7',
    kind: 'meeting',
    origin: 'real',
    prodId: 47,
    question: 'סלמתאק',
    history: MEETING_OPEN,
    maxTools: 0,
    plain: true,
    mustNotMatch: [/לא מצאתי במערכת מספיק נתונים/, /ביקשתי לקבוע/],
  },
  {
    id: 'M8',
    kind: 'meeting',
    origin: 'real',
    prodId: 42,
    question: 'טיפשול',
    history: [
      { role: 'user', content: 'תקבע לי פגישה עם אבי \nלמחר בבוקר בשעה 10:00' },
      { role: 'assistant', content: 'כמה זמן להקצות לפגישה עם אבי הזדמנות?' },
      { role: 'user', content: 'חצי שעה' },
      { role: 'assistant', content: 'ביקשתי לקבוע פגישה עם אבי הזדמנות למחר ב־10:00 למשך חצי שעה.' },
    ],
    mustNotMatch: [/לא מצאתי במערכת מספיק נתונים/],
  },
]
