import { describe, expect, it } from 'vitest'
import { classifySalesMove, classifySalesTurnFromTranscript, detectHumanRequest } from '@/lib/inbox/autoresponse/salesIntent'
import { detectOptOut, deterministicQualifyFallback, handoffMessage } from '@/lib/inbox/autoresponse/qualify'
import { buildQualifyUser } from '@/lib/inbox/autoresponse/qualifyPrompt'
import { retrieveProductKnowledge } from '@/lib/inbox/autoresponse/productRetrieve'
import { isBusinessIdentityQuestion } from '@/lib/inbox/autoresponse/businessIdentityIntent'
import { finalizeCustomerFacingText, hasCustomerFacingDash } from '@/lib/inbox/autoresponse/customerFacingText'
import { questionPolicyForSalesMove, validateAutoResponse } from '@/lib/inbox/autoresponse/validate'
import {
  decidePostGeneration,
  decidePreGeneration,
  isDiscoveryQuestionBudgetExhausted,
  type PreFacts,
} from '@/lib/inbox/autoresponse/stateMachine'

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

const post = (salesMove: Parameters<typeof decidePostGeneration>[0]['salesMove'], turnCount: number) =>
  decidePostGeneration({
    hotSignal: true,
    uncertain: false,
    requiredComplete: false,
    turnCount,
    maxTurns: 5,
    salesMove,
  })

describe('unlimited engaged conversation lifetime', () => {
  it('A: turn 7 + PRODUCT_FIT → CONTINUE', () => {
    expect(classifySalesMove('זה מתאים לעסק שלי')).toBe('PRODUCT_FIT')
    expect(decidePreGeneration(pre({ turnCount: 7 }))).toEqual({ action: 'proceed' })
    expect(post('PRODUCT_FIT', 7)).toEqual({ action: 'send' })
    expect(isDiscoveryQuestionBudgetExhausted({ salesMove: 'PRODUCT_FIT', turnCount: 7, maxTurns: 5 })).toBe(false)
  })

  it('B: turn 10 + PRODUCT_QUESTION → CONTINUE', () => {
    expect(classifySalesMove('האם המערכת שלכם עושה את זה?')).toBe('PRODUCT_QUESTION')
    expect(decidePreGeneration(pre({ turnCount: 10 }))).toEqual({ action: 'proceed' })
    expect(post('PRODUCT_QUESTION', 10)).toEqual({ action: 'send' })
    expect(isDiscoveryQuestionBudgetExhausted({ salesMove: 'PRODUCT_QUESTION', turnCount: 10, maxTurns: 5 })).toBe(false)
  })

  it('C: turn 20 + BUYING_SIGNAL → CONTINUE', () => {
    expect(classifySalesMove('איך מתקדמים?')).toBe('BUYING_SIGNAL')
    expect(decidePreGeneration(pre({ turnCount: 20 }))).toEqual({ action: 'proceed' })
    expect(post('BUYING_SIGNAL', 20)).toEqual({ action: 'send' })
  })

  it('D: turn 30 + PRODUCT_FIT → CONTINUE', () => {
    expect(classifySalesMove('תסדר לי לידים')).toBe('PRODUCT_FIT')
    expect(decidePreGeneration(pre({ turnCount: 30 }))).toEqual({ action: 'proceed' })
    expect(post('PRODUCT_FIT', 30)).toEqual({ action: 'send' })
  })

  it('E: turn 50 + legitimate product question → CONTINUE', () => {
    const inbound = 'יש לכם מענה אוטומטי לוואטסאפ?'
    expect(classifySalesMove(inbound)).toBe('PRODUCT_QUESTION')
    expect(decidePreGeneration(pre({ turnCount: 50 }))).toEqual({ action: 'proceed' })
    expect(post('PRODUCT_QUESTION', 50)).toEqual({ action: 'send' })
    expect(isDiscoveryQuestionBudgetExhausted({ salesMove: 'PRODUCT_QUESTION', turnCount: 50, maxTurns: 5 })).toBe(false)
  })

  it('F: turn 50 + explicit HANDOFF_REQUEST → immediate handoff', () => {
    const inbound = 'סבבה, תעביר אותי לנציג אנושי'
    expect(classifySalesMove(inbound)).toBe('HANDOFF_REQUEST')
    expect(detectHumanRequest(inbound)).toBe(true)
    expect(decidePreGeneration(pre({ turnCount: 50, humanRequest: true }))).toEqual({
      action: 'handoff',
      reason: 'human_request',
    })
    expect(post('HANDOFF_REQUEST', 50)).toEqual({ action: 'escalate', reason: 'human_request' })
  })

  it('G: turn 50 + opt-out → stop', () => {
    expect(detectOptOut('תפסיק לשלוח לי הודעות')).toBe(true)
    expect(decidePreGeneration(pre({ turnCount: 50, optOut: true }))).toEqual({
      action: 'stop',
      state: 'opted_out',
      reason: 'opt_out',
    })
  })

  it('H: turn 50 + human takeover → stop', () => {
    expect(decidePreGeneration(pre({ turnCount: 50, humanTookOver: true }))).toEqual({
      action: 'stop',
      state: 'human_active',
      reason: 'human_active',
    })
  })

  it('I: discovery question budget blocks endless DISCOVERY questions, not product answers', () => {
    expect(isDiscoveryQuestionBudgetExhausted({ salesMove: 'DISCOVERY', turnCount: 5, maxTurns: 5 })).toBe(true)
    expect(questionPolicyForSalesMove('DISCOVERY', { discoveryBudgetExhausted: true })).toBe('zero_or_one')
    expect(questionPolicyForSalesMove('DISCOVERY')).toBe('require_one')
    const fallback = deterministicQualifyFallback({
      qualification: { need: 'שקט בעסק' },
      lastInboundText: 'אוקיי',
      lang: 'he',
      salesMove: 'DISCOVERY',
      discoveryBudgetExhausted: true,
    })
    expect(fallback.includes('?')).toBe(false)
    expect(validateAutoResponse(fallback, { questionPolicy: 'zero_or_one' }).ok).toBe(true)
    const user = buildQualifyUser({
      transcript: [{ direction: 'inbound', text: 'אוקיי' }],
      qualification: { need: 'שקט בעסק' },
      collectFields: { required: ['need'], optional: [] },
      guidance: null,
      salesMove: 'DISCOVERY',
      discoveryBudgetExhausted: true,
    })
    expect(user).toContain('תקציב שאלות הגילוי הסתיים')
    expect(isDiscoveryQuestionBudgetExhausted({ salesMove: 'PRODUCT_QUESTION', turnCount: 5, maxTurns: 5 })).toBe(false)
    expect(questionPolicyForSalesMove('PRODUCT_QUESTION', { discoveryBudgetExhausted: true })).toBe('zero_or_one')
  })

  it('J: no pre-generation path returns skipReason=max_turns for an engaged customer', () => {
    for (const turnCount of [0, 5, 7, 10, 20, 30, 50, 200]) {
      const d = decidePreGeneration(pre({ turnCount, maxTurns: 5 }))
      expect(d).toEqual({ action: 'proceed' })
      expect('reason' in d ? d.reason : null).not.toBe('max_turns')
    }
  })

  it('K: classifier remains the commercial handoff authority', () => {
    expect(post('DISCOVERY', 50)).toEqual({ action: 'send' })
    expect(post('BUYING_SIGNAL', 50)).toEqual({ action: 'send' })
    expect(post('HANDOFF_REQUEST', 50)).toEqual({ action: 'escalate', reason: 'human_request' })
  })

  it('L: persistent salesStrategy still sticky across turns', () => {
    const classified = classifySalesTurnFromTranscript(
      [
        { direction: 'inbound', text: 'יש לי עסק של נדל״ן ונכנסים לי הרבה לקוחות אני צריך עזרה בניהול לידים' },
        { direction: 'outbound', text: 'רוצה שאסביר איך זה נראה בעבודה היומיומית?' },
        { direction: 'inbound', text: 'כן' },
      ],
      { salesStrategy: 'product_fit' },
    )
    expect(classified.salesMove).toBe('PRODUCT_QUESTION')
    expect(classified.salesStrategy).toBe('explain')
  })

  it('M: no-dash normalization remains intact', () => {
    const text = finalizeCustomerFacingText('הלידים מרוכזים במקום אחד — כך קל לעקוב.')
    expect(hasCustomerFacingDash(text)).toBe(false)
  })

  it('N: business identity questions remain identity, not discovery', () => {
    expect(isBusinessIdentityQuestion('במה אתם עוסקים?')).toBe(true)
    expect(classifySalesMove('במה אתם עוסקים?')).toBe('PRODUCT_QUESTION')
  })

  it('O: Product Knowledge still attaches for product questions', () => {
    const pk = retrieveProductKnowledge({
      agencyId: 103,
      inboundText: 'יש לכם מענה אוטומטי לוואטסאפ?',
      salesMove: 'PRODUCT_QUESTION',
      envRaw: '103',
    })
    expect(pk.enabled).toBe(true)
    expect(pk.capabilities.length).toBeGreaterThan(0)
  })
})
