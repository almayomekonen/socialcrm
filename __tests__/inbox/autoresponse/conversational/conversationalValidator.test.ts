/**
 * The seven first-reply validator failures from the real-model evaluation
 * (2026-11-10, gpt-5.6), as regression tests, plus the price and handoff
 * boundaries around them. Pure.
 *
 * Three were FALSE POSITIVES and now pass (B7 length with a greeting; M3, C1
 * guest counts read as prices). Four were TRUE rejections and still fail (B4,
 * K1, K3, K4 promise a transfer or a callback): their fix is the prompt rule
 * plus the real handoff (needsTeam), whose fixed copy is what gets sent.
 * The classic path (no `conversational` option) is unchanged throughout.
 */
import { describe, expect, it } from 'vitest'
import { maskQuantities, validateAutoResponse } from '@/lib/inbox/autoresponse/validate'
import { handoffMessage } from '@/lib/inbox/autoresponse/qualify'
import { withGreeting } from '@/lib/inbox/autoresponse/greeting'

const GREETING = 'היי, ברוכים הבאים לאולמי הגפן! 😊'
const FACTS = [
  'הפקת אירועים ואולם אירועים בראשון לציון: חתונות, בר ובת מצווה, בריתות ואירועי חברה, מ-50 עד 400 אורחים. המחיר תלוי במספר האורחים, בתאריך ובחבילה. פתוחים לפגישות ראשון עד חמישי 10:00-19:00. חניה חינם.',
  'כמה עולה חתונה?\nהמחיר לפי מספר האורחים והחבילה, החל מ-210 ₪ למנה בימי חול.',
].join('\n')
const conv = (reply: string, greetingTurn = true) =>
  validateAutoResponse(reply, { questionPolicy: 'zero_or_one', greetingTurn, groundedFacts: FACTS, conversational: { greetingLine: greetingTurn ? GREETING : null } })
const classic = (reply: string, greetingTurn = true) => validateAutoResponse(reply, { questionPolicy: 'zero_or_one', greetingTurn, groundedFacts: FACTS })

describe('the seven real-model failures', () => {
  it('B7: a complete three-sentence answer after the greeting is not "too long" (the greeting is set aside)', () => {
    const reply = `${GREETING}\nאנחנו מפיקים אירועי חברה ל־50 עד 400 אורחים, כך שאירוע ל־120 עובדים בהחלט מתאים. המחיר תלוי בתאריך ובחבילה, ויש חניה חינם. יש תאריך או טווח תאריכים שאתם שוקלים ברבעון הבא?`
    expect(conv(reply)).toMatchObject({ ok: true })
  })

  it('M3: "150 איש" next to "מחיר" is a guest count, not a price', () => {
    const reply = `${GREETING}\nאחי, המחיר לבר מצווה תלוי בתאריך ובחבילה, ואין לי מחיר מדויק עבור 150 איש. אפשר להיפגש בימים ראשון עד חמישי, בין 10:00 ל־19:00, ואדם מהצוות יוכל לכוון אותך למחיר המדויק.`
    expect(conv(reply)).toMatchObject({ ok: true })
    expect(classic(reply)).toMatchObject({ ok: false, violation: 'forbidden' }) // classic unchanged
  })

  it('C1: "300 אורחים" and "400 אורחים" are capacities; the price sentence quotes no figure', () => {
    const reply = 'אין בעיה, גם 300 אורחים מתאימים לאולם, שמארח עד 400 אורחים. המחיר נקבע לפי הכמות, התאריך והחבילה.'
    expect(conv(reply, false)).toMatchObject({ ok: true })
    expect(classic(reply, false)).toMatchObject({ ok: false, violation: 'forbidden' }) // classic unchanged
  })

  it.each([
    ['B4', `${GREETING}\nבשמחה. אפשר להגיע לפגישה בימים ראשון עד חמישי בין 10:00 ל־19:00. איזה יום ושעה נוחים לכם? אדם מהצוות יחזור לאישור.`],
    ['K1', `${GREETING}\nפגישות מתקיימות ראשון עד חמישי בין 10:00 ל-19:00. באיזו שעה נוח לך מחר? אדם מהצוות יחזור לאשר.`],
  ])('%s: "אדם מהצוות יחזור לאשר" is a promise nobody made, and stays refused', (_id, reply) => {
    expect(conv(reply).ok).toBe(false)
    expect(conv(reply.replace(/ אדם מהצוות יחזור לא(?:ישור|שר)\./, ''))).toMatchObject({ ok: true }) // the same answer without the promise passes
  })

  it.each([
    ['K3', 'לאיזה יום ושעה בשבוע הבא נוח לך? אעביר את הבקשה לצוות כדי שיאשרו את השינוי.'],
    ['K4', `${GREETING}\nאיזה תאריך תרצו? אעביר את הפרטים לצוות שיחזור לאשר זמינות.`],
  ])('%s: "אעביר לצוות" is still a false transfer claim', (_id, reply) => {
    expect(conv(reply, _id === 'K4')).toMatchObject({ ok: false, violation: 'unsupported_transfer_claim' })
  })

  it('the real handoff these four need sends the fixed copy, which passes the same validator', () => {
    const sent = withGreeting(GREETING, handoffMessage('needs_team', 'he'))
    expect(sent).toContain('ממתינה כעת לטיפול הצוות')
    expect(validateAutoResponse(sent, { questionPolicy: 'zero_or_one', greetingTurn: true, groundedFacts: FACTS, conversational: { greetingLine: GREETING }, escalating: true })).toMatchObject({ ok: true })
  })
})

describe('price hallucination protection is not weakened', () => {
  it.each([
    'המחיר הוא 180 ₪ למנה',
    'זה יעלה 500 שקל',
    'לחתונה של 300 אורחים המחיר הוא 63,000',
    '300 אורחים זה 63000 ₪',
    'עלות של 95 למנה',
    'יש מבצע של 10% הנחה',
  ])('unknown price or discount "%s" → refused on the conversational path', (reply) => {
    expect(conv(reply, false)).toMatchObject({ ok: false, violation: 'forbidden' })
  })

  it.each(['המחיר מתחיל החל מ־210 ₪ למנה בימי חול.', 'לחתונה של 250 אורחים המחיר מתחיל ב־210 ₪ למנה בימי חול.'])(
    'a price that is in the facts "%s" → allowed, even next to a guest count',
    (reply) => {
      expect(conv(reply, false)).toMatchObject({ ok: true })
    },
  )

  it('only a number directly followed by a count noun is masked; currency and price units never are', () => {
    expect(maskQuantities('ל-150 איש, 50 עד 400 אורחים, 120 עובדים')).toBe('ל-כמות, כמות, כמות')
    expect(maskQuantities('210 ₪ למנה')).toBe('210 ₪ למנה')
    expect(maskQuantities('180 למנה')).toBe('180 למנה')
    expect(maskQuantities('63,000 לאירוע')).toBe('63,000 לאירוע')
  })
})

describe('promises that a person will act', () => {
  it.each(['אדם מהצוות יחזור לאישור.', 'הצוות יאשר את המועד.', 'נציג יתקשר אליך היום.', 'מישהו מהצוות יצור קשר.'])(
    '"%s" → refused on the conversational path',
    (reply) => {
      expect(conv(reply, false)).toMatchObject({ ok: false })
    },
  )

  it('ASKING is allowed: "מתי נוח שאדם מהצוות יחזור אליך?"', () => {
    expect(conv('מתי נוח שאדם מהצוות יחזור אליך?', false)).toMatchObject({ ok: true })
  })

  it('the classic path is unchanged: the team promise passes there exactly as before', () => {
    expect(classic('אדם מהצוות יחזור לאישור.', false)).toMatchObject({ ok: true })
  })
})

describe('length with and without the greeting', () => {
  it('greeting + three sentences passes; greeting + four does not', () => {
    expect(conv(`${GREETING}\nבשמחה. יש חניה חינם. מה התאריך?`)).toMatchObject({ ok: true })
    expect(conv(`${GREETING}\nבשמחה. יש חניה חינם. האולם בראשון לציון. מה התאריך?`)).toMatchObject({ ok: false, violation: 'too_long' })
  })

  it('a reply that does not open with the configured greeting keeps the greeting-turn limits', () => {
    expect(conv('היי! בשמחה. יש חניה חינם. מה התאריך?')).toMatchObject({ ok: true })
    expect(conv('היי! בשמחה. יש חניה חינם. האולם בראשון לציון. מה התאריך?')).toMatchObject({ ok: false, violation: 'too_long' })
  })
})
