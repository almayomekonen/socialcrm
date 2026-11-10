/**
 * The truthfulness check for the conversational agent's replies. Pure.
 *
 * Runs IN ADDITION to validateAutoResponse (which still guards prices,
 * bookings, transfers and callback promises on every turn). It looks for three
 * shapes, each a structure rather than a single word, so ordinary friendly
 * replies pass and the unsafe ones do not:
 *
 *   COMMITMENT   a first-person future ACTION by the owner ("אגיע", "אתקשר
 *                אליך", "אשלח לך"), a shared plan with a concrete anchor
 *                ("ניפגש מחר בערב", "נתראה ביום חמישי"), or a plan stated as
 *                agreed ("סגרנו", "קבענו"). A vague yes ("ברור, חייבים לקבוע",
 *                "נדבר") commits to nothing and passes.
 *   OWNER FACT   a specific claim about where the owner is, what they are doing
 *                or did ("אני בעבודה", "אני בדרך", "הייתי אצל ההורים"). Social
 *                pleasantries ("הכל טוב", "סבבה") are not facts and pass.
 *   COMMERCIAL   in a PERSONAL turn only: a price, the business's name, an offer,
 *                a call to action, a welcome line, or a handoff to the team.
 *
 * The model's own `personalClaims` flag is one more signal: when it says it made
 * such a claim, the reply is not sent as is.
 */
import { isPersonalMode, type ConversationMode } from './mode'

export type PersonalViolation = 'owner_commitment' | 'owner_fact' | 'personal_commercial' | 'self_reported_claim'

const B = '(?<![\\p{L}])'
const E = '(?![\\p{L}])'
const re = (src: string) => new RegExp(src, 'u')

/** First-person singular future actions only the owner could perform. */
const OWNER_ACTION = re(
  `${B}(?:ו|ש|אני\\s+)?(?:אגיע|אבוא|אקפוץ|אעבור|אעלה|ארד|אצא|אתקשר|אחזור\\s+אלי(?:ך|יך|כם)|אשלח|אביא|אסדר|אדאג|אארגן|אזמין|אבדוק\\s+ואחזור|אעדכן\\s+אות(?:ך|כם))${E}`,
)
/** Plans we would make together; unsafe only with a concrete anchor. */
const SHARED_PLAN = re(`${B}(?:ו|ש)?(?:ניפגש|נפגש|נתראה|נקבע|נצא|נסגור|נעשה|נשב|נקפוץ|נעבור)${E}`)
const ANCHOR = re(
  `${B}(?:מחר|מחרתיים|היום|הערב|הלילה|בערב|בבוקר|בצהריים|השבוע|בשבוע\\s+הבא|בסופ["״']?ש|בסוף\\s+השבוע|ב?יום\\s+(?:ראשון|שני|שלישי|רביעי|חמישי|שישי)|בשבת|בשעה|אצל(?:ך|י|נו)|ב(?:בית|מקום|קפה|מסעדה|משרד))${E}|${B}ב[-־]?\\s?\\d{1,2}(?::\\d{2})?(?!\\d)|\\d{1,2}:\\d{2}`,
)
/** A plan stated as already agreed. */
const AGREED = re(`${B}(?:סגרנו|קבענו|(?<!לא\\s)סגור\\s+על|דיל\\s+סגור|אישרתי|מאשר(?:ת)?\\s+(?:את|ל))${E}`)

/** "אני" (optionally now / right now / today) followed by a place or an activity. */
const ownerState = (subject: string) =>
  re(
  `${B}(?:${subject})\\s+(?:עכשיו\\s+|כרגע\\s+|בדיוק\\s+|היום\\s+|עדיין\\s+)?(?:ב(?:בית|עבודה|דרך|משרד|חו["״']?ל|חופש(?:ה)?|מילואים|פגישה|ישיבה|אוטו|רכב|נסיעה|טיסה|מסעדה|חתונה|ים|קניון|אירוע|לימודים|בית\\s+חולים)|עסוק(?:ה|ים)?|עייפ(?:ה|ים)?|חול(?:ה|ים)|נוסע(?:ת|ים)?|טס(?:ה|ים)?|יושב(?:ת|ים)?\\s+ב|אצל|ליד|באמצע)${E}`,
  )
/** Singular in every turn; "אנחנו" only in social turns, where it is the owner too ("אנחנו בחו״ל"). */
const OWNER_STATE_SINGULAR = ownerState('אני')
const OWNER_STATE_ANY = ownerState('אני|אנחנו')
const OWNER_PAST = re(`${B}(?:הייתי|היינו)\\s+(?:ב|אצל|עם)|${B}(?:חזרתי|יצאתי|נסעתי|טסתי|הגעתי)\\s+(?:מ|ל|ב|הביתה)`)

const PRICE = /[₪$€]\s*\d|\d\s*[₪$€]|\d[\d,.]*\s*(?:ש"ח|ש״ח|שקל|שקלים)/u
const COMMERCIAL = re(
  [
    `${B}(?:איך|במה)\\s+(?:אפשר|אוכל|נוכל)\\s+לעזור`,
    `${B}(?:ה?שירות(?:ים)?|ה?חבילה|ה?חבילות|ה?מוצר(?:ים)?|ה?מחירון)\\s+שלנו`,
    `${B}(?:אנחנו|אנו)\\s+מציעים`,
    `${B}להשאיר\\s+(?:פרטים|מספר)`,
    `${B}(?:לקבוע|לתאם)\\s+(?:פגישת|שיחת)\\s+(?:ייעוץ|היכרות|מכירה)`,
    `${B}הצעת\\s+מחיר`,
    `${B}(?:מבצע|הנחה)${E}`,
    `${B}ברוכ(?:ים|ה)?\\s+הבא(?:ים|ה)?`,
    `${B}(?:הצוות\\s+שלנו|אחד\\s+מאנשי\\s+הצוות|נציג(?:ה)?)${E}`,
    `${B}ה?פנייה\\s+שלך`,
  ].join('|'),
)

export type PersonalCheck = { ok: true } | { ok: false; violation: PersonalViolation; matched: string }

function hit(r: RegExp, t: string): string | null {
  const m = r.exec(t)
  return m ? m[0].trim() : null
}

/** Commitment: an owner action, a concrete shared plan, or an agreed one. */
export function findCommitment(text: string): string | null {
  const t = text ?? ''
  const action = hit(OWNER_ACTION, t)
  if (action) return action
  const agreed = hit(AGREED, t)
  if (agreed) return agreed
  const plan = hit(SHARED_PLAN, t)
  if (plan) {
    const anchor = hit(ANCHOR, t)
    if (anchor) return `${plan} … ${anchor}`
  }
  return null
}

export function findOwnerFact(text: string, opts: { includePlural?: boolean } = {}): string | null {
  const state = opts.includePlural ? OWNER_STATE_ANY : OWNER_STATE_SINGULAR
  return hit(state, text ?? '') ?? hit(OWNER_PAST, text ?? '')
}

export function findCommercial(text: string, businessName: string | null): string | null {
  const t = text ?? ''
  const price = hit(PRICE, t)
  if (price) return price
  const name = (businessName ?? '').trim()
  if (name.length >= 3 && t.includes(name)) return name
  return hit(COMMERCIAL, t)
}

/**
 * Personal turn: no commitment, no owner fact, nothing commercial.
 * Mixed turn: no commitment, no owner fact (the business part is checked by
 * validateAutoResponse as on every turn). Business turn: no owner fact, and
 * the usual validators for everything else.
 */
export function validateConversationalReply(input: {
  reply: string
  mode: ConversationMode
  businessName: string | null
  personalClaims: boolean
}): PersonalCheck {
  const { reply, mode } = input
  const fact = findOwnerFact(reply, { includePlural: mode === 'personal' || mode === 'mixed' })
  if (fact) return { ok: false, violation: 'owner_fact', matched: fact }
  if (mode === 'personal' || mode === 'mixed') {
    const commitment = findCommitment(reply)
    if (commitment) return { ok: false, violation: 'owner_commitment', matched: commitment }
  }
  if (isPersonalMode(mode)) {
    const commercial = findCommercial(reply, input.businessName)
    if (commercial) return { ok: false, violation: 'personal_commercial', matched: commercial }
  }
  if (input.personalClaims) return { ok: false, violation: 'self_reported_claim', matched: '' }
  return { ok: true }
}
