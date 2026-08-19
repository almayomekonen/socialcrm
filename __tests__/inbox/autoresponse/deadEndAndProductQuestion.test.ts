import { describe, expect, it } from 'vitest'
import {
  decideConversationControl,
  inboundContainsRealQuestion,
} from '@/lib/inbox/autoresponse/conversationControl'
import {
  classifySalesMove,
  isCasualAcknowledgement,
  isDeadEndUtterance,
  isProductQuestion,
} from '@/lib/inbox/autoresponse/salesIntent'
import { shouldInvokeSalesAi } from '@/lib/inbox/autoresponse/gptEligibility'

const ANSWER = 'SocialCRM מרכזת לידים מוואטסאפ ופייסבוק במקום אחד, עם סטטוס ומעקב.'
const QUESTION = 'רוצה שאסביר איך זה נראה בעבודה היומיומית?'
const EXPLAIN_OFFER = 'רוצה שאסביר איך זה עובד?'

function pipeline(inbound: string, previousOutbound = ANSWER) {
  const salesMove = classifySalesMove(inbound, { previousOutbound, salesStrategy: 'product_fit' })
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

describe('P0 whole-utterance dead-end / goodbye', () => {
  it.each([
    'יאללה ביי',
    'יאללה, ביי',
    'נדבר',
    'נדבר בהמשך',
    'יום טוב',
    'תודה, נדבר',
    'תודה, יום טוב',
    'תודה אחי, נדבר',
  ])('%s → CLOSE silence, zero GPT', (inbound) => {
    expect(isDeadEndUtterance(inbound)).toBe(true)
    expect(inboundContainsRealQuestion(inbound)).toBe(false)
    const result = pipeline(inbound, ANSWER)
    expect(result.control).toEqual({ action: 'CLOSE_CONVERSATION', send: 'silence', reason: 'goodbye' })
    expect(result.gpt).toBe(0)
  })

  it.each(['קיבלתי', 'קיבלתי, תודה'])('%s after an answer → CLOSE silence, zero GPT', (inbound) => {
    expect(isCasualAcknowledgement(inbound)).toBe(true)
    expect(isDeadEndUtterance(inbound)).toBe(false)
    const result = pipeline(inbound, ANSWER)
    expect(result.control).toEqual({
      action: 'CLOSE_CONVERSATION',
      send: 'silence',
      reason: 'acknowledgement',
    })
    expect(result.gpt).toBe(0)
  })

  it('קיבלתי after a pending question still produces zero GPT', () => {
    const result = pipeline('קיבלתי', QUESTION)
    expect(result.gpt).toBe(0)
  })

  it.each([
    'קיבלתי, ומה המחיר?',
    'קיבלתי, מה המחיר?',
    'נדבר על זה, אבל יש לי שאלה',
    'יום טוב, יש לי שאלה',
    'כן, נדבר על זה אחרי שתסביר',
    'תודה, ויש לי עוד שאלה',
    'יום טוב, אפשר לשאול משהו?',
    'נדבר על זה, אבל איך זה עובד?',
  ])('%s is not a dead-end close', (inbound) => {
    expect(isDeadEndUtterance(inbound)).toBe(false)
    const result = pipeline(inbound, ANSWER)
    expect(result.control.action).not.toBe('CLOSE_CONVERSATION')
  })

  it('קיבלתי, מה המחיר? → RUN_AI', () => {
    expect(pipeline('קיבלתי, מה המחיר?', ANSWER).gpt).toBe(1)
  })

  it('יום טוב, יש לי שאלה → RUN_AI', () => {
    expect(pipeline('יום טוב, יש לי שאלה', ANSWER).gpt).toBe(1)
  })

  it('נדבר על זה, אבל איך זה עובד? → RUN_AI', () => {
    expect(pipeline('נדבר על זה, אבל איך זה עובד?', ANSWER).gpt).toBe(1)
  })

  it('sticky product does not rewrite יאללה ביי into a sales turn', () => {
    expect(classifySalesMove('יאללה ביי', { salesStrategy: 'product_fit', previousOutbound: ANSWER })).toBe(
      'CASUAL_ACKNOWLEDGEMENT',
    )
  })
})

describe('P0 Hebrew product-question detection', () => {
  it.each([
    'כיצד היא מנהלת את הלידים?',
    'האם ניתן לחבר WhatsApp?',
    'האם אפשר לחבר פייסבוק?',
    'איך המערכת עובדת?',
    'מה המערכת מציעה?',
    'אפשר לחבר וואטסאפ?',
  ])('%s → PRODUCT_QUESTION and RUN_AI', (inbound) => {
    expect(isProductQuestion(inbound)).toBe(true)
    expect(classifySalesMove(inbound)).toBe('PRODUCT_QUESTION')
    const result = pipeline(inbound, ANSWER)
    expect(result.salesMove).toBe('PRODUCT_QUESTION')
    expect(result.control.action).toBe('CONTINUE')
    expect(result.gpt).toBe(1)
  })

  it('מה המחיר stays BUYING_SIGNAL (existing classifier order) and still RUN_AI', () => {
    expect(isProductQuestion('מה המחיר?')).toBe(true)
    expect(classifySalesMove('מה המחיר?')).toBe('BUYING_SIGNAL')
    expect(pipeline('מה המחיר?', ANSWER).gpt).toBe(1)
  })
})

describe('P0 must not regress existing stop / eligibility gates', () => {
  it('רוצה שאסביר? + כן → CONTINUE + GPT', () => {
    const result = pipeline('כן', EXPLAIN_OFFER)
    expect(result.control.action).toBe('CONTINUE')
    expect(result.gpt).toBe(1)
  })

  it('כן after a statement → WAIT, zero GPT', () => {
    const result = pipeline('כן', ANSWER)
    expect(result.gpt).toBe(0)
    expect(result.eligibility?.decision).toBe('WAIT')
  })

  it('תודה אחי after an answer → zero GPT', () => {
    expect(pipeline('תודה אחי', ANSWER).gpt).toBe(0)
  })
})
