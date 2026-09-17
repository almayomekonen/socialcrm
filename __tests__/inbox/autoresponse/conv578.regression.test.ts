import { describe, expect, it } from 'vitest'
import {
  classifySalesMove,
  classifySalesTurnFromTranscript,
  type SalesMove,
} from '@/lib/inbox/autoresponse/salesIntent'
import { retrieveProductKnowledge } from '@/lib/inbox/autoresponse/productRetrieve'
import { decidePostGeneration, decidePreGeneration, ireHardCeiling } from '@/lib/inbox/autoresponse/stateMachine'
import { questionPolicyForSalesMove, validateAutoResponse } from '@/lib/inbox/autoresponse/validate'
import { deterministicQualifyFallback } from '@/lib/inbox/autoresponse/qualify'
import { buildQualifyUser } from '@/lib/inbox/autoresponse/qualifyPrompt'
import type { SalesStrategy } from '@/lib/inbox/autoresponse/qualification'

const CONV578 = [
  'יש לי עסק של נדל״ן ונכנסים לי הרבה לקוחות אני צריך עזרה בניהול לידים',
  'איך מתקדמים?',
  'וואטסאפ - ופייסבוק',
  'הוא נתקע בזה שאין מערכת שיכולה להכיל לי אותם',
  'זה בדיוק מה שאני צריך! אני מנהל את כולם דרך הוואטסאפ',
  'כן',
  'תן לי הסבר קצר על המערכת',
  'תסדר לי לידים',
] as const

const EXPLAIN_OFFER = 'רוצה שאסביר איך זה נראה בעבודה היומיומית?'
const EXPLANATION =
  'SocialCRM מרכזת לידים מוואטסאפ ופייסבוק במקום אחד, עם סטטוס ומעקב לכל פנייה.'
const ADVANCE_FALLBACK = 'מה הכי חשוב לך שנסדר עכשיו?'
const HANDOFF = 'הפנייה שלך ממתינה כעת לטיפול הצוות.'

function replay578(opts?: { offerBeforeYes?: boolean }) {
  const offerBeforeYes = opts?.offerBeforeYes !== false
  const thread: Array<{ direction: 'inbound' | 'outbound'; text: string }> = []
  let salesStrategy: SalesStrategy | undefined
  const turns: Array<{
    inbound: string
    salesMove: SalesMove
    salesStrategy: SalesStrategy
    questionPolicy: ReturnType<typeof questionPolicyForSalesMove>
  }> = []
  for (let i = 0; i < CONV578.length; i++) {
    const inbound = CONV578[i]
    thread.push({ direction: 'inbound', text: inbound })
    const turn = classifySalesTurnFromTranscript(thread, { salesStrategy })
    salesStrategy = turn.salesStrategy
    turns.push({
      inbound,
      salesMove: turn.salesMove,
      salesStrategy: turn.salesStrategy,
      questionPolicy: questionPolicyForSalesMove(turn.salesMove),
    })
    const outbound = i === 4 && offerBeforeYes ? EXPLAIN_OFFER : EXPLANATION
    thread.push({ direction: 'outbound', text: outbound })
  }
  return turns
}

describe('production conversation 578 regression (lead 1460)', () => {
  it('does not reset to DISCOVERY after product intent is established', () => {
    const turns = replay578()
    expect(turns[0]).toMatchObject({ salesMove: 'PRODUCT_FIT', salesStrategy: 'product_fit' })
    expect(turns[1]).toMatchObject({ salesMove: 'BUYING_SIGNAL', salesStrategy: 'next_step' })
    expect(turns[2].salesMove).not.toBe('DISCOVERY')
    expect(turns[2].salesMove).not.toBe('DEEPEN')
    expect(turns[5]).toMatchObject({ salesMove: 'PRODUCT_QUESTION', salesStrategy: 'explain' })
    expect(turns[6]).toMatchObject({ salesMove: 'PRODUCT_QUESTION', salesStrategy: 'explain' })
    expect(turns[7]).toMatchObject({ salesMove: 'PRODUCT_FIT', salesStrategy: 'product_fit' })
    expect(turns.every((t) => t.salesMove !== 'HANDOFF_REQUEST')).toBe(true)
    expect(turns.filter((t) => t.salesMove === 'DISCOVERY')).toEqual([])
  })

  it('CASE A: כן after an explicit explanation offer enters explain', () => {
    const turns = replay578({ offerBeforeYes: true })
    expect(turns[5]).toMatchObject({ salesMove: 'PRODUCT_QUESTION', salesStrategy: 'explain' })
    expect(turns[5].questionPolicy).toBe('zero_or_one')
  })

  it('CASE B: כן after a product explanation continues product strategy without DISCOVERY', () => {
    const turns = replay578({ offerBeforeYes: false })
    expect(turns[5].salesMove).not.toBe('DISCOVERY')
    expect(turns[5].salesMove).not.toBe('DEEPEN')
    expect(turns[5].salesMove).toBe('PRODUCT_QUESTION')
    expect(turns[5].salesStrategy).toBe('how_it_works')
    expect(turns[5].questionPolicy).toBe('zero_or_one')
    expect(turns.filter((t) => t.salesMove === 'DISCOVERY')).toEqual([])
  })

  it('yes-after-explain and explicit explain allow a zero-question product reply', () => {
    for (const offerBeforeYes of [true, false]) {
      const turns = replay578({ offerBeforeYes })
      for (const idx of [5, 6, 7]) {
        expect(turns[idx].questionPolicy).toBe('zero_or_one')
        expect(validateAutoResponse(EXPLANATION, { questionPolicy: turns[idx].questionPolicy }).ok).toBe(true)
        const fallback = deterministicQualifyFallback({
          qualification: { need: 'ניהול לידים' },
          lastInboundText: turns[idx].inbound,
          lang: 'he',
          salesMove: turns[idx].salesMove,
          salesStrategy: turns[idx].salesStrategy,
        })
        expect(fallback).not.toBe(ADVANCE_FALLBACK)
        expect(fallback).not.toBe(HANDOFF)
      }
    }
  })

  it('retrieves product knowledge for explain / yes / organize-leads turns', () => {
    const turns = replay578()
    for (const idx of [0, 1, 5, 6, 7]) {
      const r = retrieveProductKnowledge({
        agencyId: 103,
        inboundText: turns[idx].inbound,
        salesMove: turns[idx].salesMove,
        envRaw: '103',
      })
      expect(r.enabled).toBe(true)
      expect(r.capabilities.length).toBeGreaterThan(0)
    }
  })

  it('next-step and organize-leads continue — they do not hand off', () => {
    for (const salesMove of ['BUYING_SIGNAL', 'PRODUCT_FIT', 'PRODUCT_QUESTION'] as const) {
      expect(
        decidePostGeneration({
          hotSignal: true,
          uncertain: false,
          requiredComplete: false,
          turnCount: 6,
          maxTurns: 5,
          salesMove,
        }),
      ).toEqual({ action: 'send' })
    }
    expect(classifySalesMove('איך מתקדמים?')).toBe('BUYING_SIGNAL')
    expect(classifySalesMove('תסדר לי לידים')).toBe('PRODUCT_FIT')
  })

  it('late turns still proceed — the loop is not hidden by a conversation ceiling', () => {
    expect(ireHardCeiling(5)).toBe(7)
    expect(
      decidePreGeneration({
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
        turnCount: 7,
        maxTurns: 5,
      }),
    ).toEqual({ action: 'proceed' })
    expect(
      decidePreGeneration({
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
        turnCount: 6,
        maxTurns: 5,
      }),
    ).toEqual({ action: 'proceed' })
  })

  it('explain prompt does not instruct a discovery questionnaire', () => {
    const user = buildQualifyUser({
      transcript: [
        { direction: 'inbound', text: CONV578[0] },
        { direction: 'outbound', text: EXPLAIN_OFFER },
        { direction: 'inbound', text: 'כן' },
      ],
      qualification: { need: 'ניהול לידים', cognition: { salesStrategy: 'explain' } },
      collectFields: { required: ['name'], optional: [] },
      guidance: null,
      salesMove: 'PRODUCT_QUESTION',
      salesStrategy: 'explain',
    })
    expect(user).toContain('אפס שאלות זה תקין')
    expect(user).not.toContain('בחרי יעד אחד עם הערך הכי גבוה עכשיו')
  })
})
