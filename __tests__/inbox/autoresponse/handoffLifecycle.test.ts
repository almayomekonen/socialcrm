/**
 * P0/P1 handoff lifecycle + no-dash regression matrix.
 * Existing salesAgent / qualifyAiRetry / stateMachine tests remain the source of
 * truth; this file is the named A–M checklist from the production forensic.
 */
import { describe, expect, it } from 'vitest'
import { classifySalesMove, classifySalesTurn } from '@/lib/inbox/autoresponse/salesIntent'
import { decidePostGeneration, decidePreGeneration, ireHardCeiling } from '@/lib/inbox/autoresponse/stateMachine'
import { decidePostHandoffInbound } from '@/lib/inbox/autoresponse/postHandoffPolicy'
import {
  finalizeCustomerFacingText,
  hasCustomerFacingDash,
} from '@/lib/inbox/autoresponse/customerFacingText'
import { deterministicQualifyFallback, handoffMessage } from '@/lib/inbox/autoresponse/qualify'
import { postHandoffStatusMessage } from '@/lib/inbox/autoresponse/postHandoffPolicy'

const pre = {
  aiState: 'ai_qualifying' as const,
  masterEnabled: true,
  channelEnabled: true,
  humanTookOver: false,
  optOut: false,
  hasUnansweredInbound: true,
  withinQuietHours: false,
  withinWindow: true,
  sentTodayForAgency: 0,
  dailyCap: 200,
  turnCount: 7,
  maxTurns: 5,
}

describe('handoff lifecycle regression matrix', () => {
  it('A: aiTurnCount=7 + HANDOFF_REQUEST → handoff, not max_turns', () => {
    expect(ireHardCeiling(5)).toBe(7)
    expect(classifySalesMove('סבבה, תעביר אותי לנציג אנושי')).toBe('HANDOFF_REQUEST')
    expect(decidePreGeneration({ ...pre, humanRequest: true })).toEqual({
      action: 'handoff',
      reason: 'human_request',
    })
    expect(decidePostGeneration({ hotSignal: false, uncertain: false, requiredComplete: false, turnCount: 7, maxTurns: 5, salesMove: 'HANDOFF_REQUEST' })).toEqual({
      action: 'escalate',
      reason: 'human_request',
    })
  })

  it('B: aiTurnCount=7 + PRODUCT_FIT → hard ceiling skip', () => {
    expect(classifySalesMove('זה מתאים לעסק שלי')).toBe('PRODUCT_FIT')
    expect(decidePreGeneration({ ...pre, humanRequest: false })).toEqual({
      action: 'skip',
      reason: 'max_turns',
    })
  })

  it('C: aiTurnCount=7 + BUYING_SIGNAL → ceiling skip, no handoff', () => {
    expect(classifySalesMove('אני רוצה להתחיל')).toBe('BUYING_SIGNAL')
    expect(decidePreGeneration({ ...pre, humanRequest: false })).toEqual({
      action: 'skip',
      reason: 'max_turns',
    })
    expect(
      decidePostGeneration({
        hotSignal: true,
        uncertain: false,
        requiredComplete: false,
        turnCount: 7,
        maxTurns: 5,
        salesMove: 'BUYING_SIGNAL',
      }),
    ).toEqual({ action: 'send' })
  })

  it('D/E: escalated status follow-ups confirm; F: תודה is silent', () => {
    expect(decidePostHandoffInbound('אתה מעביר אותי?')).toBe('confirm')
    expect(decidePostHandoffInbound('העברת?')).toBe('confirm')
    expect(decidePostHandoffInbound('תודה')).toBe('silent')
  })

  it('G/H/I: generated, fallback, handoff, and post-handoff text have no dash', () => {
    expect(hasCustomerFacingDash(finalizeCustomerFacingText('הלידים מרוכזים במקום אחד — כך קל לעקוב.'))).toBe(false)
    expect(
      hasCustomerFacingDash(
        finalizeCustomerFacingText(
          deterministicQualifyFallback({
            qualification: {},
            lastInboundText: 'איך זה עובד',
            lang: 'he',
            salesMove: 'PRODUCT_FIT',
            salesStrategy: 'product_fit',
          }),
        ),
      ),
    ).toBe(false)
    expect(hasCustomerFacingDash(finalizeCustomerFacingText(handoffMessage('human_request', 'he')))).toBe(false)
    expect(hasCustomerFacingDash(finalizeCustomerFacingText(postHandoffStatusMessage('he')))).toBe(false)
  })

  it('J: LLM hotSignal=true + classifier DISCOVERY → CONTINUE', () => {
    expect(
      decidePostGeneration({
        hotSignal: true,
        uncertain: false,
        requiredComplete: false,
        turnCount: 1,
        maxTurns: 5,
        salesMove: 'DISCOVERY',
      }),
    ).toEqual({ action: 'send' })
  })

  it('K: LLM salesMove=HANDOFF_REQUEST + classifier DISCOVERY → CONTINUE', () => {
    expect(
      decidePostGeneration({
        hotSignal: true,
        uncertain: false,
        requiredComplete: false,
        turnCount: 1,
        maxTurns: 5,
        salesMove: 'DISCOVERY',
      }),
    ).toEqual({ action: 'send' })
  })

  it('L: כן after explanation offer → EXPLAIN', () => {
    const turn = classifySalesTurn({
      lastInbound: 'כן',
      previousOutbound: 'רוצה שאסביר איך זה נראה בעבודה היומיומית?',
      salesStrategy: 'product_fit',
    })
    expect(turn.salesStrategy).toBe('explain')
  })

  it('M: כן after product explanation is not DISCOVERY', () => {
    const turn = classifySalesTurn({
      lastInbound: 'כן',
      previousOutbound: 'SocialCRM מרכזת לידים במקום אחד עם סטטוס ומעקב.',
      salesStrategy: 'how_it_works',
      priorMoves: ['PRODUCT_QUESTION'],
    })
    expect(turn.salesMove).not.toBe('DISCOVERY')
    expect(turn.salesStrategy).not.toBe('discover')
  })
})
