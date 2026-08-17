import { describe, it, expect } from 'vitest'
import { validateAutoResponse, validateConciergeReply } from '@/lib/inbox/autoresponse/validate'

const ok = ['שלום! קיבלנו את פנייתך, נשמח לדעת איך נוכל לעזור?']
const bad: [string, string][] = [
  ['המחיר שלנו הוא 200 ש"ח, מתאים?', 'forbidden'],     // price
  ['יש לנו הנחה מיוחדת היום, רוצה?', 'forbidden'],       // discount
  ['אני מבטיח לחזור מחר ב-10:00, טוב?', 'forbidden'],    // commitment/date
  ['מה שמך? ומאיפה הגעת אלינו?', 'too_many_questions'],   // two question marks
  ['שלום וברוך הבא לעסק שלנו אנחנו פה כדי לעזור לך בכל מה שתצטרך אז ספר לנו עוד קצת על עצמך ועל מה שאתה מחפש כדי שנוכל להבין', 'too_long'],
  ['', 'empty'],
  ['תודה שפנית אלינו!', 'no_question'],                  // no qualification question
]

describe('validateAutoResponse', () => {
  for (const m of ok) it(`accepts: ${m}`, () => expect(validateAutoResponse(m).ok).toBe(true))
  for (const [m, v] of bad) it(`rejects (${v}): ${m}`, () => {
    const r = validateAutoResponse(m)
    expect(r.ok).toBe(false)
  })
})

describe('honest price limitation vs invented price', () => {
  const policy = { questionPolicy: 'zero_or_one' as const }
  it('PASS: אין לי מחיר מאומת כרגע', () => {
    expect(validateAutoResponse('אין לי מחיר מאומת כרגע', policy).ok).toBe(true)
  })
  it('PASS: אני לא רוצה להמציא לך מחיר', () => {
    expect(validateAutoResponse('אני לא רוצה להמציא לך מחיר', policy).ok).toBe(true)
  })
  it('PASS: נציג יוכל לתת לך את המחיר המדויק', () => {
    expect(validateAutoResponse('נציג יוכל לתת לך את המחיר המדויק', policy).ok).toBe(true)
  })
  it('FAIL: המחיר הוא 299 ש״ח', () => {
    const r = validateAutoResponse('המחיר הוא 299 ש״ח', policy)
    expect(r.ok).toBe(false)
    if ('violation' in r) expect(r.violation).toBe('forbidden')
  })
  it('FAIL: זה עולה 199 ₪ לחודש', () => {
    const r = validateAutoResponse('זה עולה 199 ₪ לחודש', policy)
    expect(r.ok).toBe(false)
    if ('violation' in r) expect(r.violation).toBe('forbidden')
  })
  it('FAIL: unsupported pricing claim with מחיר and no honest limitation', () => {
    expect(validateAutoResponse('המחיר שלנו משתלם מאוד', policy).ok).toBe(false)
  })
})

describe('unsupported onboarding claims cannot be fabricated', () => {
  const policy = { questionPolicy: 'zero_or_one' as const }
  it('PASS: honest limitation about onboarding', () => {
    expect(
      validateAutoResponse('אני לא רוצה להמציא לך את תהליך ההצטרפות המדויק. נציג יוכל לכוון אותך.', policy).ok,
    ).toBe(true)
  })
  it('PASS: verified WhatsApp connect from product knowledge', () => {
    expect(
      validateAutoResponse('מחברים וואטסאפ עסקי, והשיחות מגיעות למערכת ומחוברות לליד.', policy).ok,
    ).toBe(true)
  })
  it('FAIL: invented demo', () => {
    const r = validateAutoResponse('נתחיל בהדגמה קצרה ואז נחבר אותך.', policy)
    expect(r.ok).toBe(false)
    if ('violation' in r) expect(r.violation).toBe('forbidden')
  })
  it('FAIL: invented signup', () => {
    const r = validateAutoResponse('אפשר להירשם באתר ואז נקבע דמו.', policy)
    expect(r.ok).toBe(false)
    if ('violation' in r) expect(r.violation).toBe('forbidden')
  })
})

describe('validateConciergeReply (post-handoff — no question requirement)', () => {
  it('accepts a warm ack with no question mark', () => expect(validateConciergeReply('בשמחה!').ok).toBe(true))
  it('accepts a defer sentence', () => expect(validateConciergeReply('אחד מאנשי הצוות יענה לך על זה בקרוב.').ok).toBe(true))
  it('still rejects a price/number reply (forbidden)', () => {
    const r = validateConciergeReply('המחיר שלנו הוא 200 שקל')
    expect(r.ok).toBe(false)
    if ('violation' in r) expect(r.violation).toBe('forbidden')
  })
  it('rejects empty', () => expect(validateConciergeReply('   ').ok).toBe(false))
  it('rejects too many sentences', () =>
    expect(validateConciergeReply('שלום. מה נשמע. איך אפשר לעזור. עוד משפט.').ok).toBe(false))
})
