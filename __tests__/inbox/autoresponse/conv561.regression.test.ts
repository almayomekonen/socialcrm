import { describe, expect, it } from 'vitest'
import { classifySalesMove, classifySalesMoveFromTranscript } from '@/lib/inbox/autoresponse/salesIntent'
import { decidePostGeneration } from '@/lib/inbox/autoresponse/stateMachine'
import { questionPolicyForSalesMove, validateAutoResponse } from '@/lib/inbox/autoresponse/validate'
import { handoffMessage } from '@/lib/inbox/autoresponse/qualify'

const TURN1 = 'יש לי עסק של נדל״ן ונכנסים לי הרבה לקוחות אני צריך עזרה בניהול לידים'
const TURN2 = 'אוקיי איך אנחנו מתקדמים?'
const GENERATED =
  'כדי להתקדם, נתחיל במיפוי קצר של מקורות הלידים ונראה איך לרכז את המעקב. מאיפה רוב הלידים נכנסים היום—וואטסאפ, פייסבוק או האתר?'
const CANNED = 'מישהו מהצוות ימשיך איתך ויחזור אליך בהקדם.'

describe('production conversation 561 regression (lead 1458)', () => {
  it('turn 1 is PRODUCT_FIT; turn 2 is next-step BUYING_SIGNAL and must CONTINUE', () => {
    expect(classifySalesMove(TURN1)).toBe('PRODUCT_FIT')
    expect(classifySalesMove(TURN2)).toBe('BUYING_SIGNAL')
    const thread = [
      { direction: 'inbound' as const, text: TURN1 },
      { direction: 'outbound' as const, text: 'SocialCRM מרכזת את הלידים במקום אחד' },
      { direction: 'inbound' as const, text: TURN2 },
    ]
    expect(classifySalesMoveFromTranscript(thread)).toBe('BUYING_SIGNAL')
    expect(questionPolicyForSalesMove(classifySalesMoveFromTranscript(thread))).toBe('zero_or_one')
  })

  it('the Production generated reply is valid and must be sent despite LLM BUYING/hot', () => {
    const classifierMove = classifySalesMove(TURN2)
    expect(classifierMove).toBe('BUYING_SIGNAL')
    expect(questionPolicyForSalesMove(classifierMove)).toBe('zero_or_one')
    expect(validateAutoResponse(GENERATED, { questionPolicy: 'zero_or_one' }).ok).toBe(true)

    const post = decidePostGeneration({
      hotSignal: true,
      uncertain: false,
      requiredComplete: false,
      turnCount: 1,
      maxTurns: 5,
      salesMove: classifierMove,
    })
    expect(post).toEqual({ action: 'send' })
    expect(GENERATED).not.toBe(CANNED)
    expect(handoffMessage('human_request', 'he')).toBe(CANNED)
  })

  it('LLM salesMove=BUYING_SIGNAL cannot override classifier DISCOVERY into a handoff', () => {
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
    expect(
      decidePostGeneration({
        hotSignal: true,
        uncertain: false,
        requiredComplete: false,
        turnCount: 1,
        maxTurns: 5,
        salesMove: 'BUYING_SIGNAL',
      }),
    ).toEqual({ action: 'send' })
  })
})
