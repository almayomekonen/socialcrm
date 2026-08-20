/**
 * Task 13 — Contact IRE eligibility (groups A + B) and Stop Policy regression (F).
 *
 * A non-personal Contact reaches the same deterministic pipeline a Lead does:
 *   Sales Intent → Conversation Control → GPT eligibility.
 * The first turn may answer a greeting. Social residue still costs 0 GPT.
 */
import { describe, expect, it } from 'vitest'
import {
  allowsOutbound,
  decideConversationControl,
  isExplicitReopen,
} from '@/lib/inbox/autoresponse/conversationControl'
import { classifySalesMove } from '@/lib/inbox/autoresponse/salesIntent'
import { shouldInvokeSalesAi } from '@/lib/inbox/autoresponse/gptEligibility'
import { detectOptOut } from '@/lib/inbox/autoresponse/qualify'
import { NO_RESPONSE_WARNING_TEXT } from '@/lib/inbox/autoresponse/noResponseClose'

const ANSWER = 'SocialCRM מרכזת לידים מוואטסאפ ופייסבוק במקום אחד, עם סטטוס ומעקב.'
const EXPLAIN_OFFER = 'רוצה שאסביר איך זה עובד?'

/** Full pre-GPT pipeline. `gpt` is the number of GPT calls this inbound would cost. */
function pipeline(
  inbound: string,
  opts: { previousOutbound?: string; previousOutboundKind?: string; count?: number } = {},
) {
  const previousOutbound = opts.previousOutbound ?? ''
  const salesMove = classifySalesMove(inbound, { previousOutbound })
  const control = decideConversationControl({ salesMove, inboundText: inbound, previousOutbound })
  if (control.action !== 'CONTINUE' && control.action !== 'ASK_QUESTION') {
    return { salesMove, control, eligibility: null, gpt: 0 as const }
  }
  const eligibility = shouldInvokeSalesAi({
    inboundText: inbound,
    previousOutbound,
    previousOutboundKind: opts.previousOutboundKind,
    salesMove,
    controlAction: control.action,
    customerInboundCount: opts.count ?? 1,
  })
  return {
    salesMove,
    control,
    eligibility,
    gpt: eligibility.decision === 'RUN_AI' ? (1 as const) : (0 as const),
  }
}

describe('Task 13 A — an unknown Contact gets an answer on the first turn', () => {
  it.each(['היי שלום', 'היי', 'שלום', 'Hello', 'Hey', 'היי אחי מה קורה'])(
    'first inbound runs GPT: %s',
    (text) => {
      expect(pipeline(text, { count: 1 }).gpt).toBe(1)
    },
  )

  it('a repeated bare greeting later in the conversation does not keep spending GPT', () => {
    expect(pipeline('היי שלום', { previousOutbound: ANSWER, count: 4 }).gpt).toBe(0)
  })
})

describe('Task 13 B — Contact social residue costs 0 GPT', () => {
  const SILENT = [
    'תודה',
    'תודה אחי',
    'סבבה',
    'קיבלתי',
    'אני אחשוב על זה',
    'נדבר מחר',
    'נדבר',
    'לילה טוב',
    'רגע',
    'שנייה',
    'תן לי רגע',
    '👍',
    '😂',
  ]

  it.each(SILENT)('0 GPT after an AI answer: %s', (text) => {
    expect(pipeline(text, { previousOutbound: ANSWER, count: 3 }).gpt).toBe(0)
  })

  it.each(SILENT)('0 GPT even as the very first Contact inbound: %s', (text) => {
    expect(pipeline(text, { count: 1 }).gpt).toBe(0)
  })

  it.each(['STOP', 'תפסיק', 'אל תשלחו לי הודעות'])('opt-out is detected and costs 0 GPT: %s', (text) => {
    expect(detectOptOut(text)).toBe(true)
    expect(pipeline(text, { previousOutbound: ANSWER, count: 3 }).gpt).toBe(0)
  })
})

describe('Task 13 F — Stop Policy regression stays intact for Contacts', () => {
  it('20. warning + כן closes deterministically with 0 GPT', () => {
    const r = pipeline('כן', {
      previousOutbound: NO_RESPONSE_WARNING_TEXT,
      previousOutboundKind: 'no_response_warning',
      count: 3,
    })
    expect(r.gpt).toBe(0)
  })

  it('21. a bare כן after a plain statement waits', () => {
    expect(pipeline('כן', { previousOutbound: ANSWER, count: 3 }).gpt).toBe(0)
  })

  it('22. כן after an explicit explain-offer runs GPT', () => {
    expect(pipeline('כן', { previousOutbound: EXPLAIN_OFFER, count: 3 }).gpt).toBe(1)
  })

  it('warning + רגע אני פה may resume without a close', () => {
    const r = pipeline('רגע אני פה', {
      previousOutbound: NO_RESPONSE_WARNING_TEXT,
      previousOutboundKind: 'no_response_warning',
      count: 3,
    })
    expect(r.gpt).toBe(1)
    expect(r.eligibility?.reason).toBe('STAY_PRESENT')
  })

  it.each(['תודה', 'אני אחשוב על זה', 'נדבר מחר'])(
    'warning + social residue never reaches GPT: %s',
    (text) => {
      const r = pipeline(text, {
        previousOutbound: NO_RESPONSE_WARNING_TEXT,
        previousOutboundKind: 'no_response_warning',
        count: 3,
      })
      expect(r.gpt).toBe(0)
    },
  )

  it.each(['מה המחיר?', 'איך מתחברים לוואטסאפ?', 'יש לי עוד שאלה', 'אני צריך עזרה'])(
    'real current intent still runs GPT: %s',
    (text) => {
      expect(pipeline(text, { previousOutbound: ANSWER, count: 3 }).gpt).toBe(1)
    },
  )
})

/**
 * F23–F28: the state gates that run before eligibility. These are hard stops —
 * a Contact conversation is subject to exactly the same ones a Lead is.
 */
function outboundGate(over: Partial<Parameters<typeof allowsOutbound>[0]> = {}) {
  return allowsOutbound({
    aiState: 'ai_qualifying',
    hasUnansweredInbound: true,
    consecutiveAiWithoutInbound: 0,
    humanTookOver: false,
    optOut: false,
    ...over,
  })
}

describe('Task 13 F — state hard stops apply to Contacts unchanged', () => {
  it('23. a CLOSED conversation is not reopened by social residue', () => {
    for (const text of ['תודה', 'סבבה', 'לילה טוב', 'נדבר', 'נשתמע', 'אני אחשוב על זה', 'Thanks', 'later']) {
      const salesMove = classifySalesMove(text, { previousOutbound: ANSWER })
      const reopenEligible = isExplicitReopen({ salesMove, inboundText: text })
      expect(reopenEligible).toBe(false)
      expect(outboundGate({ aiState: 'closed', reopenEligible })).toEqual({
        allowed: false,
        reason: 'closed',
      })
    }
  })

  it('24. a CLOSED conversation reopens on real new intent', () => {
    for (const text of [
      'יש לי עוד שאלה',
      'מה המחיר?',
      'איך מתחברים לוואטסאפ?',
      'לא הבנתי',
      'אני צריך עזרה',
      'I need help',
      'Can you help me?',
    ]) {
      const salesMove = classifySalesMove(text, { previousOutbound: ANSWER })
      const reopenEligible = isExplicitReopen({ salesMove, inboundText: text })
      expect(reopenEligible).toBe(true)
      expect(outboundGate({ aiState: 'closed', reopenEligible })).toEqual({ allowed: true })
      expect(pipeline(text, { previousOutbound: ANSWER, count: 3 }).gpt).toBe(1)
    }
  })

  it('sticky product intent alone cannot reopen a closed conversation', () => {
    // PRODUCT_FIT carried over from earlier turns is not current intent.
    const reopenEligible = isExplicitReopen({ salesMove: 'PRODUCT_FIT', inboundText: 'תודה' })
    expect(reopenEligible).toBe(false)
    expect(outboundGate({ aiState: 'closed', reopenEligible })).toEqual({
      allowed: false,
      reason: 'closed',
    })
  })

  it('25. an escalated (handoff) conversation costs 0 GPT', () => {
    expect(outboundGate({ aiState: 'escalated' })).toEqual({
      allowed: false,
      reason: 'already_escalated',
    })
  })

  it('26. opt-out costs 0 GPT', () => {
    expect(outboundGate({ optOut: true })).toEqual({ allowed: false, reason: 'opt_out' })
    expect(outboundGate({ aiState: 'opted_out' })).toEqual({ allowed: false, reason: 'opted_out' })
  })

  it('27. an active human takeover costs 0 GPT', () => {
    expect(outboundGate({ humanTookOver: true })).toEqual({ allowed: false, reason: 'human_active' })
    expect(outboundGate({ aiState: 'human_active' })).toEqual({
      allowed: false,
      reason: 'human_active',
    })
  })

  it('28. an explicit handoff request is answered by the server, not by GPT', () => {
    const text = 'אפשר לדבר עם נציג?'
    const salesMove = classifySalesMove(text, { previousOutbound: ANSWER })
    expect(salesMove).toBe('HANDOFF_REQUEST')
    const control = decideConversationControl({ salesMove, inboundText: text, previousOutbound: ANSWER })
    expect(control.action).not.toBe('CONTINUE')
    expect(control.action).not.toBe('ASK_QUESTION')
    expect(pipeline(text, { previousOutbound: ANSWER, count: 3 }).gpt).toBe(0)
  })
})
