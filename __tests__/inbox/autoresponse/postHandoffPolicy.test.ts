import { describe, expect, it } from 'vitest'
import {
  decidePostHandoffInbound,
  isPostHandoffStatusFollowUp,
  postHandoffStatusMessage,
} from '@/lib/inbox/autoresponse/postHandoffPolicy'
import { classifySalesMove, classifySalesTurn } from '@/lib/inbox/autoresponse/salesIntent'
import { hasCustomerFacingDash } from '@/lib/inbox/autoresponse/customerFacingText'

describe('post-handoff inbound policy', () => {
  it('D: אתה מעביר אותי? is a status follow-up confirmation', () => {
    expect(isPostHandoffStatusFollowUp('אתה מעביר אותי?')).toBe(true)
    expect(decidePostHandoffInbound('אתה מעביר אותי?')).toBe('confirm')
    expect(classifySalesMove('אתה מעביר אותי?')).not.toBe('HANDOFF_REQUEST')
  })

  it('E: העברת? is a status follow-up confirmation', () => {
    expect(decidePostHandoffInbound('העברת?')).toBe('confirm')
    expect(decidePostHandoffInbound('מישהו יחזור אליי?')).toBe('confirm')
    expect(decidePostHandoffInbound('מה קורה עכשיו?')).toBe('confirm')
    expect(decidePostHandoffInbound('אז מחכים לנציג?')).toBe('confirm')
  })

  it('F: תודה / סבבה / מעולה stay silent', () => {
    expect(decidePostHandoffInbound('תודה')).toBe('silent')
    expect(decidePostHandoffInbound('סבבה')).toBe('silent')
    expect(decidePostHandoffInbound('מעולה')).toBe('silent')
  })

  it('a repeated human request after handoff confirms instead of re-escalating', () => {
    expect(decidePostHandoffInbound('סבבה, תעביר אותי לנציג אנושי')).toBe('confirm')
  })

  it('other business questions stay concierge (GPT path remains agency-gated)', () => {
    expect(decidePostHandoffInbound('יש לכם אפליקציה?')).toBe('concierge')
  })

  it('status copy has no dash characters', () => {
    expect(hasCustomerFacingDash(postHandoffStatusMessage('he'))).toBe(false)
    expect(hasCustomerFacingDash(postHandoffStatusMessage('en'))).toBe(false)
  })
})

describe('P0.2 classifier stays sticky', () => {
  it('L: כן after an explanation offer is EXPLAIN', () => {
    const turn = classifySalesTurn({
      lastInbound: 'כן',
      previousOutbound: 'רוצה שאסביר איך זה נראה בעבודה היומיומית?',
      salesStrategy: 'product_fit',
    })
    expect(turn.salesMove).toBe('PRODUCT_QUESTION')
    expect(turn.salesStrategy).toBe('explain')
  })

  it('M: כן after an existing product explanation stays product strategy, not DISCOVERY', () => {
    const turn = classifySalesTurn({
      lastInbound: 'כן',
      previousOutbound:
        'בפועל, השיחות מהוואטסאפ ייכנסו למערכת, ומשם מקשרים כל פנייה לליד, מעדכנים סטטוס וקובעים מתי לחזור אליו.',
      salesStrategy: 'product_fit',
      priorMoves: ['PRODUCT_FIT'],
    })
    expect(turn.salesMove).not.toBe('DISCOVERY')
    expect(turn.salesStrategy).not.toBe('discover')
  })
})
