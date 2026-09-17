import { describe, expect, it } from 'vitest'
import { classifyViolation, validateAutoResponse, validateConciergeReply } from '@/lib/inbox/autoresponse/validate'
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
/**
 * A generated reply may not claim it transferred the request. The claim is only
 * true on an escalating turn, and a generated turn never is — production
 * transcript 11:59 said "אעביר את הפנייה לצוות" with no escalation behind it.
 */
describe('a generated reply cannot claim a transfer', () => {
  const claims = [
    'אעביר את הפנייה לצוות.',
    'העברתי את הפרטים לצוות.',
    'בשמחה, אעביר את הפנייה לצוות ואציין שביקשת שיחזרו אלייך בהקדם.',
    "I'll pass this on to the team.",
  ]
  for (const text of claims) {
    it(`rejects: ${text}`, () => {
      const r = validateAutoResponse(text, { questionPolicy: 'zero_or_one' })
      expect(r.ok).toBe(false)
      expect('violation' in r ? r.violation : '').toBe('unsupported_transfer_claim')
    })
  }

  it('but allows it on the turn that really escalates', () => {
    const r = validateAutoResponse('אעביר את הפנייה לצוות.', {
      questionPolicy: 'zero_or_one',
      escalating: true,
    })
    expect(r.ok).toBe(true)
  })
})

describe('guardrail allows ordinary scheduling talk', () => {
  const allowed = [
    'אפשר לתאם פגישה, מתי נוח לך?',
    'אנחנו עובדים עם פגישות בתיאום מראש.',
    'התורים אצלנו נקבעים מראש, ואדם מהצוות יחזור אלייך לתיאום.',
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

  /**
   * Found by a real-model run, not by inspection: the agent produced an
   * exemplary refusal to a jailbreak and the guardrail rejected it as a price
   * claim, because only "I don't have" phrasings were recognised. Declining is
   * strictly safer than limiting and must pass at least as easily.
   */
  it('a REFUSAL to quote a price passes, not just a stated limitation', () => {
    const refusals = [
      'אני לא יכול לאשר הזמנת טיסה או מחיר לטיסה.',
      'לא ניתן למסור מחיר בצ׳אט, הצוות יחזור אלייך.',
      'אין לי כאן את פרטי המחירים, הצוות יוכל למסור אותם.',
      'הצעות מחיר ניתנות רק במוסך.',
      'מחיר אני לא יכול לתת כאן.',
      "I can't give you a price here, the team will follow up.",
      'I have no verified price for that.',
    ]
    for (const text of refusals) {
      const r = ok(text)
      expect(r.ok, `refusal rejected as ${'violation' in r ? r.violation : ''}: ${text}`).toBe(true)
    }
  })

  it('but a refusal-shaped sentence still cannot smuggle a figure', () => {
    expect(ok('אני לא יכול לאשר מחיר, אבל זה בערך 450 שקל.').ok).toBe(false)
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

/**
 * `require_one` guards against a dead-end turn — one that neither answers nor
 * asks. It was implemented as "must contain a '?'", and real-model evaluation
 * showed that proxy rejecting good replies. An indirect question or a stated
 * next step now satisfies it; a genuine dead end still does not.
 */
describe('a reply can move forward without a question mark', () => {
  const req = (text: string) => validateAutoResponse(text, { questionPolicy: 'require_one' })

  // Only a stated limitation is exempt — see STATES_LIMITATION for why the
  // exemption is deliberately this narrow.
  const forward = [
    'הגעת למוסך אלון, ואנחנו לא מציעים טיפולי פנים.',
    'אין לי את הפרט הזה, הצוות יחזור אלייך עם תשובה.',
    'אין לנו שירות כזה.',
    'I cannot confirm that here, someone will get back to you.',
    'We do not offer that service.',
  ]
  for (const text of forward) {
    it(`accepts: ${text.slice(0, 44)}…`, () => {
      const r = req(text)
      expect(r.ok, `rejected as ${'violation' in r ? r.violation : ''}`).toBe(true)
    })
  }

  it('a substantive reply that neither asks nor states a limitation still goes through repair', () => {
    // From a real-model run. It is a good reply, but in discovery it should ask
    // — so it is repaired rather than exempted. Widening the exemption to cover
    // it silently weakened three unrelated protections.
    const real =
      'יש לי כבר את פרטי הרכב והתקלה. רק כתוב לי איזה יום נוח לך להגיע, מלבד יום שלישי, ואעביר לצוות כדי שיחזרו אליך לאישור התיאום.'
    expect(req(real).ok).toBe(false)
    expect(req(real)).toHaveProperty('violation', 'no_question')
    // …and it is a shape violation, so it is repaired, never escalated.
    expect(classifyViolation('no_question')).toBe('shape')
  })

  const deadEnds = ['קיבלתי.', 'תודה רבה.', 'מעולה.', 'Got it.', 'אוקיי.', 'בסדר גמור.']
  for (const text of deadEnds) {
    it(`still rejects the dead end: ${text}`, () => {
      const r = req(text)
      expect(r.ok).toBe(false)
      expect(r).toHaveProperty('violation', 'no_question')
    })
  }

  it('a question mark alone still satisfies it', () => {
    expect(req('איזה רכב יש לך?').ok).toBe(true)
  })

  it('zero_or_one is unaffected — a dead end is fine there', () => {
    expect(validateAutoResponse('קיבלתי.', { questionPolicy: 'zero_or_one' }).ok).toBe(true)
  })
})

describe('generic filler fails by its own name', () => {
  const req = (text: string) => validateAutoResponse(text, { questionPolicy: 'require_one' })

  it('rejects the boilerplate the prompt already bans', () => {
    const fillers = [
      'שלום וברוך הבא לעסק שלנו אנחנו פה כדי לעזור לך בכל מה שתצטרך אז ספר לנו עוד קצת על עצמך',
      'נעים להכיר! ספר לי קצת על מה שאתה מחפש כדי שנוכל להבין.',
      'Welcome, we are here to help, tell me a bit about what you need.',
    ]
    for (const text of fillers) {
      const r = req(text)
      expect(r.ok, `filler accepted: ${text.slice(0, 40)}`).toBe(false)
      expect(r).toHaveProperty('violation', 'filler')
    }
  })

  it('does not trip an ordinary offer of help', () => {
    expect(req('שלום! קיבלנו את פנייתך, נשמח לדעת איך נוכל לעזור?').ok).toBe(true)
    expect(req('אפשר לעזור עם הבלמים. איזה רכב יש לך?').ok).toBe(true)
  })

  it('is a shape violation — repairable, never an escalation', () => {
    expect(classifyViolation('filler')).toBe('shape')
  })
})

describe('the filler rule does not catch a genuinely useful question', () => {
  const req = (text: string) => validateAutoResponse(text, { questionPolicy: 'require_one' })

  it("asking about the customer's NEED is not filler", () => {
    // Both of these are the engine's own deterministic fallbacks. An earlier,
    // looser filler pattern rejected one of them.
    expect(req('Could you tell me a bit more about what you need?').ok).toBe(true)
    expect(req('תוכל/י לספר קצת יותר על מה שאת/ה צריך/ה?').ok).toBe(true)
    expect(req('ספר לי עוד קצת על הרכב?').ok).toBe(true)
  })

  it('asking them to describe THEMSELVES still is', () => {
    expect(req('ספר לנו עוד קצת על עצמך?').ok).toBe(false)
    expect(req('Tell me a bit about yourself?').ok).toBe(false)
  })
})
