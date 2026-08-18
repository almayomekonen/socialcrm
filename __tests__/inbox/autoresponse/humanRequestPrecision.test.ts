/**
 * P0: human-request precision. Product talk about continuing conversations
 * with the customer's own leads must not hand off. Explicit person-asks must.
 */
import { describe, expect, it } from 'vitest'
import {
  classifySalesMove,
  classifySalesTurn,
  classifySalesTurnFromTranscript,
  detectHumanRequest,
  detectHotSignal,
  isProductStrategy,
} from '@/lib/inbox/autoresponse/salesIntent'
import { decidePostGeneration, decidePreGeneration } from '@/lib/inbox/autoresponse/stateMachine'
import { INBOUND_AUTO_RESPONSE_ID } from '@/lib/product/capabilities'
import { retrieveProductKnowledge } from '@/lib/inbox/autoresponse/productRetrieve'

const PREV_OUTBOUND =
  'הבנתי, מענה אוטומטי לפניות חדשות בוואטסאפ כדי שלא יישארו בלי תגובה. היית רוצה שהוא רק ישיב מיד, או גם ימשיך את השיחה עם הלקוח?'

const PROD_INBOUND = 'ימשיך שיחה  עם הלקוח'

const PRODUCT_CAPABILITY = [
  'שיחה עם הלקוח',
  'ימשיך שיחה',
  'ניהול שיחה',
  'מענה אוטומטי ימשיך את השיחה',
  'אני רוצה מערכת שתמשיך שיחות עם הלקוחות',
  'אני רוצה שהמערכת תמשיך שיחות עם הלקוחות',
  'שהבוט ימשיך את השיחה עם הלקוח',
  'מענה אוטומטי שימשיך את השיחה',
  'אני רוצה שהוא ימשיך לדבר עם הלקוחות',
  'שהמערכת תענה ותמשיך את השיחה',
  PROD_INBOUND,
]

const GENUINE_DISCOVERY = [
  'אני מקבל הרבה לידים',
  'יש לי הרבה לקוחות',
  'אני רוצה להשיג יותר שקט בעסק',
]

const EXPLICIT_HANDOFF = [
  'תעביר אותי לנציג',
  'אני רוצה לדבר עם נציג',
  'אני רוצה לדבר עם בן אדם',
  'אפשר לדבר עם מישהו?',
  'תחבר אותי לנציג',
]

const preBase = {
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
  turnCount: 4,
  maxTurns: 5,
}

describe('P0 human-request precision — product conversation capability', () => {
  it('critical regression: echoing the auto-reply choice is a product turn, not discovery or handoff', () => {
    expect(detectHumanRequest(PROD_INBOUND, { previousOutbound: PREV_OUTBOUND })).toBe(false)
    expect(detectHumanRequest(PROD_INBOUND)).toBe(false)
    const move = classifySalesMove(PROD_INBOUND, { previousOutbound: PREV_OUTBOUND })
    expect(move).not.toBe('HANDOFF_REQUEST')
    expect(move).not.toBe('DISCOVERY')
    expect(['PRODUCT_QUESTION', 'PRODUCT_FIT']).toContain(move)
    const turn = classifySalesTurn({
      lastInbound: PROD_INBOUND,
      previousOutbound: PREV_OUTBOUND,
      salesStrategy: 'discover',
    })
    expect(turn.salesMove).not.toBe('HANDOFF_REQUEST')
    expect(turn.salesMove).not.toBe('DISCOVERY')
    expect(isProductStrategy(turn.salesStrategy)).toBe(true)
  })

  it.each(PRODUCT_CAPABILITY)('product-conversation inbound is PRODUCT_QUESTION/FIT: %s', (text) => {
    expect(detectHumanRequest(text)).toBe(false)
    const move = classifySalesMove(text)
    expect(move).not.toBe('HANDOFF_REQUEST')
    expect(move).not.toBe('DISCOVERY')
    expect(['PRODUCT_QUESTION', 'PRODUCT_FIT']).toContain(move)
    expect(detectHotSignal(text)).toBe(false)
  })

  it.each(GENUINE_DISCOVERY)('genuine discovery stays non-product-conversation: %s', (text) => {
    expect(classifySalesMove(text)).toBe('DISCOVERY')
  })

  it('עזרה בניהול לידים stays PRODUCT_FIT, not continue-conversation DISCOVERY', () => {
    expect(classifySalesMove('אני צריך עזרה בניהול לידים')).toBe('PRODUCT_FIT')
  })

  it('pre-generation proceeds and post-generation does not escalate', () => {
    expect(
      decidePreGeneration({
        ...preBase,
        humanRequest: detectHumanRequest(PROD_INBOUND, { previousOutbound: PREV_OUTBOUND }),
      }),
    ).toEqual({ action: 'proceed' })
    const move = classifySalesMove(PROD_INBOUND, { previousOutbound: PREV_OUTBOUND })
    expect(
      decidePostGeneration({
        hotSignal: false,
        uncertain: false,
        requiredComplete: false,
        turnCount: 4,
        maxTurns: 5,
        salesMove: move,
      }),
    ).toEqual({ action: 'send' })
  })

  it('full production transcript does not classify HANDOFF_REQUEST', () => {
    const transcript = [
      { direction: 'inbound' as const, text: 'היי שלום אשמח לקבל פרטים על השירותים שלכם' },
      { direction: 'outbound' as const, text: 'היי, בשמחה. כדי לתת לך פרטים מדויקים ורלוונטיים, מה היית רוצה להשיג כרגע בעסק?' },
      { direction: 'inbound' as const, text: 'אני רוצה להשיג שקט וניהול נכון' },
      { direction: 'outbound' as const, text: 'כדי להבין איפה הכי נכון לעשות סדר, מה היום גוזל ממך הכי הרבה שקט בניהול העסק?' },
      { direction: 'inbound' as const, text: 'מערכת שתעזור לי לשלוח הודעות חימום ללקוחות חדשים ולא לאבד אותם' },
      { direction: 'outbound' as const, text: 'הכוונה להודעות יזומות אחרי שלקוח חדש משאיר פרטים, או למענה אוטומטי כשהוא פונה בוואטסאפ?' },
      { direction: 'inbound' as const, text: 'מענה אוטומטי' },
      { direction: 'outbound' as const, text: PREV_OUTBOUND },
      { direction: 'inbound' as const, text: PROD_INBOUND },
    ]
    const turn = classifySalesTurnFromTranscript(transcript, { salesStrategy: 'discover' })
    expect(turn.salesMove).not.toBe('HANDOFF_REQUEST')
    expect(turn.salesMove).not.toBe('DISCOVERY')
    expect(['PRODUCT_QUESTION', 'PRODUCT_FIT']).toContain(turn.salesMove)
    expect(isProductStrategy(turn.salesStrategy)).toBe(true)
  })

  it('continue-conversation inbound retrieves inbound auto-response Product Knowledge', () => {
    const move = classifySalesMove(PROD_INBOUND, { previousOutbound: PREV_OUTBOUND })
    const pk = retrieveProductKnowledge({
      agencyId: 103,
      inboundText: PROD_INBOUND,
      salesMove: move,
      envRaw: '103',
    })
    expect(pk.enabled).toBe(true)
    expect(pk.capabilities.some((c) => c.id === INBOUND_AUTO_RESPONSE_ID)).toBe(true)
    expect(pk.unverifiedRequest).toBe(false)
  })
})

describe('P0 human-request precision — explicit person-asks still hand off', () => {
  it.each(EXPLICIT_HANDOFF)('%s → HANDOFF_REQUEST', (text) => {
    expect(detectHumanRequest(text)).toBe(true)
    expect(classifySalesMove(text)).toBe('HANDOFF_REQUEST')
    expect(
      decidePreGeneration({
        ...preBase,
        humanRequest: detectHumanRequest(text),
      }),
    ).toEqual({ action: 'handoff', reason: 'human_request' })
    expect(
      decidePostGeneration({
        hotSignal: false,
        uncertain: false,
        requiredComplete: false,
        turnCount: 4,
        maxTurns: 5,
        salesMove: 'HANDOFF_REQUEST',
      }),
    ).toEqual({ action: 'escalate', reason: 'human_request' })
  })

  it('explicit person-ask still wins when the same line mentions שיחה', () => {
    const text = 'תעביר אותי לנציג שימשיך שיחה עם הלקוח'
    expect(detectHumanRequest(text)).toBe(true)
    expect(classifySalesMove(text)).toBe('HANDOFF_REQUEST')
  })

  it('meeting schedule without product-conversation context still hands off', () => {
    expect(detectHumanRequest('בוא נקבע פגישה')).toBe(true)
    expect(detectHumanRequest('call me please')).toBe(true)
    expect(classifySalesMove('בוא נקבע פגישה')).toBe('HANDOFF_REQUEST')
  })
})
