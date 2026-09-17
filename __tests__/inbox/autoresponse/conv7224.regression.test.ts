import { describe, expect, it } from 'vitest'
import { validateAutoResponse, classifyViolation } from '@/lib/inbox/autoresponse/validate'
import { isConfirmedHandoffOffer, outboundOffersHandoff } from '@/lib/inbox/autoresponse/conversationControl'
import { isGratitude, decideCourtesyClose } from '@/lib/inbox/autoresponse/courtesyClose'
import { decidePreGeneration, isDiscoveryQuestionBudgetExhausted, type PreFacts } from '@/lib/inbox/autoresponse/stateMachine'

/**
 * PRODUCTION CONVERSATION 7224 — agency 103, 2026-09-17 11:14–11:17 UTC.
 *
 * The customer finally said what she needed — "לידים שנכנסים, אני רוצה שיקבלו
 * מענה אוטומטי" — and the agent handed her to staff instead of answering. Her
 * "תודה רבה" then got nothing at all.
 *
 * Traced, not inferred. `conversation_ai_state.escalationReason = 'guardrail'`
 * and `conversation_turn_classification` row 63 recorded decision=escalate,
 * escalationReason=guardrail on turn 5 — so BOTH generated drafts failed
 * validation. It was not a turn limit (aiTurnCount 4, maxTurns 5), not a model
 * decision, and not a qualification-complete rule.
 */

const opts = { questionPolicy: 'zero_or_one' as const }

// ── Defect A: an OFFER is not a CLAIM ───────────────────────────────────────

/** The two drafts production actually produced, reproduced against the real config. */
const REJECTED_DRAFTS = [
  'הבנתי, חשוב לך שלידים שנכנסים יקבלו מענה אוטומטי. אין לי מידע מאומת אם האפשרות הזו קיימת במערכת, אז צריך לבדוק מול הצוות. תרצי שאעביר אליהם את הפנייה?',
  'הבנתי, חשוב לך שלידים שנכנסים יקבלו מענה אוטומטי. אני צריכה לבדוק עם הצוות אם המערכת תומכת בזה. תרצי שאעביר להם את הפנייה?',
]

describe('offering a handoff is not claiming one', () => {
  it('REGRESSION: the drafts that caused the guardrail handoff are now valid', () => {
    for (const draft of REJECTED_DRAFTS) {
      const r = validateAutoResponse(draft, opts)
      expect(r.ok, `still rejected: ${'violation' in r ? r.violation : ''}`).toBe(true)
    }
  })

  it('an offer in any of its ordinary shapes passes', () => {
    for (const t of [
      'תרצי שאעביר להם את הפנייה?',
      'להעביר את הפנייה שלך לצוות שימשיך איתך?',
      'רוצה שאעביר את זה לצוות?',
      'האם להעביר אותך לאדם מהצוות?',
      'shall i pass this on to the team?',
    ]) {
      expect(validateAutoResponse(t, opts).ok, t).toBe(true)
    }
  })

  it('but an assertion still fails, in the same sentence shapes', () => {
    for (const t of [
      'אעביר את הפנייה לצוות.',
      'העברתי את הפרטים לצוות.',
      'בשמחה, אעביר את הפנייה לצוות ואציין שביקשת שיחזרו אלייך.',
      'קיבלתי, אעביר לצוות. מה עוד תרצי לדעת?',
    ]) {
      const r = validateAutoResponse(t, opts)
      expect(r.ok, t).toBe(false)
      expect('violation' in r ? r.violation : '').toBe('unsupported_transfer_claim')
    }
  })

  it('the rule the agent depends on still works — an offer can still be accepted', () => {
    // isConfirmedHandoffOffer needs the agent to be ABLE to ask. Blocking the
    // question made a real handoff unreachable while a fake one was impossible.
    const offer = 'תרצי שאעביר להם את הפנייה?'
    expect(validateAutoResponse(offer, opts).ok).toBe(true)
    expect(outboundOffersHandoff(offer)).toBe(true)
    expect(isConfirmedHandoffOffer({ previousOutbound: offer, inboundText: 'כן' })).toBe(true)
  })

  it('a rejected transfer claim is still treated as a safety matter', () => {
    expect(classifyViolation('unsupported_transfer_claim')).toBe('safety')
  })
})

// ── Defect B: an attachment must not mask the message being answered ────────

/** The worker's own selection rule, lifted so the fix is asserted directly. */
function readableInbound(recent: Array<{ direction: string; text: string; sequence: number }>) {
  const lastOutboundSeq = Number([...recent].reverse().find((m) => m.direction === 'outbound')?.sequence ?? 0)
  const unanswered = recent.filter((m) => m.direction === 'inbound' && Number(m.sequence) > lastOutboundSeq)
  return (
    [...unanswered].reverse().find((m) => String(m.text ?? '').trim()) ??
    [...recent].reverse().find((m) => m.direction === 'inbound')
  )
}

describe('an image does not erase the message the customer is waiting on', () => {
  // Sequences 10–13 exactly as production recorded them: our handoff, her
  // thank-you, then two photos that persist with empty text.
  const TAIL = [
    { direction: 'outbound', text: 'הפנייה שלך ממתינה כעת לטיפול הצוות.', sequence: 10 },
    { direction: 'inbound', text: 'תודה רבה', sequence: 11 },
    { direction: 'inbound', text: '', sequence: 12 },
    { direction: 'inbound', text: '', sequence: 13 },
  ]

  it('REGRESSION: the thank-you is what gets answered, not the photo', () => {
    expect(readableInbound(TAIL)?.text).toBe('תודה רבה')
  })

  it('and the courtesy reply therefore fires', () => {
    const text = readableInbound(TAIL)?.text ?? ''
    expect(isGratitude(text)).toBe(true)
    expect(
      decideCourtesyClose({
        inboundText: text,
        agentHasSpoken: true,
        humanTookOver: false,
        optOut: false,
        alreadySentCourtesy: false,
      }),
    ).toEqual({ send: true })
  })

  it('the old rule picked the empty photo, which is why nothing was sent', () => {
    const naive = [...TAIL].reverse().find((m) => m.direction === 'inbound')
    expect(naive?.text).toBe('')
    expect(isGratitude(naive?.text ?? '')).toBe(false)
  })

  it('a question followed by a photo is still answered', () => {
    const rows = [
      { direction: 'outbound', text: 'במה אפשר לעזור?', sequence: 1 },
      { direction: 'inbound', text: 'כמה זה עולה?', sequence: 2 },
      { direction: 'inbound', text: '', sequence: 3 },
    ]
    expect(readableInbound(rows)?.text).toBe('כמה זה עולה?')
  })

  it('only an attachment, with nothing to read, falls back to the newest', () => {
    const rows = [
      { direction: 'outbound', text: 'במה אפשר לעזור?', sequence: 1 },
      { direction: 'inbound', text: '', sequence: 2 },
    ]
    expect(readableInbound(rows)?.sequence).toBe(2)
  })

  it('it never reaches back past our own last reply', () => {
    // An older text the agent already answered must not be answered twice.
    const rows = [
      { direction: 'inbound', text: 'שאלה ישנה', sequence: 1 },
      { direction: 'outbound', text: 'תשובה', sequence: 2 },
      { direction: 'inbound', text: '', sequence: 3 },
    ]
    expect(readableInbound(rows)?.text).toBe('')
    expect(readableInbound(rows)?.sequence).toBe(3)
  })
})

// ── Lifecycle: no arbitrary reply cutoff ────────────────────────────────────

const pre = (over: Partial<PreFacts> = {}): PreFacts => ({
  aiState: 'ai_qualifying',
  masterEnabled: true,
  channelEnabled: true,
  humanTookOver: false,
  humanTyping: false,
  optOut: false,
  hasUnansweredInbound: true,
  withinQuietHours: false,
  withinWindow: true,
  sentTodayForAgency: 3,
  dailyCap: 200,
  turnCount: 40,
  maxTurns: 5,
  ...over,
})

describe('conversation length is not a reason to stop', () => {
  it('a long useful conversation keeps going, far past maxTurns', () => {
    for (const turnCount of [5, 6, 12, 40, 200]) {
      expect(decidePreGeneration(pre({ turnCount })).action, `turn ${turnCount}`).toBe('proceed')
    }
  })

  it('maxTurns budgets DISCOVERY QUESTIONS, not replies', () => {
    // Exhausting it changes what the agent asks, never whether it answers.
    expect(isDiscoveryQuestionBudgetExhausted({ salesMove: 'DISCOVERY', turnCount: 40, maxTurns: 5 })).toBe(true)
    expect(decidePreGeneration(pre({ turnCount: 40 })).action).toBe('proceed')
  })

  it('the operational safeguards still stop it', () => {
    expect(decidePreGeneration(pre({ sentTodayForAgency: 200, dailyCap: 200 })).action).toBe('skip')
    expect(decidePreGeneration(pre({ withinWindow: false })).action).toBe('skip')
    expect(decidePreGeneration(pre({ withinQuietHours: true })).action).toBe('skip')
    expect(decidePreGeneration(pre({ humanTookOver: true })).action).toBe('stop')
    expect(decidePreGeneration(pre({ optOut: true })).action).toBe('stop')
  })
})
