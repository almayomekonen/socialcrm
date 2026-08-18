import { describe, expect, it } from 'vitest'
import {
  allowsOutbound,
  conversationCloser,
  countConsecutiveAiOutbounds,
  decideConversationControl,
  inboundContainsRealQuestion,
  isExplicitReopen,
  outboundAsksQuestion,
} from '@/lib/inbox/autoresponse/conversationControl'
import { classifySalesMove, classifySalesTurnFromTranscript } from '@/lib/inbox/autoresponse/salesIntent'
import { decidePostGeneration, decidePreGeneration, type PreFacts } from '@/lib/inbox/autoresponse/stateMachine'

const pre = (over: Partial<PreFacts> = {}): PreFacts => ({
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
  turnCount: 1,
  maxTurns: 5,
  ...over,
})

const ANSWER = 'SocialCRM מרכזת לידים מוואטסאפ ופייסבוק במקום אחד, עם סטטוס ומעקב.'
const QUESTION = 'רוצה שאסביר איך זה נראה בעבודה היומיומית?'

describe('sticky acknowledgements', () => {
  it('sticky product + תודה רבה → CLOSE silence, not PRODUCT_FIT', () => {
    expect(classifySalesMove('תודה רבה', { salesStrategy: 'product_fit' })).toBe('CASUAL_ACKNOWLEDGEMENT')
    expect(
      decideConversationControl({
        salesMove: 'CASUAL_ACKNOWLEDGEMENT',
        inboundText: 'תודה רבה',
        previousOutbound: ANSWER,
      }),
    ).toEqual({ action: 'CLOSE_CONVERSATION', send: 'silence', reason: 'acknowledgement' })
  })

  it('sticky + ok after an answer → CLOSE silence', () => {
    expect(classifySalesMove('ok', { salesStrategy: 'product_fit', previousOutbound: ANSWER })).toBe(
      'CASUAL_ACKNOWLEDGEMENT',
    )
    expect(
      decideConversationControl({
        salesMove: 'CASUAL_ACKNOWLEDGEMENT',
        inboundText: 'ok',
        previousOutbound: ANSWER,
      }),
    ).toEqual({ action: 'CLOSE_CONVERSATION', send: 'silence', reason: 'acknowledgement' })
  })

  it('אוקיי after an outbound question → CONTINUE', () => {
    expect(classifySalesMove('אוקיי', { salesStrategy: 'product_fit', previousOutbound: QUESTION })).toBe(
      'PRODUCT_QUESTION',
    )
    expect(
      decideConversationControl({
        salesMove: 'PRODUCT_QUESTION',
        inboundText: 'אוקיי',
        previousOutbound: QUESTION,
      }),
    ).toEqual({ action: 'CONTINUE' })
  })

  it('כן after an explicit question → CONTINUE', () => {
    const thread = [
      { direction: 'inbound', text: 'אני צריך מערכת לניהול לידים' },
      { direction: 'outbound', text: QUESTION },
      { direction: 'inbound', text: 'כן' },
    ]
    const turn = classifySalesTurnFromTranscript(thread, { salesStrategy: 'product_fit' })
    expect(turn.salesMove).toBe('PRODUCT_QUESTION')
    expect(decideConversationControl({ salesMove: turn.salesMove, inboundText: 'כן', previousOutbound: QUESTION })).toEqual({
      action: 'CONTINUE',
    })
  })
})

describe('close / reopen / unlimited', () => {
  it('לא מעוניין → closer then CLOSED', () => {
    expect(decideConversationControl({ salesMove: 'PRODUCT_FIT', inboundText: 'לא מעוניין' })).toEqual({
      action: 'CLOSE_CONVERSATION',
      send: 'closer',
      reason: 'decline',
    })
    expect(conversationCloser('he')).toBe('אין בעיה, תודה.')
  })

  it('bye → closer then CLOSED', () => {
    expect(decideConversationControl({ salesMove: 'DISCOVERY', inboundText: 'bye' })).toEqual({
      action: 'CLOSE_CONVERSATION',
      send: 'closer',
      reason: 'goodbye',
    })
  })

  it('closed + product question → reopen CONTINUE', () => {
    const inbound = 'יש לכם מענה אוטומטי לוואטסאפ?'
    const salesMove = classifySalesMove(inbound)
    expect(salesMove).toBe('PRODUCT_QUESTION')
    expect(isExplicitReopen({ salesMove, inboundText: inbound })).toBe(true)
    expect(decidePreGeneration(pre({ aiState: 'closed', reopenEligible: true, turnCount: 8 }))).toEqual({
      action: 'proceed',
    })
    expect(decideConversationControl({ salesMove, inboundText: inbound })).toEqual({ action: 'CONTINUE' })
  })

  it('closed + תודה stays CLOSED, no send', () => {
    expect(isExplicitReopen({ salesMove: 'CASUAL_ACKNOWLEDGEMENT', inboundText: 'תודה' })).toBe(false)
    expect(decidePreGeneration(pre({ aiState: 'closed', reopenEligible: false }))).toEqual({
      action: 'skip',
      reason: 'closed',
    })
  })

  it('turn 30 + real product question → CONTINUE', () => {
    const inbound = 'יש לכם מענה אוטומטי לוואטסאפ?'
    expect(classifySalesMove(inbound)).toBe('PRODUCT_QUESTION')
    expect(decidePreGeneration(pre({ turnCount: 30 }))).toEqual({ action: 'proceed' })
    expect(decidePostGeneration({
      hotSignal: false,
      uncertain: false,
      requiredComplete: false,
      turnCount: 30,
      maxTurns: 5,
      salesMove: 'PRODUCT_QUESTION',
    })).toEqual({ action: 'send' })
  })

  it('turn 30 + HANDOFF_REQUEST → HANDOFF', () => {
    expect(classifySalesMove('תעביר אותי לנציג')).toBe('HANDOFF_REQUEST')
    expect(decidePreGeneration(pre({ turnCount: 30, humanRequest: true }))).toEqual({
      action: 'handoff',
      reason: 'human_request',
    })
  })

  it('compound acknowledgement + real question → CONTINUE', () => {
    const inbound = 'תודה רבה, יש לכם מענה אוטומטי לוואטסאפ?'
    expect(inboundContainsRealQuestion(inbound)).toBe(true)
    const salesMove = classifySalesMove(inbound, { salesStrategy: 'product_fit' })
    expect(salesMove).toBe('PRODUCT_QUESTION')
    expect(decideConversationControl({ salesMove, inboundText: inbound })).toEqual({ action: 'CONTINUE' })
  })
})

describe('allowsOutbound gate', () => {
  const base = {
    aiState: 'ai_qualifying' as const,
    hasUnansweredInbound: true,
    consecutiveAiWithoutInbound: 0,
    humanTookOver: false,
    optOut: false,
  }

  it('outbound last message → allowsOutbound=false', () => {
    expect(allowsOutbound({ ...base, hasUnansweredInbound: false })).toEqual({
      allowed: false,
      reason: 'no_pending_inbound',
    })
    expect(
      countConsecutiveAiOutbounds([
        { direction: 'inbound', metadata: null },
        { direction: 'outbound', metadata: { source: 'auto_response' } },
      ]),
    ).toBe(1)
    expect(allowsOutbound({ ...base, consecutiveAiWithoutInbound: 1 })).toEqual({
      allowed: false,
      reason: 'consecutive_ai',
    })
  })

  it('escalated → no outbound', () => {
    expect(allowsOutbound({ ...base, aiState: 'escalated' })).toEqual({
      allowed: false,
      reason: 'already_escalated',
    })
  })

  it('opt-out unchanged', () => {
    expect(allowsOutbound({ ...base, optOut: true })).toEqual({ allowed: false, reason: 'opt_out' })
    expect(decidePreGeneration(pre({ optOut: true }))).toEqual({
      action: 'stop',
      state: 'opted_out',
      reason: 'opt_out',
    })
  })

  it('human takeover unchanged', () => {
    expect(allowsOutbound({ ...base, humanTookOver: true })).toEqual({
      allowed: false,
      reason: 'human_active',
    })
    expect(decidePreGeneration(pre({ humanTookOver: true }))).toEqual({
      action: 'stop',
      state: 'human_active',
      reason: 'human_active',
    })
  })

  it('closed without reopen cannot send', () => {
    expect(allowsOutbound({ ...base, aiState: 'closed' })).toEqual({ allowed: false, reason: 'closed' })
  })

  it('closed + reopen eligible can send when inbound is unanswered', () => {
    expect(allowsOutbound({ ...base, aiState: 'closed', reopenEligible: true })).toEqual({ allowed: true })
  })

  it('outboundAsksQuestion is last-sentence pending, not any embedded ?', () => {
    expect(outboundAsksQuestion(QUESTION)).toBe(true)
    expect(outboundAsksQuestion(ANSWER)).toBe(false)
    const rhetoricalThenAnswer =
      'אם הכוונה היא שהמערכת תענה כשכותבים אליך? כן, יש מענה אוטומטי להודעות נכנסות.'
    expect(outboundAsksQuestion(rhetoricalThenAnswer)).toBe(false)
    expect(
      decideConversationControl({
        salesMove: 'CASUAL_ACKNOWLEDGEMENT',
        inboundText: 'תודה',
        previousOutbound: rhetoricalThenAnswer,
      }),
    ).toEqual({ action: 'CLOSE_CONVERSATION', send: 'silence', reason: 'acknowledgement' })
    expect(classifySalesMove('אוקיי', { salesStrategy: 'product_fit', previousOutbound: rhetoricalThenAnswer })).toBe(
      'CASUAL_ACKNOWLEDGEMENT',
    )
    const answerThenAsk = `${ANSWER} רוצה שאסביר?`
    expect(outboundAsksQuestion(answerThenAsk)).toBe(true)
    expect(classifySalesMove('אוקיי', { salesStrategy: 'product_fit', previousOutbound: answerThenAsk })).toBe(
      'PRODUCT_QUESTION',
    )
  })
})

describe('colloquial acknowledgement-only close', () => {
  const sticky = { salesStrategy: 'product_fit' as const, previousOutbound: ANSWER }

  it.each(['תודה אחי', 'תודה רבה אחי', 'סבבה תודה אחי', 'אוקיי אחי', 'תודה גבר', 'תודה אלוף'])(
    '%s after an answer → CLOSE silence, not PRODUCT_FIT',
    (inbound) => {
      expect(classifySalesMove(inbound, sticky)).toBe('CASUAL_ACKNOWLEDGEMENT')
      expect(
        decideConversationControl({
          salesMove: classifySalesMove(inbound, sticky),
          inboundText: inbound,
          previousOutbound: ANSWER,
        }),
      ).toEqual({ action: 'CLOSE_CONVERSATION', send: 'silence', reason: 'acknowledgement' })
    },
  )

  it.each([
    'תודה, ויש גם חיבור לאינסטגרם?',
    'סבבה תודה, אבל איך זה עובד?',
    'תודה אחי, אפשר לקבל מחיר?',
  ])('%s → CONTINUE', (inbound) => {
    expect(inboundContainsRealQuestion(inbound)).toBe(true)
    const salesMove = classifySalesMove(inbound, sticky)
    expect(salesMove).not.toBe('CASUAL_ACKNOWLEDGEMENT')
    expect(decideConversationControl({ salesMove, inboundText: inbound, previousOutbound: ANSWER })).toEqual({
      action: 'CONTINUE',
    })
  })
})
