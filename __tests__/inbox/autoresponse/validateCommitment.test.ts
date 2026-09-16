import { describe, expect, it } from 'vitest'
import { validateAutoResponse, validateConciergeReply } from '@/lib/inbox/autoresponse/validate'
import { safeFallbackReply } from '@/lib/inbox/autoresponse/safeFallback'
import { conversationCloser } from '@/lib/inbox/autoresponse/conversationControl'
import { handoffMessage } from '@/lib/inbox/autoresponse/qualify'

const ok = (text: string, opts?: Parameters<typeof validateAutoResponse>[1]) =>
  validateAutoResponse(text, { questionPolicy: 'zero_or_one', ...opts })

/**
 * V9 — an appointment-based business must be able to hold a normal conversation.
 *
 * This is the regression lock on the old guardrail, which matched vocabulary
 * rather than commitment. `פגיש` was a substring, so פגישה / פגישות / לפגישה all
 * failed, two generations later the job skipped as `validation_failed`, and the
 * customer received nothing.
 */
describe('guardrail allows ordinary scheduling talk', () => {
  const allowed = [
    'אפשר לתאם פגישה, מתי נוח לך?',
    'אנחנו עובדים עם פגישות בתיאום מראש.',
    'התורים אצלנו נקבעים מראש, אעביר את הבקשה לצוות.',
    'יש לנו שעות קבלה בבוקר ואחר הצהריים.',
    'אפשר גם מחר, אבדוק מול הצוות ונחזור אלייך.',
    'הבדיקה זמינה אצלנו, נצטרך לתאם מולך.',
    'Happy to look at an appointment, when suits you?',
    'We are available on weekdays.',
  ]
  for (const text of allowed) {
    it(`allows: ${text}`, () => {
      const r = ok(text)
      expect(r.ok, `rejected as ${'violation' in r ? r.violation : ''} (${r.details.matchedForbidden})`).toBe(true)
    })
  }

  it('allows an ordinary number that is not a price', () => {
    expect(ok('מאזדה 3 משנת 2018, נכון?', { questionPolicy: 'require_one' }).ok).toBe(true)
    expect(ok('אנחנו ברחוב הרצל 12.').ok).toBe(true)
  })
})

describe('guardrail still rejects commitments and invented facts', () => {
  const rejected: Array<[string, string]> = [
    ['קבעתי לך תור לשבוע הבא.', 'booking confirmed'],
    ['נקבע לך תור, נתראה.', 'booking confirmed'],
    ['שריינתי לך מקום.', 'reserved'],
    ['רשמתי אותך לטיפול.', 'registered'],
    ['התור שלך אושר.', 'confirmed'],
    ['אני מבטיח שזה יסתדר.', 'guarantee'],
    ['אנחנו מתחייבים לתוצאה.', 'guarantee'],
    ['I have booked you for Tuesday.', 'booking confirmed'],
    ['Your appointment is confirmed.', 'confirmed'],
    ['We guarantee results.', 'guarantee'],
    ['המחיר הוא 450.', 'price figure'],
    ['זה עולה 300 שקל.', 'price figure'],
    ['העלות היא ₪1200.', 'price figure'],
    ['יש הנחה של עשרה אחוז.', 'discount'],
    ['יש לנו מבצע החודש.', 'discount'],
    ['שלחתי לך קישור למייל.', 'fabricated action'],
    ['פתחתי לך כרטיס במערכת.', 'fabricated action'],
    ["I've emailed you the details.", 'fabricated action'],
  ]
  for (const [text, why] of rejected) {
    it(`rejects (${why}): ${text}`, () => {
      const r = ok(text)
      expect(r.ok).toBe(false)
      expect(r).toHaveProperty('violation', 'forbidden')
    })
  }

  it('still allows an honest statement that no price is available', () => {
    expect(ok('אין לי מחיר מדויק לתת כאן, נציג יחזור אלייך עם זה.').ok).toBe(true)
  })
})

/**
 * The greeting turn gets one extra sentence and 80 more characters: welcome +
 * answer + question is exactly three sentences, which sat on the old limit, so
 * the one turn that must not fail was the most likely to.
 */
describe('greeting turn length allowance', () => {
  // Welcome + answer + a clarifying clause + one question = four sentences.
  const fourSentences =
    'היי, ברוך הבא לקליניקת אורורה 👋 כן, ההצהרה נחתמת אצלנו אונליין. הקישור נשלח לפני ההגעה. זה חוסך מילוי טפסים במקום. את שואלת בשביל עצמך?'

  it('rejects it on an ordinary turn', () => {
    const r = validateAutoResponse(fourSentences, { questionPolicy: 'zero_or_one' })
    expect(r.ok).toBe(false)
    expect(r).toHaveProperty('violation', 'too_long')
  })

  it('accepts it on the greeting turn', () => {
    expect(validateAutoResponse(fourSentences, { questionPolicy: 'zero_or_one', greetingTurn: true }).ok).toBe(true)
  })

  it('still rejects a genuinely long reply even on the greeting turn', () => {
    const tooLong = 'א'.repeat(401)
    expect(validateAutoResponse(tooLong, { questionPolicy: 'zero_or_one', greetingTurn: true }).ok).toBe(false)
  })
})

/**
 * Every deterministic line the engine can send must itself survive the
 * guardrail. If a future change to FORBIDDEN makes one of these unsendable, it
 * fails here rather than in a customer's chat.
 */
describe('deterministic customer-facing text passes its own validator', () => {
  for (const lang of ['he', 'en'] as const) {
    it(`safe fallback (${lang})`, () => {
      expect(validateConciergeReply(safeFallbackReply('acknowledgement', lang)).ok).toBe(true)
      expect(validateAutoResponse(safeFallbackReply('cannot_answer', lang), { questionPolicy: 'zero_or_one' }).ok).toBe(
        true,
      )
    })
    it(`closer + handoff (${lang})`, () => {
      expect(validateConciergeReply(conversationCloser(lang)).ok).toBe(true)
      expect(validateConciergeReply(handoffMessage('qualified', lang)).ok).toBe(true)
      expect(validateConciergeReply(handoffMessage('uncertain', lang)).ok).toBe(true)
    })
  }

  it('safe fallback still validates with the greeting prefixed', () => {
    const text = safeFallbackReply('acknowledgement', 'he', 'היי, ברוך הבא לקליניקת אורורה 👋')
    expect(text.startsWith('היי, ברוך הבא לקליניקת אורורה 👋')).toBe(true)
    expect(validateConciergeReply(text).ok).toBe(true)
  })
})

/**
 * Grounding. The brief asks for two things that pull against each other: let a
 * business discuss its own prices and processes, and never let the agent invent
 * one. The validator resolves it by checking, not by trusting: a figure or a
 * process claim is allowed only when it appears in that business's saved facts.
 */
describe('a figure is allowed only when the business actually stated it', () => {
  const CLINIC_FACTS = 'קליניקה לטיפולי עור. טיפול פנים 450 ש"ח. הדגמה קצרה אפשרית בתיאום.'

  it('quotes a price that is in the business facts', () => {
    expect(ok('טיפול פנים אצלנו 450 ש"ח.', { groundedFacts: CLINIC_FACTS }).ok).toBe(true)
  })

  it('refuses a figure the business never stated', () => {
    expect(ok('טיפול פנים אצלנו 900 ש"ח.', { groundedFacts: CLINIC_FACTS }).ok).toBe(false)
  })

  it('refuses any figure when the business configured nothing', () => {
    for (const facts of [null, undefined, '']) {
      expect(ok('טיפול פנים אצלנו 450 ש"ח.', { groundedFacts: facts }).ok).toBe(false)
    }
  })

  it('allows a process the business offers, refuses one it does not', () => {
    expect(ok('אפשר לתאם הדגמה קצרה.', { groundedFacts: CLINIC_FACTS }).ok).toBe(true)
    expect(ok('אפשר להירשם באתר.', { groundedFacts: CLINIC_FACTS }).ok).toBe(false)
    expect(ok('אפשר לתאם הדגמה קצרה.', { groundedFacts: 'מוסך מורשה לרכבים פרטיים.' }).ok).toBe(false)
  })

  it('a discount or a confirmed booking is never groundable, whatever the facts say', () => {
    const permissive = 'אנחנו נותנים הנחה של 10 אחוז וקובעים תורים. קבעתי לך תור.'
    expect(ok('יש הנחה של 10 אחוז.', { groundedFacts: permissive }).ok).toBe(false)
    expect(ok('קבעתי לך תור.', { groundedFacts: permissive }).ok).toBe(false)
    expect(ok('אני מבטיח שזה יעבוד.', { groundedFacts: permissive }).ok).toBe(false)
  })

  it('an unsupported claim about price is refused even with no figure', () => {
    expect(ok('המחיר שלנו משתלם מאוד.').ok).toBe(false)
    // …but the honest limitation we actually want is allowed.
    expect(ok('אין לי מחיר מדויק לתת כאן, נציג יחזור אלייך.').ok).toBe(true)
  })

  it('the workers pass the business facts in', async () => {
    const { readFileSync } = await import('node:fs')
    const { join } = await import('node:path')
    for (const file of ['lib/inbox/autoresponse/qualifyWorker.ts', 'lib/inbox/autoresponse/worker.ts']) {
      const src = readFileSync(join(process.cwd(), file), 'utf8')
      expect(src, `${file} does not pass groundedFacts`).toContain('groundedFacts')
      expect(src).toContain('groundedFactsFor(identity)')
    }
  })
})
