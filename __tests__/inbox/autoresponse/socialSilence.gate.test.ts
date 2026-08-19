import { describe, expect, it } from 'vitest'
import {
  decideConversationControl,
  isExplicitReopen,
} from '@/lib/inbox/autoresponse/conversationControl'
import { classifySalesMove } from '@/lib/inbox/autoresponse/salesIntent'
import {
  inboundHasMeaningfulSalesIntent,
  shouldInvokeSalesAi,
} from '@/lib/inbox/autoresponse/gptEligibility'
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

function pipeline(inbound: string, previousOutbound = ANSWER, count = 4) {
  const salesMove = classifySalesMove(inbound, { ...STICKY, previousOutbound })
  const control = decideConversationControl({ salesMove, inboundText: inbound, previousOutbound })
  if (control.action !== 'CONTINUE' && control.action !== 'ASK_QUESTION') {
    return { salesMove, control, eligibility: null, gpt: 0 as const }
  }
  const eligibility = shouldInvokeSalesAi({
    inboundText: inbound,
    previousOutbound,
    salesMove,
    controlAction: control.action,
    customerInboundCount: count,
  })
  return {
    salesMove,
    control,
    eligibility,
    gpt: eligibility.decision === 'RUN_AI' ? (1 as const) : (0 as const),
  }
}

function firstTurn(inbound: string) {
  const salesMove = classifySalesMove(inbound)
  const control = decideConversationControl({ salesMove, inboundText: inbound })
  if (control.action !== 'CONTINUE' && control.action !== 'ASK_QUESTION') {
    return { salesMove, control, eligibility: null, gpt: 0 as const }
  }
  const eligibility = shouldInvokeSalesAi({
    inboundText: inbound,
    salesMove,
    controlAction: control.action,
    customerInboundCount: 1,
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
    return { reopen, pre: preDecision, gpt: 0 as const }
  }
  const result = pipeline(inbound)
  return { reopen, pre: preDecision, gpt: result.gpt }
}

describe('inboundHasMeaningfulSalesIntent — positive gate, not sticky', () => {
  it.each([
    'תודה על הכל',
    'תודה על הזמן',
    'טוב תודה',
    'חח תודה',
    'אני אחשוב על זה',
    'נדבר מחר',
    'לילה טוב',
    'שנייה',
  ])('%s is not meaningful intent', (inbound) => {
    expect(inboundHasMeaningfulSalesIntent(inbound)).toBe(false)
  })

  it.each([
    'מה המחיר?',
    'זה מתאים לעסק שלי',
    'אני רוצה להתחיל',
    'אני צריך מערכת ל-5 אנשי מכירות',
    'יש לי שאלה לגבי חיבור וואטסאפ',
  ])('%s is meaningful intent', (inbound) => {
    expect(inboundHasMeaningfulSalesIntent(inbound)).toBe(true)
  })
})

describe('open-thread social silence — WAIT, 0 GPT, not closed', () => {
  it.each([
    'תודה על הכל',
    'תודה על הזמן',
    'טוב תודה',
    'חח תודה',
    'חחחח תודה אחי',
    'שיהיה יום טוב',
    'לילה טוב',
    'שנייה',
    'תן לי רגע',
    'אני אחשוב על זה',
    'אעדכן אותך',
    'אני אחזור אליך',
    'נדבר מחר',
    'אחזור אליכם בהמשך',
    'תודההה אחי',
    '😂 תודה',
    '😂 תודה אחי',
    'סבבההה',
    'שנייההה',
    'יאללההה תודה',
  ])('%s after a product answer → WAIT / 0 GPT / not CLOSE', (inbound) => {
    const result = pipeline(inbound)
    expect(result.gpt).toBe(0)
    if (result.eligibility) {
      expect(result.eligibility.decision).toBe('WAIT')
      expect(result.control.action).not.toBe('CLOSE_CONVERSATION')
    }
  })
})

describe('open-thread social silence — genuine intent still RUN_AI', () => {
  it.each([
    'תודה על הכל, מה המחיר?',
    'תודה על הזמן, איך מתחברים?',
    'אני אחשוב על זה, אבל איך מתחברים?',
    'רגע, יש לי שאלה',
    'שנייה, כמה זה עולה?',
    'אני אחזור אליך, אבל לפני זה מה המחיר?',
    'תודה על ההסבר, איך זה עובד?',
    'אני רוצה להתחיל',
    'זה מתאים לעסק שלי',
    'אני צריך מערכת ל-5 אנשי מכירות',
    'יש לי שאלה לגבי חיבור וואטסאפ',
    'מה המחיר?',
    'איך מתחברים לוואטסאפ?',
  ])('%s → RUN_AI', (inbound) => {
    expect(pipeline(inbound).gpt).toBe(1)
  })
})

describe('first-turn silence vs intent', () => {
  it.each(['תודה', 'סבבה', 'לילה טוב', 'אני אחשוב על זה'])('%s as first inbound → 0 GPT', (inbound) => {
    expect(firstTurn(inbound).gpt).toBe(0)
  })

  it('היי, אני רוצה לדעת איך המערכת עובדת → RUN_AI', () => {
    expect(firstTurn('היי, אני רוצה לדעת איך המערכת עובדת').gpt).toBe(1)
  })

  it('first-turn greeting היי still RUN_AI', () => {
    expect(firstTurn('היי').eligibility).toEqual({ decision: 'RUN_AI', reason: 'FIRST_TURN' })
  })
})

describe('Task 7 regressions', () => {
  it('statement + כן → WAIT, 0 GPT', () => {
    const result = pipeline('כן', ANSWER)
    expect(result.gpt).toBe(0)
    expect(result.eligibility?.decision).toBe('WAIT')
  })

  it('רוצה שאסביר? + כן → RUN_AI', () => {
    expect(pipeline('כן', EXPLAIN_OFFER).gpt).toBe(1)
  })

  it('no-response warning + כן → Control CLOSE, 0 GPT', () => {
    const inbound = 'כן'
    const control = decideConversationControl({
      salesMove: classifySalesMove(inbound, { previousOutbound: NO_RESPONSE_WARNING_TEXT }),
      inboundText: inbound,
      previousOutbound: NO_RESPONSE_WARNING_TEXT,
      previousOutboundKind: 'no_response_warning',
      closeOfferPending: true,
    })
    expect(control).toEqual({
      action: 'CLOSE_CONVERSATION',
      send: 'closer',
      reason: 'no_response_confirmed',
    })
  })

  it('תודה אחי, ויש לי עוד שאלה → RUN_AI', () => {
    expect(pipeline('תודה אחי, ויש לי עוד שאלה').gpt).toBe(1)
  })

  it('אני אחשוב על זה, אבל איך מתחברים? → RUN_AI', () => {
    expect(pipeline('אני אחשוב על זה, אבל איך מתחברים?').gpt).toBe(1)
  })

  it('CLOSED + שיהיה יום טוב remains CLOSED, 0 GPT', () => {
    const result = closedTurn('שיהיה יום טוב')
    expect(result.reopen).toBe(false)
    expect(result.pre).toEqual({ action: 'skip', reason: 'closed' })
    expect(result.gpt).toBe(0)
  })

  it('CLOSED + יש לי עוד שאלה reopens and RUN_AI', () => {
    const result = closedTurn('יש לי עוד שאלה')
    expect(result.reopen).toBe(true)
    expect(result.pre).toEqual({ action: 'proceed' })
    expect(result.gpt).toBe(1)
  })

  it('ESCALATED → no GPT', () => {
    expect(decidePreGeneration(pre({ aiState: 'escalated' }))).toEqual({
      action: 'skip',
      reason: 'already_escalated',
    })
  })

  it('OPTED_OUT → no GPT', () => {
    expect(decidePreGeneration(pre({ aiState: 'opted_out' }))).toEqual({
      action: 'skip',
      reason: 'opted_out',
    })
    expect(decidePreGeneration(pre({ optOut: true }))).toEqual({
      action: 'stop',
      state: 'opted_out',
      reason: 'opt_out',
    })
  })

  it('HUMAN_ACTIVE → no GPT', () => {
    expect(decidePreGeneration(pre({ aiState: 'human_active' }))).toEqual({
      action: 'skip',
      reason: 'human_active',
    })
    expect(decidePreGeneration(pre({ humanTookOver: true }))).toEqual({
      action: 'stop',
      state: 'human_active',
      reason: 'human_active',
    })
  })
})
