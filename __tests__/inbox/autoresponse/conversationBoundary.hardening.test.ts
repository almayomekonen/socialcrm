import { describe, expect, it } from 'vitest'
import {
  decideConversationControl,
  isExplicitReopen,
  inboundContainsRealQuestion,
} from '@/lib/inbox/autoresponse/conversationControl'
import {
  classifySalesMove,
  collapseRepeatedLetters,
  isCasualAcknowledgement,
  isDeadEndUtterance,
  isHoldOnUtterance,
  isExplicitHelpRequest,
  isShortAffirmative,
} from '@/lib/inbox/autoresponse/salesIntent'
import { shouldInvokeSalesAi } from '@/lib/inbox/autoresponse/gptEligibility'
import { detectOptOut } from '@/lib/inbox/autoresponse/qualify'
import { decidePreGeneration, type PreFacts } from '@/lib/inbox/autoresponse/stateMachine'

const ANSWER = 'SocialCRM מרכזת לידים מוואטסאפ ופייסבוק במקום אחד, עם סטטוס ומעקב.'
const QUESTION = 'רוצה שאסביר איך זה נראה בעבודה היומיומית?'
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

function pipeline(inbound: string, previousOutbound = ANSWER) {
  const salesMove = classifySalesMove(inbound, { previousOutbound, salesStrategy: 'product_fit', priorMoves: ['PRODUCT_FIT'] })
  const control = decideConversationControl({ salesMove, inboundText: inbound, previousOutbound })
  if (control.action !== 'CONTINUE' && control.action !== 'ASK_QUESTION') {
    return { salesMove, control, eligibility: null, gpt: 0 as const }
  }
  const eligibility = shouldInvokeSalesAi({
    inboundText: inbound,
    previousOutbound,
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
    return { salesMove, reopen, pre: preDecision, control: null, gpt: 0 as const }
  }
  if (preDecision.action === 'handoff') {
    return { salesMove, reopen, pre: preDecision, control: null, gpt: 0 as const }
  }
  const control = decideConversationControl({
    salesMove,
    inboundText: inbound,
    previousOutbound: ANSWER,
  })
  if (control.action !== 'CONTINUE' && control.action !== 'ASK_QUESTION') {
    return { salesMove, reopen, pre: preDecision, control, gpt: 0 as const }
  }
  const eligibility = shouldInvokeSalesAi({
    inboundText: inbound,
    previousOutbound: ANSWER,
    salesMove,
    controlAction: control.action,
    customerInboundCount: 6,
  })
  return {
    salesMove,
    reopen,
    pre: preDecision,
    control,
    eligibility,
    gpt: eligibility.decision === 'RUN_AI' ? (1 as const) : (0 as const),
  }
}

describe('P0 closed / reopen boundary', () => {
  it.each([
    'Have a good day',
    'Thanks, have a good day',
    'נשתמע',
    'תישאר בקשר',
    'סבבה',
    'תודה',
    'יום טוב',
    'נדבר',
    'קיבלתי',
    'רגע',
  ])('CLOSED + %s stays CLOSED, 0 GPT (sticky PRODUCT_FIT cannot reopen)', (inbound) => {
    const result = closedTurn(inbound)
    expect(result.reopen).toBe(false)
    expect(result.pre).toEqual({ action: 'skip', reason: 'closed' })
    expect(result.gpt).toBe(0)
  })

  it.each([
    'יש לי עוד שאלה',
    'יש לי שאלה',
    'רציתי לשאול עוד משהו',
    'יש לי עוד משהו לשאול',
    'יש לי שאלה לגבי המחיר',
    'רציתי לדעת איך זה עובד',
    'רגע יש לי עוד שאלה',
    'I have another question',
  ])('CLOSED + %s reopens and RUN_AI', (inbound) => {
    expect(isExplicitHelpRequest(inbound) || inboundContainsRealQuestion(inbound)).toBe(true)
    const result = closedTurn(inbound)
    expect(result.reopen).toBe(true)
    expect(result.pre).toEqual({ action: 'proceed' })
    expect(result.gpt).toBe(1)
  })

  it('CLOSED + מה המחיר? reopens and RUN_AI', () => {
    const result = closedTurn('מה המחיר?')
    expect(result.reopen).toBe(true)
    expect(result.gpt).toBe(1)
  })

  it('CLOSED + איך מתחברים לוואטסאפ? reopens and RUN_AI', () => {
    const result = closedTurn('איך מתחברים לוואטסאפ?')
    expect(result.reopen).toBe(true)
    expect(result.gpt).toBe(1)
  })

  it('CLOSED + Can I connect WhatsApp? reopens and RUN_AI', () => {
    const result = closedTurn('Can I connect WhatsApp?')
    expect(result.reopen).toBe(true)
    expect(result.gpt).toBe(1)
  })

  it('CLOSED + אני רוצה להתחיל reopens and RUN_AI', () => {
    const result = closedTurn('אני רוצה להתחיל')
    expect(result.reopen).toBe(true)
    expect(result.gpt).toBe(1)
  })

  it('CLOSED + אפשר לדבר עם נציג? hands off with 0 GPT', () => {
    const result = closedTurn('אפשר לדבר עם נציג?')
    expect(result.reopen).toBe(true)
    expect(result.gpt).toBe(0)
    expect(result.control?.action === 'HANDOFF_TO_HUMAN' || result.pre.action === 'handoff').toBe(true)
  })
})

describe('P0 WhatsApp letter elongation', () => {
  it.each([
    ['יאללההה', 'יאלה'],
    ['סבבההה', 'סבה'],
    ['תודההה', 'תודה'],
    ['כןןן', 'כן'],
    ['אחיייי', 'אחי'],
    ['מחיררר?', 'מחיר?'],
    ['איךךך זה עובד?', 'איך זה עובד?'],
    ['מההה המחיר?', 'מה המחיר?'],
  ])('collapseRepeatedLetters(%j) → %j', (input, expected) => {
    expect(collapseRepeatedLetters(input)).toBe(expected)
  })

  it('does not strip punctuation, words, or collapse to empty from a real question', () => {
    expect(collapseRepeatedLetters('מחיררר?')).toBe('מחיר?')
    expect(collapseRepeatedLetters('איךךך זה עובד?')).toContain('זה')
    expect(collapseRepeatedLetters('איךךך זה עובד?')).toContain('?')
    expect(collapseRepeatedLetters('!!!')).toBe('!!!')
  })

  it('יאללהה ביי → CLOSE / 0 GPT', () => {
    expect(isDeadEndUtterance('יאללהה ביי')).toBe(true)
    expect(pipeline('יאללהה ביי').gpt).toBe(0)
    expect(pipeline('יאללהה ביי').control.action).toBe('CLOSE_CONVERSATION')
  })

  it('סבבההה after an answer → WAIT/CLOSE, 0 GPT', () => {
    expect(isCasualAcknowledgement('סבבההה')).toBe(true)
    expect(pipeline('סבבההה').gpt).toBe(0)
  })

  it('תודההה אחי → 0 GPT', () => {
    expect(isCasualAcknowledgement('תודההה אחי')).toBe(true)
    expect(pipeline('תודההה אחי').gpt).toBe(0)
  })

  it('כןןן after a statement → WAIT / 0 GPT', () => {
    expect(isShortAffirmative('כןןן')).toBe(true)
    const result = pipeline('כןןן', ANSWER)
    expect(result.gpt).toBe(0)
    expect(result.eligibility?.decision).toBe('WAIT')
  })

  it('כןןן after a real question → RUN_AI', () => {
    expect(pipeline('כןןן', EXPLAIN_OFFER).gpt).toBe(1)
  })

  it('elongated product questions stay RUN_AI', () => {
    expect(pipeline('מחיררר?', ANSWER).gpt).toBe(1)
    expect(pipeline('איךךך זה עובד?', ANSWER).gpt).toBe(1)
    expect(pipeline('מההה המחיר?', ANSWER).gpt).toBe(1)
  })
})

describe('P0 emoji + acknowledgement', () => {
  it.each(['😂😂 תודה', '👍 סבבה', '😂 תודההה אחי', '🙏 תודה', '👍👍 אוקיי'])(
    '%s after an answer → 0 GPT',
    (inbound) => {
      expect(isCasualAcknowledgement(inbound)).toBe(true)
      expect(pipeline(inbound).gpt).toBe(0)
    },
  )

  it('😂 תודה, ויש לי שאלה → RUN_AI', () => {
    expect(isCasualAcknowledgement('😂 תודה, ויש לי שאלה')).toBe(false)
    expect(pipeline('😂 תודה, ויש לי שאלה').gpt).toBe(1)
  })

  it('👍 סבבה, מה המחיר? → RUN_AI', () => {
    expect(isCasualAcknowledgement('👍 סבבה, מה המחיר?')).toBe(false)
    expect(pipeline('👍 סבבה, מה המחיר?').gpt).toBe(1)
  })

  it('😂 סבבה, איך מתחילים? → RUN_AI', () => {
    expect(pipeline('😂 סבבה, איך מתחילים?').gpt).toBe(1)
  })
})

describe('P0 whole-utterance goodbye / dead-end', () => {
  it.each([
    'נשתמע',
    'תישאר בקשר',
    'נדבר אחר כך',
    'נדבר בהמשך',
    'נשתמע בהמשך',
    'Have a good day',
    'talk later',
    'talk to you later',
    'take care',
    'have a nice day',
  ])('%s is a whole-utterance dead-end, CLOSE / 0 GPT', (inbound) => {
    expect(isDeadEndUtterance(inbound)).toBe(true)
    expect(pipeline(inbound).gpt).toBe(0)
    expect(pipeline(inbound).control.action).toBe('CLOSE_CONVERSATION')
  })

  it('Have a good day, I have another question → RUN_AI', () => {
    expect(isDeadEndUtterance('Have a good day, I have another question')).toBe(false)
    expect(pipeline('Have a good day, I have another question').gpt).toBe(1)
  })

  it('Talk later, but can you explain WhatsApp? → RUN_AI', () => {
    expect(isDeadEndUtterance('Talk later, but can you explain WhatsApp?')).toBe(false)
    expect(pipeline('Talk later, but can you explain WhatsApp?').gpt).toBe(1)
  })
})

describe('P0 רגע is WAIT, not a sales turn', () => {
  it.each(['רגע', 'רגע רגע', 'רגע אחי', 'רגע, שנייה', 'רגע שנייה'])('%s → WAIT / 0 GPT, not CLOSE', (inbound) => {
    expect(isHoldOnUtterance(inbound)).toBe(true)
    const result = pipeline(inbound)
    expect(result.control.action).not.toBe('CLOSE_CONVERSATION')
    expect(result.gpt).toBe(0)
    expect(result.eligibility).toEqual({ decision: 'WAIT', reason: 'HOLD_ON' })
  })

  it.each(['רגע, יש לי שאלה', 'רגע, איך מתחברים?', 'רגע, מה המחיר?'])('%s → RUN_AI', (inbound) => {
    expect(isHoldOnUtterance(inbound)).toBe(false)
    expect(pipeline(inbound).gpt).toBe(1)
  })
})

describe('P0 thanks composition without a new need', () => {
  it.each([
    'תודה על ההסבר',
    'תודה על העזרה',
    'תודה על המידע',
    'תודה על התשובה',
    'תודה רבה על ההסבר',
    'תודה אחי על ההסבר',
  ])('%s after an answer → WAIT/CLOSE / 0 GPT', (inbound) => {
    expect(isCasualAcknowledgement(inbound)).toBe(true)
    expect(pipeline(inbound, ANSWER).gpt).toBe(0)
  })

  it.each([
    'תודה על ההסבר, אבל יש לי עוד שאלה',
    'תודה על ההסבר, מה המחיר?',
    'תודה על העזרה, איך מתחילים?',
    'תודה על המידע, אפשר לחבר WhatsApp?',
  ])('%s → RUN_AI', (inbound) => {
    expect(isCasualAcknowledgement(inbound)).toBe(false)
    expect(pipeline(inbound, ANSWER).gpt).toBe(1)
  })
})

describe('P0 frustration is not opt-out', () => {
  it.each(['נמאס לי', 'נמאס לי לאבד לידים', 'נמאס לי מזה', 'אני מתוסכל', 'זה משגע אותי'])(
    '%s is not opt-out',
    (inbound) => {
      expect(detectOptOut(inbound)).toBe(false)
    },
  )

  it.each(['תפסיק לשלוח לי', 'אל תשלחו לי יותר', 'אני לא רוצה לקבל הודעות', 'STOP', 'unsubscribe', 'remove me'])(
    '%s remains opted_out',
    (inbound) => {
      expect(detectOptOut(inbound)).toBe(true)
    },
  )
})

describe('P0 Stop Policy regressions', () => {
  it('warning + כן → deterministic close, 0 GPT', () => {
    const inbound = 'כן'
    const control = decideConversationControl({
      salesMove: classifySalesMove(inbound, { previousOutbound: QUESTION }),
      inboundText: inbound,
      previousOutbound: QUESTION,
      previousOutboundKind: 'no_response_warning',
      closeOfferPending: true,
    })
    expect(control).toEqual({
      action: 'CLOSE_CONVERSATION',
      send: 'closer',
      reason: 'no_response_confirmed',
    })
  })

  it('כן after רוצה שאסביר? → GPT', () => {
    expect(pipeline('כן', EXPLAIN_OFFER).gpt).toBe(1)
  })

  it('כן after a statement → WAIT', () => {
    const result = pipeline('כן', ANSWER)
    expect(result.gpt).toBe(0)
    expect(result.eligibility?.decision).toBe('WAIT')
  })

  it('תודה אחי after an answer → 0 GPT', () => {
    expect(pipeline('תודה אחי', ANSWER).gpt).toBe(0)
  })

  it('real product question → RUN_AI', () => {
    expect(pipeline('יש לכם מענה אוטומטי לוואטסאפ?', ANSWER).gpt).toBe(1)
  })

  it('turn 100 + real question still RUN_AI', () => {
    const inbound = 'מה המחיר?'
    const salesMove = classifySalesMove(inbound)
    const eligibility = shouldInvokeSalesAi({
      inboundText: inbound,
      previousOutbound: ANSWER,
      salesMove,
      controlAction: 'CONTINUE',
      customerInboundCount: 100,
    })
    expect(eligibility.decision).toBe('RUN_AI')
  })

  it('handoff → 0 GPT', () => {
    expect(pipeline('אפשר לדבר עם נציג?', ANSWER).gpt).toBe(0)
    expect(pipeline('אפשר לדבר עם נציג?', ANSWER).control.action).toBe('HANDOFF_TO_HUMAN')
  })

  it('closed + generic acknowledgement → 0 GPT', () => {
    expect(closedTurn('תודה').gpt).toBe(0)
    expect(closedTurn('סבבה').gpt).toBe(0)
  })
})
