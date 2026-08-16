import { describe, expect, it } from 'vitest'
import { decidePostGeneration } from '@/lib/inbox/autoresponse/stateMachine'
import { detectHumanRequest, detectOptOut, nextRequiredFieldQuestion } from '@/lib/inbox/autoresponse/qualify'
import { QUALIFY_SYSTEM_PROMPT, buildQualifyUser } from '@/lib/inbox/autoresponse/qualifyPrompt'
import { validateAutoResponse } from '@/lib/inbox/autoresponse/validate'
import { decidePreGeneration } from '@/lib/inbox/autoresponse/stateMachine'

const NEED_INBOUND = 'יש לי עסק של איפור ואני צריכה עזרה בניהול הלקוחות שלי'

describe('qualify conversation quality (prompt + decision)', () => {
  it('does not hand off just because the customer stated a need', () => {
    expect(
      decidePostGeneration({
        hotSignal: false,
        uncertain: true,
        requiredComplete: true,
        turnCount: 0,
        maxTurns: 5,
      }),
    ).toEqual({ action: 'send' })
    expect(detectHumanRequest(NEED_INBOUND)).toBe(false)
  })

  it('does not instruct the model to collect every missing field in order', () => {
    expect(QUALIFY_SYSTEM_PROMPT).toContain('את לא מנהלת שאלון. את מנהלת שיחה.')
    expect(QUALIFY_SYSTEM_PROMPT).toContain('אל תנסי להשלים את השדות החסרים בזה אחר זה.')
    expect(QUALIFY_SYSTEM_PROMPT).toContain('העובדות שנאספו הן זיכרון פנימי בלבד, לא רשימת משימות.')
    expect(QUALIFY_SYSTEM_PROMPT).toContain('אל תשאלי על urgency/budget/location/callback רק משום שהם חסרים.')
    expect(QUALIFY_SYSTEM_PROMPT).toContain('אל תשאל/י שאלה רק כי שדה חסר.')
    expect(QUALIFY_SYSTEM_PROMPT).toContain('אל תשבחי כל הודעה')
    expect(QUALIFY_SYSTEM_PROMPT).toContain('אל תחזרי על דברי הלקוח כסיכום')
    expect(QUALIFY_SYSTEM_PROMPT).toContain('הגיבי לניסוח של הלקוח')
    expect(QUALIFY_SYSTEM_PROMPT).not.toMatch(/ברגע ששם וצורך/)
    expect(QUALIFY_SYSTEM_PROMPT).not.toContain('שקף/י בקצרה')
  })

  it('a natural follow-up can continue while multiple fields are still missing', () => {
    expect(QUALIFY_SYSTEM_PROMPT).toContain('לקוח יכול לנהל כמה תורות טבעיים בלי לאסוף שדה מובנה חדש.')
    expect(QUALIFY_SYSTEM_PROMPT).toContain('אם אפשר להעמיק במה שהלקוח אמר בלי לאסוף מידע חדש')
    expect(
      decidePostGeneration({
        hotSignal: false,
        uncertain: false,
        requiredComplete: false,
        turnCount: 2,
        maxTurns: 5,
      }),
    ).toEqual({ action: 'send' })
    const user = buildQualifyUser({
      transcript: [
        { direction: 'inbound', text: NEED_INBOUND },
        { direction: 'outbound', text: 'את עוקבת אחריהן היום באקסל או בוואטסאפ?' },
        { direction: 'inbound', text: 'הכל בוואטסאפ והודעות הולכות לאיבוד' },
      ],
      qualification: { need: 'ניהול לקוחות לעסק איפור' },
      collectFields: { required: ['name', 'need', 'urgency'], optional: ['budget', 'location', 'callback'] },
      guidance: null,
    })
    expect(user).toContain('name, urgency')
    expect(user).toContain('לא לסיים בגללו')
  })

  it('passes the full transcript so already-answered facts stay in context', () => {
    const user = buildQualifyUser({
      transcript: [
        { direction: 'inbound', text: NEED_INBOUND },
        { direction: 'outbound', text: 'את מנהלת את הלקוחות היום באקסל או בוואטסאפ?' },
      ],
      qualification: { need: 'ניהול לקוחות לעסק איפור' },
      collectFields: { required: ['name', 'need', 'urgency'], optional: [] },
      guidance: null,
    })
    expect(user).toContain(NEED_INBOUND)
    expect(user).toContain('את מנהלת את הלקוחות היום באקסל או בוואטסאפ?')
    expect(user).toContain('need=ניהול לקוחות לעסק איפור')
    expect(user).toContain('לא להזכיר ללקוח')
  })

  it('one-question fallback copy still passes the send validator', () => {
    const q = nextRequiredFieldQuestion(['need'], 'he')
    expect((q.match(/\?/g) ?? []).length).toBe(1)
    expect(validateAutoResponse(q).ok).toBe(true)
    expect(q).not.toContain('הצורך המרכזי')
  })

  it('the canned transfer line is not a valid live reply (no question)', () => {
    const robotic = 'אני מעביר אותך לאחד מאנשי הצוות שלנו שיכול לעזור.'
    expect(validateAutoResponse(robotic).ok).toBe(false)
    expect(validateAutoResponse(robotic)).toMatchObject({ violation: 'no_question' })
  })

  it('a natural one-question reply to an explicit need is sendable', () => {
    const reply = 'ניהול לקוחות באיפור זה בדיוק מסוג העומס שמתפזר. את מנהלת את זה היום באקסל או בעיקר בוואטסאפ?'
    expect(validateAutoResponse(reply).ok).toBe(true)
    expect((reply.match(/\?/g) ?? []).length).toBe(1)
  })
})

describe('existing safety / handoff gates stay intact', () => {
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
    turnCount: 1,
    maxTurns: 5,
  }

  it('human takeover still stops before generation', () => {
    expect(decidePreGeneration({ ...pre, humanTookOver: true })).toMatchObject({
      action: 'stop',
      reason: 'human_active',
    })
  })

  it('opt-out still stops before generation', () => {
    expect(detectOptOut('תפסיקו לשלוח לי')).toBe(true)
    expect(decidePreGeneration({ ...pre, optOut: true })).toMatchObject({ action: 'stop', reason: 'opt_out' })
  })

  it('explicit ask for a human is still a hot-signal handoff', () => {
    expect(detectHumanRequest('אני רוצה לדבר עם נציג')).toBe(true)
    expect(
      decidePostGeneration({
        hotSignal: true,
        uncertain: false,
        requiredComplete: false,
        turnCount: 0,
        maxTurns: 5,
      }),
    ).toEqual({ action: 'escalate', reason: 'hot_signal' })
  })

  it('daily cap, quiet hours, and max turns still skip or hand off', () => {
    expect(decidePreGeneration({ ...pre, sentTodayForAgency: 200, dailyCap: 200 })).toEqual({
      action: 'skip',
      reason: 'daily_cap',
    })
    expect(decidePreGeneration({ ...pre, withinQuietHours: true })).toEqual({
      action: 'skip',
      reason: 'quiet_hours',
    })
    expect(
      decidePostGeneration({
        hotSignal: false,
        uncertain: false,
        requiredComplete: false,
        turnCount: 4,
        maxTurns: 5,
      }),
    ).toEqual({ action: 'escalate', reason: 'max_turns' })
  })
})
