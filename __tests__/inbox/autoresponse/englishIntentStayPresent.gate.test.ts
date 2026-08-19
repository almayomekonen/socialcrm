import { describe, expect, it } from 'vitest'
import {
  decideConversationControl,
  inboundContainsRealQuestion,
} from '@/lib/inbox/autoresponse/conversationControl'
import { classifySalesMove, isNextStepAsk } from '@/lib/inbox/autoresponse/salesIntent'
import {
  isExplicitStayPresent,
  shouldInvokeSalesAi,
} from '@/lib/inbox/autoresponse/gptEligibility'
import { NO_RESPONSE_WARNING_TEXT } from '@/lib/inbox/autoresponse/noResponseClose'

const ANSWER = 'SocialCRM מרכזת לידים מוואטסאפ ופייסבוק במקום אחד, עם סטטוס ומעקב.'
const EXPLAIN_OFFER = 'רוצה שאסביר איך זה עובד?'
const STICKY = {
  previousOutbound: ANSWER,
  salesStrategy: 'product_fit' as const,
  priorMoves: ['PRODUCT_FIT' as const],
}

function pipeline(
  inbound: string,
  opts: { previousOutbound?: string; previousOutboundKind?: string; closeOfferPending?: boolean; count?: number } = {},
) {
  const previousOutbound = opts.previousOutbound ?? ANSWER
  const salesMove = classifySalesMove(inbound, {
    ...STICKY,
    previousOutbound,
  })
  const control = decideConversationControl({
    salesMove,
    inboundText: inbound,
    previousOutbound,
    previousOutboundKind: opts.previousOutboundKind,
    closeOfferPending: opts.closeOfferPending,
  })
  if (control.action !== 'CONTINUE' && control.action !== 'ASK_QUESTION') {
    return { salesMove, control, eligibility: null, gpt: 0 as const }
  }
  const eligibility = shouldInvokeSalesAi({
    inboundText: inbound,
    previousOutbound,
    previousOutboundKind: opts.previousOutboundKind,
    salesMove,
    controlAction: control.action,
    customerInboundCount: opts.count ?? 4,
  })
  return {
    salesMove,
    control,
    eligibility,
    gpt: eligibility.decision === 'RUN_AI' ? (1 as const) : (0 as const),
  }
}

function warning(inbound: string) {
  return pipeline(inbound, {
    previousOutbound: NO_RESPONSE_WARNING_TEXT,
    previousOutboundKind: 'no_response_warning',
    closeOfferPending: true,
  })
}

describe('Task 11 — English whats next', () => {
  it.each(['whats next', "what's next", 'what is next', 'ok whats next'])(
    '%s → RUN_AI',
    (inbound) => {
      expect(isNextStepAsk(inbound)).toBe(true)
      expect(pipeline(inbound).gpt).toBe(1)
    },
  )

  it.each(['ok', 'thanks', 'later', 'good night'])('%s remains non-GPT', (inbound) => {
    expect(isNextStepAsk(inbound)).toBe(false)
    expect(pipeline(inbound).gpt).toBe(0)
  })
})

describe('Task 11 — English how questions without ?', () => {
  it.each([
    'how can I connect WhatsApp',
    'how can I connect facebook ads leads',
    'how does this work',
    'how do I get started',
    'how to connect WhatsApp',
  ])('%s → real question + RUN_AI', (inbound) => {
    expect(inboundContainsRealQuestion(inbound)).toBe(true)
    expect(pipeline(inbound).gpt).toBe(1)
  })

  it.each(['thanks', 'later', 'good night', "I'll think about it"])('%s still 0 GPT', (inbound) => {
    expect(inboundContainsRealQuestion(inbound)).toBe(false)
    expect(pipeline(inbound).gpt).toBe(0)
  })
})

describe('Task 11 — stay-present rejects bare here', () => {
  it.each(['פה', 'here'])('bare %s is not stay-present', (inbound) => {
    expect(isExplicitStayPresent(inbound)).toBe(false)
    const result = warning(inbound)
    expect(result.gpt).toBe(0)
    expect(result.eligibility?.decision).toBe('WAIT')
  })

  it.each(['אני פה', 'אני כאן', 'אני עדיין פה', "I'm here", "I'm still here", 'רגע אני פה'])(
    'warning + %s → STAY_PRESENT',
    (inbound) => {
      expect(isExplicitStayPresent(inbound)).toBe(true)
      const result = warning(inbound)
      expect(result.eligibility).toEqual({ decision: 'RUN_AI', reason: 'STAY_PRESENT' })
      expect(result.gpt).toBe(1)
    },
  )

  it('warning + רגע → WAIT / HOLD_ON', () => {
    expect(isExplicitStayPresent('רגע')).toBe(false)
    const result = warning('רגע')
    expect(result.gpt).toBe(0)
    expect(result.eligibility).toEqual({ decision: 'WAIT', reason: 'HOLD_ON' })
  })
})

describe('Task 11 — regressions', () => {
  it('warning + כן → CLOSE, 0 GPT', () => {
    const result = warning('כן')
    expect(result.control.action).toBe('CLOSE_CONVERSATION')
    expect(result.gpt).toBe(0)
  })

  it.each(['ok', 'thanks', 'אני אחשוב על זה'])('warning + %s → WAIT, 0 GPT', (inbound) => {
    const result = warning(inbound)
    expect(result.gpt).toBe(0)
    if (result.eligibility) expect(result.eligibility.decision).toBe('WAIT')
  })

  it('statement + כן → WAIT, 0 GPT', () => {
    const result = pipeline('כן')
    expect(result.gpt).toBe(0)
    expect(result.eligibility?.decision).toBe('WAIT')
  })

  it('רוצה שאסביר? + כן → RUN_AI', () => {
    expect(pipeline('כן', { previousOutbound: EXPLAIN_OFFER }).gpt).toBe(1)
  })

  it('Hebrew product question → RUN_AI', () => {
    expect(pipeline('מה המחיר?').gpt).toBe(1)
  })

  it('English product question → RUN_AI', () => {
    expect(pipeline('How much does it cost?').gpt).toBe(1)
  })
})
