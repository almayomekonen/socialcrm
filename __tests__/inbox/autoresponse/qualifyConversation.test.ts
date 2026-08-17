import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { decidePostGeneration, decidePreGeneration } from '@/lib/inbox/autoresponse/stateMachine'
import {
  cognitionFromUnderstanding,
  detectHumanRequest,
  detectOptOut,
  deterministicQualifyFallback,
  inferFallbackObjective,
  resolveFallbackObjective,
} from '@/lib/inbox/autoresponse/qualify'
import { mergeCognition } from '@/lib/inbox/autoresponse/qualification'
import { QUALIFY_SYSTEM_PROMPT, buildQualifyUser, inboundStatesBusinessNeed } from '@/lib/inbox/autoresponse/qualifyPrompt'
import { validateAutoResponse } from '@/lib/inbox/autoresponse/validate'
import { decideConversationPolicy } from '@/lib/inbox/autoresponse/runtimeQualification'

const NEED_INBOUND = 'יש לי עסק של איפור ואני צריכה עזרה בניהול הלקוחות שלי'
const PAIN_INBOUND = 'אני שוכחת לחזור להודעות'
const IMPACT_INBOUND = 'לפעמים הלקוחה הולכת למישהי אחרת'
const WORKFLOW_INBOUND = 'הכל באקסל'

const NAME_QUESTION_HE = 'איך לפנות אליך?'
const NAME_QUESTION_EN = 'What should I call you?'
const PAIN_FALLBACK_HE = 'מה הכי מפריע לך בזה עכשיו?'
const IMPACT_FALLBACK_HE = 'מה קורה בדרך כלל כשזה לא מסתדר?'
const OUTCOME_FALLBACK_HE = 'מה היית רוצה שיהיה אחרת?'
const NEED_DISCOVERY_HE = 'איך אפשר לעזור?'

const CRM_FIELD_QUESTIONS = [
  NAME_QUESTION_HE,
  NAME_QUESTION_EN,
  'זה דחוף לך לימים הקרובים?',
  'יש טווח תקציב שנוח לך?',
  'מאיפה בארץ?',
  'מתי נוח לחזור אליך?',
]

function userPayload(over: Partial<Parameters<typeof buildQualifyUser>[0]> = {}) {
  return buildQualifyUser({
    transcript: [{ direction: 'inbound', text: NEED_INBOUND }],
    qualification: {},
    collectFields: { required: ['name', 'need', 'urgency'], optional: ['budget', 'location', 'callback'] },
    guidance: null,
    ...over,
  })
}

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
    expect(QUALIFY_SYSTEM_PROMPT).toContain('שדות מובנים הם זיכרון CRM, לא רשימת שאלות שמכתיבה את השאלה הבאה.')
    expect(QUALIFY_SYSTEM_PROMPT).toContain('אל תשאלי על urgency/budget/location/callback רק משום שהם חסרים.')
    expect(QUALIFY_SYSTEM_PROMPT).toContain('אל תשאל/י שאלה רק כי שדה חסר.')
    expect(QUALIFY_SYSTEM_PROMPT).toContain('אל תשבחי כל הודעה')
    expect(QUALIFY_SYSTEM_PROMPT).toContain('אל תחזרי על דברי הלקוח כסיכום')
    expect(QUALIFY_SYSTEM_PROMPT).toContain('הגיבי לניסוח של הלקוח')
    expect(QUALIFY_SYSTEM_PROMPT).not.toMatch(/ברגע ששם וצורך/)
    expect(QUALIFY_SYSTEM_PROMPT).not.toContain('שקף/י בקצרה')
  })

  it('need known + name missing → prompt does not ask name and does not list missing CRM fields', () => {
    expect(inboundStatesBusinessNeed(NEED_INBOUND)).toBe(true)
    const user = userPayload({
      qualification: {},
      focusField: 'name',
      collectFields: { required: ['name', 'need', 'urgency'], optional: ['budget'] },
    })
    expect(user).toContain(NEED_INBOUND)
    expect(user).not.toMatch(/נוגעת ל: name/)
    expect(user).not.toContain('מידע פנימי שעוד חסר')
    expect(user).not.toContain('name חסר')
    expect(user).not.toMatch(/\bname, need\b/)
    expect(user).not.toMatch(/\bname, urgency\b/)
    expect(user).toContain('קודם כל הגיבי לזה')
    expect(user).toContain('אל תשאל/י לשם')
    const exploreNeed = 'ברור. מה הכי מפריע לך היום בניהול הלקוחות?'
    expect(validateAutoResponse(exploreNeed).ok).toBe(true)
    expect(exploreNeed).not.toMatch(/איך קוראים לך|אפשר לשאול איך קוראים|איך לפנות אליך/)
  })

  it('no need known → prompt does not instruct asking name', () => {
    const greeting = 'היי אשמח לקבל פרטים'
    expect(inboundStatesBusinessNeed(greeting)).toBe(false)
    const user = userPayload({
      transcript: [{ direction: 'inbound', text: greeting }],
      qualification: {},
      focusField: 'name',
    })
    expect(user).not.toMatch(/נוגעת ל: name/)
    expect(user).not.toContain('מידע פנימי שעוד חסר')
    expect(user).not.toContain('אל תשאל/י לשם ואל תשאל/י "מה הצורך שלך"')
  })

  it('need already known → do not ask what the need is', () => {
    expect(QUALIFY_SYSTEM_PROMPT).toContain('need ברגע שתואר צורך — ואז אל תשאל/י שוב מה הצורך.')
    const user = userPayload({
      transcript: [
        { direction: 'inbound', text: NEED_INBOUND },
        { direction: 'outbound', text: 'מה הכי מפריע לך היום בניהול הלקוחות?' },
        { direction: 'inbound', text: 'ההודעות הולכות לאיבוד' },
      ],
      qualification: { need: 'ניהול לקוחות לעסק איפור' },
      focusField: 'name',
    })
    expect(user).toContain('need=ניהול לקוחות לעסק איפור')
    expect(user).toContain('אל תשאל/י "מה הצורך שלך" אם הצורך כבר נאמר')
    expect(user).not.toMatch(/נוגעת ל: name/)
    expect(user).not.toMatch(/נוגעת ל: need/)
    expect(user).not.toContain('מידע פנימי שעוד חסר')
  })

  it('several turns can happen without collecting the name', () => {
    expect(QUALIFY_SYSTEM_PROMPT).toContain('לקוח יכול לנהל כמה תורות טבעיים בלי לאסוף שדה מובנה חדש.')
    expect(QUALIFY_SYSTEM_PROMPT).toContain('שם הוא אופציונלי בשיחה')
    expect(
      decidePostGeneration({
        hotSignal: false,
        uncertain: false,
        requiredComplete: false,
        turnCount: 3,
        maxTurns: 5,
      }),
    ).toEqual({ action: 'send' })
    const user = userPayload({
      transcript: [
        { direction: 'inbound', text: NEED_INBOUND },
        { direction: 'outbound', text: 'מה הכי מפריע לך היום בניהול הלקוחות?' },
        { direction: 'inbound', text: 'הכל בוואטסאפ והודעות הולכות לאיבוד' },
        { direction: 'outbound', text: 'את עוקבת אחריהן איכשהו, או שזה בעיקר בראש?' },
        { direction: 'inbound', text: 'בראש, ואני שוכחת לחזור' },
      ],
      qualification: { need: 'ניהול לקוחות לעסק איפור' },
    })
    expect(user).not.toContain('name, urgency')
    expect(user).not.toContain('name=')
    expect(user).not.toMatch(/נוגעת ל: name/)
    expect(user).toContain('אל תשאל/י לשם')
  })

  it('a natural follow-up can continue while multiple fields are still missing', () => {
    expect(QUALIFY_SYSTEM_PROMPT).toContain('לקוח יכול לנהל כמה תורות טבעיים בלי לאסוף שדה מובנה חדש.')
    expect(QUALIFY_SYSTEM_PROMPT).toContain('מה הלקוח מנסה להשיג עכשיו')
    expect(
      decidePostGeneration({
        hotSignal: false,
        uncertain: false,
        requiredComplete: false,
        turnCount: 2,
        maxTurns: 5,
      }),
    ).toEqual({ action: 'send' })
    const user = userPayload({
      transcript: [
        { direction: 'inbound', text: NEED_INBOUND },
        { direction: 'outbound', text: 'את עוקבת אחריהן היום באקסל או בוואטסאפ?' },
        { direction: 'inbound', text: 'הכל בוואטסאפ והודעות הולכות לאיבוד' },
      ],
      qualification: { need: 'ניהול לקוחות לעסק איפור' },
    })
    expect(user).not.toContain('name, urgency')
    expect(user).not.toContain('מידע פנימי שעוד חסר')
    expect(user).toContain('לא לקבוע לפי זה את השאלה הבאה')
  })

  it('passes the full transcript so already-answered facts stay in context', () => {
    const user = userPayload({
      transcript: [
        { direction: 'inbound', text: NEED_INBOUND },
        { direction: 'outbound', text: 'את מנהלת את הלקוחות היום באקסל או בוואטסאפ?' },
      ],
      qualification: { need: 'ניהול לקוחות לעסק איפור' },
    })
    expect(user).toContain(NEED_INBOUND)
    expect(user).toContain('את מנהלת את הלקוחות היום באקסל או בוואטסאפ?')
    expect(user).toContain('need=ניהול לקוחות לעסק איפור')
    expect(user).toContain('לא להזכיר ללקוח')
  })

  it('need stated + AI generation succeeds → the valid AI reply is kept', () => {
    const aiReply = 'ברור. מה הכי קשה לך היום במעקב אחרי הלקוחות?'
    expect(validateAutoResponse(aiReply).ok).toBe(true)
    expect(aiReply).not.toBe(NAME_QUESTION_HE)
    expect(aiReply).not.toBe(
      deterministicQualifyFallback({
        qualification: { need: 'עזרה בניהול לקוחות עסק איפור' },
        lastInboundText: NEED_INBOUND,
        lang: 'he',
      }),
    )
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

describe('strategy-aware fallback (not missing CRM fields)', () => {
  it('need known + name missing + validation fail → fallback deepens the need, not name', () => {
    const fallback = deterministicQualifyFallback({
      qualification: {},
      lastInboundText: NEED_INBOUND,
      lang: 'he',
    })
    expect(inferFallbackObjective({ qualification: {}, lastInboundText: NEED_INBOUND })).toBe('understand_pain')
    expect(validateAutoResponse(fallback).ok).toBe(true)
    expect(fallback).toBe(PAIN_FALLBACK_HE)
    expect(fallback).not.toBe(NAME_QUESTION_HE)
    expect(CRM_FIELD_QUESTIONS).not.toContain(fallback)
  })

  it('need already extracted + name missing → fallback deepens the need', () => {
    const fallback = deterministicQualifyFallback({
      qualification: { need: 'עזרה בניהול לקוחות עסק איפור' },
      lastInboundText: NEED_INBOUND,
      lang: 'he',
    })
    expect(validateAutoResponse(fallback).ok).toBe(true)
    expect(fallback).toBe(PAIN_FALLBACK_HE)
    expect(fallback).not.toBe(NAME_QUESTION_HE)
  })

  it('pain known → fallback asks about impact, not name/urgency', () => {
    const fallback = deterministicQualifyFallback({
      qualification: { need: 'ניהול לקוחות לעסק איפור' },
      lastInboundText: PAIN_INBOUND,
      transcript: [
        { direction: 'inbound', text: NEED_INBOUND },
        { direction: 'inbound', text: PAIN_INBOUND },
      ],
      lang: 'he',
    })
    expect(
      inferFallbackObjective({
        qualification: { need: 'ניהול לקוחות לעסק איפור' },
        lastInboundText: PAIN_INBOUND,
        transcript: [
          { direction: 'inbound', text: NEED_INBOUND },
          { direction: 'inbound', text: PAIN_INBOUND },
        ],
      }),
    ).toBe('understand_impact')
    expect(validateAutoResponse(fallback).ok).toBe(true)
    expect(fallback).toBe(IMPACT_FALLBACK_HE)
    expect(fallback).not.toBe(NAME_QUESTION_HE)
    expect(fallback).not.toMatch(/דחוף|תקציב|urgency|budget/)
  })

  it('workflow known → fallback asks about desired outcome, not missing CRM fields', () => {
    const transcript = [
      { direction: 'inbound' as const, text: NEED_INBOUND },
      { direction: 'inbound' as const, text: PAIN_INBOUND },
      { direction: 'inbound' as const, text: IMPACT_INBOUND },
      { direction: 'inbound' as const, text: WORKFLOW_INBOUND },
    ]
    const fallback = deterministicQualifyFallback({
      qualification: { need: 'ניהול לקוחות לעסק איפור' },
      lastInboundText: WORKFLOW_INBOUND,
      transcript,
      lang: 'he',
    })
    expect(
      inferFallbackObjective({
        qualification: { need: 'ניהול לקוחות לעסק איפור' },
        lastInboundText: WORKFLOW_INBOUND,
        transcript,
      }),
    ).toBe('understand_outcome')
    expect(validateAutoResponse(fallback).ok).toBe(true)
    expect(fallback).toBe(OUTCOME_FALLBACK_HE)
    expect(CRM_FIELD_QUESTIONS).not.toContain(fallback)
  })

  it('no need known → natural need-discovery fallback is allowed', () => {
    const fallback = deterministicQualifyFallback({
      qualification: {},
      lastInboundText: 'היי אשמח לקבל פרטים',
      lang: 'he',
    })
    expect(inferFallbackObjective({ qualification: {}, lastInboundText: 'היי אשמח לקבל פרטים' })).toBe('discover_need')
    expect(validateAutoResponse(fallback).ok).toBe(true)
    expect(fallback).toBe(NEED_DISCOVERY_HE)
    expect(fallback).not.toBe(NAME_QUESTION_HE)
  })

  it('every fallback objective still passes the send validator', () => {
    for (const lastInboundText of [NEED_INBOUND, PAIN_INBOUND, 'היי']) {
      const he = deterministicQualifyFallback({ qualification: { need: lastInboundText === 'היי' ? undefined : 'x' }, lastInboundText, lang: 'he' })
      const en = deterministicQualifyFallback({ qualification: { need: lastInboundText === 'היי' ? undefined : 'x' }, lastInboundText, lang: 'en' })
      expect((he.match(/\?/g) ?? []).length).toBe(1)
      expect((en.match(/\?/g) ?? []).length).toBe(1)
      expect(validateAutoResponse(he).ok).toBe(true)
      expect(validateAutoResponse(en).ok).toBe(true)
    }
  })
})

describe('RQ must not control the IRE question', () => {
  it('qualifyWorker no longer calls selectNextGap, decideConversationPolicy, or focusField', () => {
    const src = readFileSync(resolve(__dirname, '../../../lib/inbox/autoresponse/qualifyWorker.ts'), 'utf8')
    expect(src).not.toMatch(/\bselectNextGap\b/)
    expect(src).not.toMatch(/\bdecideConversationPolicy\b/)
    expect(src).not.toMatch(/\bfocusField\b/)
    expect(src).not.toMatch(/\brqFocusField\b/)
    expect(src).not.toContain('policy=')
    expect(src).not.toContain('gap=')
  })

  it('RQ gap=name cannot appear as a conversational instruction in the prompt', () => {
    const user = userPayload({
      qualification: {},
      focusField: 'name',
      runtimeCognition: 'Still unknown / unresolved: name',
    })
    expect(user).not.toMatch(/נוגעת ל: name/)
    expect(user).not.toContain('Still unknown / unresolved: name')
    expect(user).not.toContain('מידע פנימי שעוד חסר')
  })

  it('RQ decideConversationPolicy ASK gap=name does not change a valid IRE reply', () => {
    const rq = decideConversationPolicy({
      qualification: {},
      required: ['name', 'need'],
      turnCount: 0,
      maxTurns: 5,
    })
    expect(rq).toEqual({ decision: 'ASK', gap: 'name', reason: "collecting required field 'name'" })
    const aiReply = 'ברור. מה הכי קשה לך היום במעקב אחרי הלקוחות?'
    expect(validateAutoResponse(aiReply).ok).toBe(true)
    expect(aiReply).not.toBe(NAME_QUESTION_HE)
    const fallback = deterministicQualifyFallback({
      qualification: { need: 'עזרה בניהול לקוחות' },
      lastInboundText: NEED_INBOUND,
      lang: 'he',
    })
    expect(fallback).not.toBe(NAME_QUESTION_HE)
    expect(fallback).toBe(PAIN_FALLBACK_HE)
  })
})

describe('Phase B conversation brain (objective + cognition)', () => {
  const makeupNeed = { need: 'עזרה בניהול לקוחות עסק איפור' }
  const e2ePain = 'אני מקבלת הרבה הודעות ולפעמים שוכחת לחזור'
  const moneyImpact = 'אני מפספסת לקוחות וזה כבר עולה לי בכסף'
  const outcomeLine = 'הייתי רוצה שכל ההודעות יהיו במקום אחד'

  it('need known + pain unknown → objective=understand_pain', () => {
    expect(inferFallbackObjective({ qualification: makeupNeed, lastInboundText: NEED_INBOUND })).toBe('understand_pain')
  })

  it('pain known + impact unknown → objective=understand_impact', () => {
    expect(
      inferFallbackObjective({
        qualification: { ...makeupNeed, cognition: { pain: 'שוכחת לחזור להודעות' } },
        lastInboundText: e2ePain,
        transcript: [
          { direction: 'inbound', text: NEED_INBOUND },
          { direction: 'inbound', text: e2ePain },
        ],
      }),
    ).toBe('understand_impact')
  })

  it('pain known + workflow known + impact unknown → still understand_impact', () => {
    expect(
      inferFallbackObjective({
        qualification: {
          ...makeupNeed,
          cognition: { pain: 'שוכחת לחזור', currentWorkflow: 'בעיקר דרך הוואטסאפ' },
        },
        lastInboundText: 'בעיקר דרך הוואטסאפ, אין לי משהו מסודר',
        transcript: [
          { direction: 'inbound', text: NEED_INBOUND },
          { direction: 'inbound', text: e2ePain },
          { direction: 'inbound', text: 'בעיקר דרך הוואטסאפ, אין לי משהו מסודר' },
        ],
      }),
    ).toBe('understand_impact')
  })

  it('impact known + outcome unknown → understand_outcome', () => {
    expect(
      inferFallbackObjective({
        qualification: { ...makeupNeed, cognition: { pain: 'שוכחת', impact: 'לקוחה הולכת' } },
        lastInboundText: IMPACT_INBOUND,
      }),
    ).toBe('understand_outcome')
  })

  it('impact + outcome known → advance is allowed', () => {
    expect(
      inferFallbackObjective({
        qualification: {
          ...makeupNeed,
          cognition: { pain: 'שוכחת', impact: 'עולה בכסף', desiredOutcome: 'מערכת מסודרת' },
        },
        lastInboundText: outcomeLine,
      }),
    ).toBe('advance')
    const fallback = deterministicQualifyFallback({
      qualification: {
        ...makeupNeed,
        cognition: { pain: 'שוכחת', impact: 'עולה בכסף', desiredOutcome: 'מערכת מסודרת' },
      },
      lastInboundText: outcomeLine,
      lang: 'he',
    })
    expect(validateAutoResponse(fallback).ok).toBe(true)
    expect(CRM_FIELD_QUESTIONS).not.toContain(fallback)
  })

  it('customer already states pain + impact → do not ask another pain question', () => {
    const fallback = deterministicQualifyFallback({
      qualification: makeupNeed,
      lastInboundText: moneyImpact,
      lang: 'he',
    })
    expect(inferFallbackObjective({ qualification: makeupNeed, lastInboundText: moneyImpact })).toBe('understand_outcome')
    expect(fallback).not.toBe(PAIN_FALLBACK_HE)
    expect(fallback).not.toMatch(/מה הכי מפריע/)
  })

  it('customer already states pain + financial impact → skip to outcome/advance', () => {
    const objective = inferFallbackObjective({ qualification: makeupNeed, lastInboundText: moneyImpact })
    expect(['understand_outcome', 'advance']).toContain(objective)
    expect(objective).not.toBe('understand_pain')
  })

  it('production E2E shape: שוכחת לחזור → understand_impact, not team/tracking/name', () => {
    const transcript = [
      { direction: 'inbound' as const, text: NEED_INBOUND },
      { direction: 'inbound' as const, text: e2ePain },
    ]
    const objective = inferFallbackObjective({
      qualification: makeupNeed,
      lastInboundText: e2ePain,
      transcript,
    })
    expect(objective).toBe('understand_impact')
    const fallback = deterministicQualifyFallback({
      qualification: makeupNeed,
      lastInboundText: e2ePain,
      transcript,
      lang: 'he',
    })
    expect(fallback).toBe(IMPACT_FALLBACK_HE)
    expect(fallback).not.toMatch(/צוות|למי ענית|איך את מסמנת|איך לפנות|דחוף|תקציב/)
    const user = userPayload({
      transcript,
      qualification: { ...makeupNeed, cognition: { lastObjective: 'understand_pain', pain: 'שוכחת לחזור להודעות' } },
    })
    expect(user).toContain('pain=שוכחת לחזור להודעות')
    expect(user).toContain('impact=(לא ידוע)')
    expect(user).toContain('יעד קודם: understand_pain')
    expect(user).toContain('impact לפני עוד תהליך')
    expect(user).not.toContain('מידע פנימי שעוד חסר')
    expect(user).not.toMatch(/נוגעת ל:/)
  })

  it('missing name never forces a name question', () => {
    const fallback = deterministicQualifyFallback({
      qualification: makeupNeed,
      lastInboundText: NEED_INBOUND,
      lang: 'he',
    })
    expect(fallback).not.toBe(NAME_QUESTION_HE)
  })

  it('missing CRM fields never appear as conversational instructions', () => {
    const user = userPayload({
      qualification: { cognition: { lastObjective: 'understand_pain' } },
      focusField: 'name',
    })
    expect(user).not.toContain('מידע פנימי שעוד חסר')
    expect(user).not.toMatch(/נוגעת ל: name/)
    expect(user).not.toContain('missing name')
    expect(user).toContain('כבר מובן')
  })

  it('valid AI reply is sent unchanged — fallback is not a rewrite', () => {
    const aiReply = 'ברור. מה קורה בדרך כלל כשאת לא מספיקה לחזור?'
    expect(validateAutoResponse(aiReply).ok).toBe(true)
    expect(aiReply).not.toBe(
      deterministicQualifyFallback({
        qualification: makeupNeed,
        lastInboundText: e2ePain,
        objective: 'understand_impact',
        lang: 'he',
      }),
    )
  })

  it('fallback prefers this-turn model objective over CRM gaps', () => {
    expect(
      resolveFallbackObjective({
        qualification: { ...makeupNeed, cognition: { lastObjective: 'understand_pain' } },
        lastInboundText: NEED_INBOUND,
        objective: 'understand_impact',
      }),
    ).toBe('understand_impact')
    const fallback = deterministicQualifyFallback({
      qualification: makeupNeed,
      lastInboundText: NEED_INBOUND,
      objective: 'understand_impact',
      lang: 'he',
    })
    expect(fallback).toBe(IMPACT_FALLBACK_HE)
    expect(fallback).not.toBe(NAME_QUESTION_HE)
  })

  it('cognitionFromUnderstanding persists only grounded facts', () => {
    const grounded = cognitionFromUnderstanding(
      { pain: 'שוכחת לחזור', impact: 'הומצא', currentWorkflow: null, desiredOutcome: null },
      'understand_impact',
      `${NEED_INBOUND}\n${e2ePain}`,
    )
    expect(grounded.pain).toBe('שוכחת לחזור')
    expect(grounded.impact).toBeUndefined()
    expect(grounded.lastObjective).toBe('understand_impact')
    const invented = cognitionFromUnderstanding(
      { pain: 'כאב מומצא', impact: null, currentWorkflow: null, desiredOutcome: null },
      'understand_pain',
      NEED_INBOUND,
    )
    expect(invented.pain).toBeUndefined()
  })

  it('cognition fill-empty does not overwrite known pain', () => {
    expect(mergeCognition({ pain: 'שוכחת לחזור' }, { pain: 'גרסה חדשה', lastObjective: 'understand_impact' })).toEqual({
      pain: 'שוכחת לחזור',
      lastObjective: 'understand_impact',
    })
  })

  it('QualifySchema still extracts the CRM fields', () => {
    const src = readFileSync(resolve(__dirname, '../../../lib/inbox/autoresponse/qualify.ts'), 'utf8')
    expect(src).toContain('name: z.string().nullable()')
    expect(src).toContain('need: z.string().nullable()')
    expect(src).toContain('urgency: z.string().nullable()')
    expect(src).toContain('budget: z.string().nullable()')
    expect(src).toContain('location: z.string().nullable()')
    expect(src).toContain('callback: z.string().nullable()')
    expect(src).toContain("objective: z")
    expect(src).toContain('understanding: z')
    expect(src).not.toContain('conversationStage')
    expect(src).not.toContain('buyingSignal')
  })

  it('maxTurns handoff threshold is no longer a blind escalate', () => {
    expect(
      decidePostGeneration({
        hotSignal: false,
        uncertain: false,
        requiredComplete: false,
        turnCount: 4,
        maxTurns: 5,
        salesMove: 'DEEPEN',
      }),
    ).toEqual({ action: 'send' })
    expect(
      decidePostGeneration({
        hotSignal: false,
        uncertain: false,
        requiredComplete: false,
        turnCount: 3,
        maxTurns: 5,
      }),
    ).toEqual({ action: 'send' })
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

  it('daily cap and quiet hours still skip; soft maxTurns does not hand off', () => {
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
        salesMove: 'DEEPEN',
      }),
    ).toEqual({ action: 'send' })
    expect(decidePreGeneration({ ...pre, turnCount: 7, maxTurns: 5 })).toEqual({
      action: 'skip',
      reason: 'max_turns',
    })
  })
})
