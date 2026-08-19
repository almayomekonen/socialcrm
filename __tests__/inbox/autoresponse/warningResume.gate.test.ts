import { describe, expect, it } from 'vitest'
import {
  decideConversationControl,
  isExplicitReopen,
} from '@/lib/inbox/autoresponse/conversationControl'
import { classifySalesMove, isBusinessPainSignal } from '@/lib/inbox/autoresponse/salesIntent'
import {
  isExplicitStayPresent,
  shouldInvokeSalesAi,
} from '@/lib/inbox/autoresponse/gptEligibility'
import { detectOptOut } from '@/lib/inbox/autoresponse/qualify'
import { decidePreGeneration, type PreFacts } from '@/lib/inbox/autoresponse/stateMachine'
import { NO_RESPONSE_WARNING_TEXT } from '@/lib/inbox/autoresponse/noResponseClose'

const ANSWER = 'SocialCRM מרכזת לידים מוואטסאפ ופייסבוק במקום אחד, עם סטטוס ומעקב.'
const EXPLAIN_OFFER = 'רוצה שאסביר איך זה עובד?'
const STICKY = {
  previousOutbound: ANSWER,
  salesStrategy: 'product_fit' as const,
  priorMoves: ['PRODUCT_FIT' as const],
}

function pre(over: Partial<PreFacts> = {}): PreFacts {
  return {
    aiState: 'ai_qualifying',
    masterEnabled: true,
    channelEnabled: true,
    humanTookOver: false,
    optOut: false,
    hasUnansweredInbound: true,
    withinQuietHours: false,
    withinWindow: true,
    sentTodayForAgency: 0,
    dailyCap: 200,
    turnCount: 4,
    maxTurns: 5,
    ...over,
  }
}

function warningPipeline(inbound: string) {
  const salesMove = classifySalesMove(inbound, {
    previousOutbound: NO_RESPONSE_WARNING_TEXT,
    salesStrategy: 'product_fit',
    priorMoves: ['PRODUCT_FIT'],
  })
  const control = decideConversationControl({
    salesMove,
    inboundText: inbound,
    previousOutbound: NO_RESPONSE_WARNING_TEXT,
    previousOutboundKind: 'no_response_warning',
    closeOfferPending: true,
  })
  if (control.action !== 'CONTINUE' && control.action !== 'ASK_QUESTION') {
    return { salesMove, control, eligibility: null, gpt: 0 as const }
  }
  const eligibility = shouldInvokeSalesAi({
    inboundText: inbound,
    previousOutbound: NO_RESPONSE_WARNING_TEXT,
    previousOutboundKind: 'no_response_warning',
    salesMove,
    controlAction: control.action,
    customerInboundCount: 4,
  })
  return {
    salesMove,
    control,
    eligibility,
    gpt: eligibility.decision === 'RUN_AI' ? (1 as const) : (0 as const),
  }
}

function openPipeline(inbound: string) {
  const salesMove = classifySalesMove(inbound, STICKY)
  const control = decideConversationControl({ salesMove, inboundText: inbound, previousOutbound: ANSWER })
  if (control.action !== 'CONTINUE' && control.action !== 'ASK_QUESTION') {
    return { salesMove, control, eligibility: null, gpt: 0 as const }
  }
  const eligibility = shouldInvokeSalesAi({
    inboundText: inbound,
    previousOutbound: ANSWER,
    salesMove,
    controlAction: control.action,
    customerInboundCount: 4,
  })
  return {
    salesMove,
    control,
    eligibility,
    gpt: eligibility.decision === 'RUN_AI' ? (1 as const) : (0 as const),
  }
}

function closedTurn(inbound: string) {
  const salesMove = classifySalesMove(inbound, STICKY)
  const reopen = isExplicitReopen({ salesMove, inboundText: inbound })
  const preDecision = decidePreGeneration(pre({ aiState: 'closed', reopenEligible: reopen }))
  if (!reopen || preDecision.action === 'skip') {
    return { salesMove, reopen, pre: preDecision, gpt: 0 as const }
  }
  const result = openPipeline(inbound)
  return { salesMove, reopen, pre: preDecision, gpt: result.gpt, eligibility: result.eligibility }
}

describe('isExplicitStayPresent', () => {
  it.each([
    'רגע אני פה',
    'אני פה',
    'אני עדיין פה',
    'חכה אני פה',
    'שנייה אני פה',
    'אני כאן',
    'אני פה אחי',
    "I'm here",
    'still here',
    "I'm still here",
    "wait I'm here",
  ])('%s is stay-present', (inbound) => {
    expect(isExplicitStayPresent(inbound)).toBe(true)
  })

  it.each([
    'רגע',
    'שנייה',
    'פה',
    'here',
    'כאן',
    'אני אחשוב על זה',
    'אני פה מחר',
    'later',
    'ok',
    'תודה',
    "I'll think about it",
  ])('%s is not stay-present', (inbound) => {
    expect(isExplicitStayPresent(inbound)).toBe(false)
  })
})

describe('A. warning negatives — 0 GPT', () => {
  it.each([
    'תודה על הכל',
    'תודה על הזמן',
    'טוב תודה',
    'חח תודה',
    'אני אחשוב על זה',
    "I'll think about it",
    'later',
    "I'll get back to you",
    'נדבר מחר',
    'אחזור אליכם בהמשך',
    'שנייה',
    'תן לי רגע',
    'לילה טוב',
    'שיהיה יום טוב',
    'נמאס לי',
    'ok',
    'okay',
    'thanks',
    'sorry',
  ])('warning + %s → 0 GPT', (inbound) => {
    const result = warningPipeline(inbound)
    expect(result.gpt).toBe(0)
    if (result.eligibility) expect(result.eligibility.decision).toBe('WAIT')
  })
})

describe('B. warning stay-present → RUN_AI / STAY_PRESENT', () => {
  it.each([
    'רגע אני פה',
    'אני פה',
    'אני עדיין פה',
    'חכה אני פה',
    'אני כאן',
    "I'm here",
    'still here',
    "I'm still here",
  ])('warning + %s → GPT', (inbound) => {
    const result = warningPipeline(inbound)
    expect(result.control.action).toBe('CONTINUE')
    expect(result.eligibility).toEqual({ decision: 'RUN_AI', reason: 'STAY_PRESENT' })
    expect(result.gpt).toBe(1)
  })

  it.each(['פה', 'here'])('warning + bare %s → WAIT, 0 GPT', (inbound) => {
    const result = warningPipeline(inbound)
    expect(result.gpt).toBe(0)
    expect(result.eligibility?.decision).toBe('WAIT')
  })

  it('warning + רגע → WAIT / HOLD_ON', () => {
    const result = warningPipeline('רגע')
    expect(result.gpt).toBe(0)
    expect(result.eligibility).toEqual({ decision: 'WAIT', reason: 'HOLD_ON' })
  })
})

describe('C. warning genuine intent → RUN_AI', () => {
  it.each([
    'מה המחיר?',
    'איך מתחברים לוואטסאפ?',
    'יש לי עוד שאלה',
    'אני רוצה להתחיל',
    'איך זה עובד?',
    'Can I connect WhatsApp?',
    'I want to start',
    'How much does it cost?',
  ])('warning + %s → GPT', (inbound) => {
    expect(warningPipeline(inbound).gpt).toBe(1)
  })
})

describe('D. warning affirmatives', () => {
  it.each(['כן', 'כן תסגור'])('warning + %s → Control CLOSE, 0 GPT', (inbound) => {
    const result = warningPipeline(inbound)
    expect(result.control.action).toBe('CLOSE_CONVERSATION')
    expect(result.gpt).toBe(0)
  })

  it.each(['ok', 'okay', 'סבבה', 'thanks'])('warning + %s → 0 GPT', (inbound) => {
    expect(warningPipeline(inbound).gpt).toBe(0)
  })
})

describe('E. closed help / confusion reopens', () => {
  it.each([
    'לא הבנתי',
    'לא ברור לי',
    'אני צריך עזרה',
    'תעזור לי',
    'איך ממשיכים?',
    "I don't understand",
    'I need help',
    'Can you help me?',
  ])('CLOSED + %s → reopen + GPT', (inbound) => {
    const result = closedTurn(inbound)
    expect(result.reopen).toBe(true)
    expect(result.pre).toEqual({ action: 'proceed' })
    expect(result.gpt).toBe(1)
  })
})

describe('F. closed social stays closed', () => {
  it.each([
    'תודה',
    'תודה אחי',
    'סבבה',
    'לילה טוב',
    'שיהיה יום טוב',
    'נדבר',
    'נשתמע',
    "I'll think about it",
    'thanks',
  ])('CLOSED + %s stays CLOSED, 0 GPT', (inbound) => {
    const result = closedTurn(inbound)
    expect(result.reopen).toBe(false)
    expect(result.pre).toEqual({ action: 'skip', reason: 'closed' })
    expect(result.gpt).toBe(0)
  })
})

describe('G. business pain is not opt-out', () => {
  it.each([
    'נמאס לי לאבד לידים',
    'אני מתוסכל כי אני מאבד לידים',
    'אני מאבד יותר מדי לידים',
    'זה משגע אותי שאני מאבד לידים',
  ])('open + %s → PAIN_SIGNAL GPT', (inbound) => {
    expect(isBusinessPainSignal(inbound)).toBe(true)
    expect(detectOptOut(inbound)).toBe(false)
    const result = openPipeline(inbound)
    expect(result.control.action).not.toBe('CLOSE_CONVERSATION')
    expect(result.eligibility).toEqual({ decision: 'RUN_AI', reason: 'PAIN_SIGNAL' })
    expect(result.gpt).toBe(1)
  })

  it.each([
    'נמאס לי לאבד לידים',
    'אני מאבד יותר מדי לידים',
  ])('CLOSED + %s reopens + GPT', (inbound) => {
    const result = closedTurn(inbound)
    expect(result.reopen).toBe(true)
    expect(result.gpt).toBe(1)
  })

  it('bare נמאס לי after warning is not GPT', () => {
    expect(isBusinessPainSignal('נמאס לי')).toBe(false)
    expect(warningPipeline('נמאס לי').gpt).toBe(0)
  })

  it.each(['STOP', 'תפסיק לשלוח לי', 'אל תשלחו לי יותר'])('%s remains opt-out', (inbound) => {
    expect(detectOptOut(inbound)).toBe(true)
    expect(decidePreGeneration(pre({ optOut: true }))).toEqual({
      action: 'stop',
      state: 'opted_out',
      reason: 'opt_out',
    })
  })
})

describe('H. regressions', () => {
  it('warning + כן → close', () => {
    expect(warningPipeline('כן').control.action).toBe('CLOSE_CONVERSATION')
    expect(warningPipeline('כן').gpt).toBe(0)
  })

  it('explain-offer + כן → GPT', () => {
    const inbound = 'כן'
    const salesMove = classifySalesMove(inbound, { previousOutbound: EXPLAIN_OFFER })
    const control = decideConversationControl({
      salesMove,
      inboundText: inbound,
      previousOutbound: EXPLAIN_OFFER,
    })
    expect(control.action).toBe('CONTINUE')
    expect(
      shouldInvokeSalesAi({
        inboundText: inbound,
        previousOutbound: EXPLAIN_OFFER,
        salesMove,
        controlAction: 'CONTINUE',
        customerInboundCount: 3,
      }),
    ).toEqual({ decision: 'RUN_AI', reason: 'PENDING_QUESTION' })
  })

  it('statement + כן → WAIT', () => {
    const inbound = 'כן'
    const salesMove = classifySalesMove(inbound, { previousOutbound: ANSWER })
    expect(
      shouldInvokeSalesAi({
        inboundText: inbound,
        previousOutbound: ANSWER,
        salesMove,
        controlAction: 'CONTINUE',
        customerInboundCount: 3,
      }).decision,
    ).toBe('WAIT')
  })

  it('closed + יש לי עוד שאלה reopens', () => {
    expect(closedTurn('יש לי עוד שאלה').gpt).toBe(1)
  })

  it('escalated / human / opt-out skip', () => {
    expect(decidePreGeneration(pre({ aiState: 'escalated' }))).toEqual({
      action: 'skip',
      reason: 'already_escalated',
    })
    expect(decidePreGeneration(pre({ aiState: 'human_active' }))).toEqual({
      action: 'skip',
      reason: 'human_active',
    })
    expect(decidePreGeneration(pre({ aiState: 'opted_out' }))).toEqual({
      action: 'skip',
      reason: 'opted_out',
    })
  })

  it('there is no blanket warning → RUN_AI path', () => {
    const src = require('node:fs').readFileSync(
      require('node:path').resolve('lib/inbox/autoresponse/gptEligibility.ts'),
      'utf8',
    )
    expect(src).not.toMatch(/if \(.*previousOutboundKind === 'no_response_warning'[\s\S]{0,200}return run\(/)
    expect(src).toContain('afterWarning && isExplicitStayPresent')
  })
})
