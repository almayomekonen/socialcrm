import { describe, expect, it } from 'vitest'
import { classifySalesMove, classifySalesMoveFromTranscript } from '@/lib/inbox/autoresponse/salesIntent'
import { retrieveProductKnowledge } from '@/lib/inbox/autoresponse/productRetrieve'
import { decidePostGeneration } from '@/lib/inbox/autoresponse/stateMachine'
import { questionPolicyForSalesMove, validateAutoResponse } from '@/lib/inbox/autoresponse/validate'
import { QUALIFY_SYSTEM_PROMPT } from '@/lib/inbox/autoresponse/qualifyPrompt'
import { handoffMessage } from '@/lib/inbox/autoresponse/qualify'

const CONV463 = [
  'יש לי עסק של נדל״ן ונכנסים לי הרבה לקוחות אני צריך עזרה בניהול לידים',
  'אני מפסיד כסף ולקוחות',
  'אני מפסיד כסף ולקוחות',
  'אחי זה לא עניינך אני צריך מערכת לניהול לידים',
  'איך אתה יכול לעזור לי?',
] as const

const PRODUCT_ANSWER =
  'SocialCRM מרכזת את הלידים שלך מפייסבוק, אינסטגרם ווואטסאפ במקום אחד, כך שאתה לא צריך לנהל אותם מפוזרים בין שיחות וקבצים.'

describe('production conversation 463 regression (lead 1419)', () => {
  it('classifies the thread as product-fit then product-question, not a CRM field hunt', () => {
    expect(classifySalesMove(CONV463[0])).toBe('PRODUCT_FIT')
    expect(classifySalesMove(CONV463[1])).toBe('DEEPEN')
    expect(classifySalesMove(CONV463[2])).toBe('DEEPEN')
    expect(classifySalesMove(CONV463[3])).toBe('PRODUCT_FIT')
    expect(classifySalesMove(CONV463[4])).toBe('PRODUCT_QUESTION')

    const thread: Array<{ direction: 'inbound' | 'outbound'; text: string }> = []
    const sequential: string[] = []
    for (const text of CONV463) {
      thread.push({ direction: 'inbound', text })
      sequential.push(classifySalesMoveFromTranscript(thread))
    }
    expect(sequential).toEqual(['PRODUCT_FIT', 'PRODUCT_FIT', 'PRODUCT_FIT', 'PRODUCT_FIT', 'PRODUCT_QUESTION'])
  })

  it('retrieves verified lead capabilities for product turns', () => {
    const thread: Array<{ direction: 'inbound' | 'outbound'; text: string }> = []
    for (const text of CONV463) {
      thread.push({ direction: 'inbound', text })
      const move = classifySalesMoveFromTranscript(thread)
      if (move !== 'PRODUCT_FIT' && move !== 'PRODUCT_QUESTION') continue
      const r = retrieveProductKnowledge({
        agencyId: 103,
        inboundText: text,
        salesMove: move,
        envRaw: '103',
      })
      expect(r.enabled).toBe(true)
      expect(r.capabilities.length).toBeGreaterThan(0)
      expect(r.capabilities.some((c) => c.id === 'leads' || c.mayMentionProactively)).toBe(true)
    }
  })

  it('allows a product answer with zero questions and does not hand off at soft maxTurns', () => {
    expect(questionPolicyForSalesMove('PRODUCT_FIT')).toBe('zero_or_one')
    expect(questionPolicyForSalesMove('PRODUCT_QUESTION')).toBe('zero_or_one')
    expect(validateAutoResponse(PRODUCT_ANSWER, { questionPolicy: 'zero_or_one' }).ok).toBe(true)
    expect(PRODUCT_ANSWER).not.toMatch(/חימום|מבין שזה|מלחיץ/)

    let turnCount = 0
    const thread: Array<{ direction: 'inbound' | 'outbound'; text: string }> = []
    for (const text of CONV463) {
      thread.push({ direction: 'inbound', text })
      const salesMove = classifySalesMoveFromTranscript(thread)
      const post = decidePostGeneration({
        hotSignal: false,
        uncertain: false,
        requiredComplete: false,
        turnCount,
        maxTurns: 5,
        salesMove,
      })
      expect(post.action).toBe('send')
      turnCount += 1
    }
    expect(handoffMessage('max_turns', 'he')).toBe('מישהו מהצוות ימשיך איתך ויחזור אליך בהקדם.')
    expect(turnCount).toBe(5)
  })

  it('prompt forbids filler interrogation and missing-field checklists', () => {
    expect(QUALIFY_SYSTEM_PROMPT).toContain('מה הלקוח מנסה להשיג עכשיו')
    expect(QUALIFY_SYSTEM_PROMPT).toContain('מבין שזה')
    expect(QUALIFY_SYSTEM_PROMPT).not.toMatch(/נוגעת ל: name/)
  })
})
