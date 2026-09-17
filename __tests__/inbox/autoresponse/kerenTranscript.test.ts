import { describe, expect, it } from 'vitest'
import {
  COURTESY_KIND,
  courtesyLine,
  decideCourtesyClose,
  isCourtesyMessage,
  isGratitude,
} from '@/lib/inbox/autoresponse/courtesyClose'
import {
  decideConversationControl,
  isConfirmedHandoffOffer,
  outboundOffersHandoff,
} from '@/lib/inbox/autoresponse/conversationControl'
import { classifySalesMove } from '@/lib/inbox/autoresponse/salesIntent'
import { decidePostGeneration } from '@/lib/inbox/autoresponse/stateMachine'
import { buildQualifyUser } from '@/lib/inbox/autoresponse/qualifyPrompt'

/**
 * PRODUCTION TRANSCRIPT — Keren Mekonen, 11:55–11:59.
 *
 * Three defects, traced through the deployed code before anything was changed:
 *
 *   1. "תודה רבה" got silence.
 *   2. The answer "קרן מקונן / עסק למספרת כלבים" drew a repeated pitch and a
 *      second request for the same permission.
 *   3. THE TRANSFER NEVER HAPPENED. "כן אשמח במיידי!" classified as DISCOVERY,
 *      decidePostGeneration returned `send`, and the model wrote "אעביר את
 *      הפנייה לצוות" in free text with no escalation behind it.
 */

const OFFER_AND_ASK = 'אפשר להעביר את הפנייה לצוות כדי שימשיכו איתך. מה השם שלך ומה שם העסק?'
const REOFFER = 'למספרת כלבים, SocialCRM יכולה לרכז את הפניות במקום אחד. להעביר את הפנייה שלך לצוות שימשיך איתך?'
const CLAIMED_TRANSFER = 'בשמחה, אעביר את הפנייה לצוות ואציין שביקשת שיחזרו אלייך בהקדם.'

// ── 1. Gratitude ────────────────────────────────────────────────────────────

const facts = (over: Partial<Parameters<typeof decideCourtesyClose>[0]> = {}) => ({
  inboundText: 'תודה רבה',
  agentHasSpoken: true,
  humanTookOver: false,
  optOut: false,
  alreadySentCourtesy: false,
  ...over,
})

describe('thanks gets a warm reply, once', () => {
  it('the exact production message now gets a courtesy line', () => {
    expect(decideCourtesyClose(facts())).toEqual({ send: true })
  })

  it('covers the phrasings named in the brief', () => {
    for (const t of ['תודה', 'תודה רבה', 'מעריכה', 'מעריך', 'תודה לך', 'thanks', 'thank you', 'ty']) {
      expect(isGratitude(t), t).toBe(true)
      expect(decideCourtesyClose(facts({ inboundText: t })).send, t).toBe(true)
    }
  })

  it('the reply carries no question, no pitch, and nothing to answer', () => {
    for (const lang of ['he', 'en'] as const) {
      for (let convId = 0; convId < 6; convId++) {
        const line = courtesyLine(lang, convId)
        expect(line).not.toContain('?')
        expect(line.length).toBeLessThan(40)
        expect(line).not.toMatch(/SocialCRM|מערכת|להעביר|צוות/)
      }
    }
  })

  it('is deterministic, so a job retry cannot produce a second different line', () => {
    expect(courtesyLine('he', 6694)).toBe(courtesyLine('he', 6694))
  })

  it('NEVER twice — a second thanks is silent', () => {
    expect(decideCourtesyClose(facts({ alreadySentCourtesy: true }))).toEqual({
      send: false,
      reason: 'already_sent',
    })
  })

  it('the once-only guard is durable — it reads the transcript, not memory', () => {
    expect(isCourtesyMessage({ source: 'auto_response', kind: COURTESY_KIND })).toBe(true)
    expect(isCourtesyMessage(JSON.stringify({ kind: COURTESY_KIND }))).toBe(true)
    expect(isCourtesyMessage({ source: 'auto_response' })).toBe(false)
    expect(isCourtesyMessage(null)).toBe(false)
  })

  it('a human in the conversation does their own thanking', () => {
    expect(decideCourtesyClose(facts({ humanTookOver: true }))).toEqual({ send: false, reason: 'human_owns' })
  })

  it('opt-out outranks politeness', () => {
    expect(decideCourtesyClose(facts({ optOut: true }))).toEqual({ send: false, reason: 'opted_out' })
  })

  it('nothing to be thanked for if the agent never spoke', () => {
    expect(decideCourtesyClose(facts({ agentHasSpoken: false }))).toEqual({
      send: false,
      reason: 'agent_never_spoke',
    })
  })

  it('gratitude is NARROWER than acknowledgement — "אוקיי" still closes in silence', () => {
    for (const t of ['אוקיי', 'אוקי', 'סבבה', 'הבנתי', 'מעולה', 'ok', 'got it']) {
      expect(isGratitude(t), t).toBe(false)
      expect(decideCourtesyClose(facts({ inboundText: t })).send, t).toBe(false)
    }
  })

  it('thanks WITH a real question is not a close — it must reach the normal path', () => {
    for (const t of ['תודה, אבל כמה זה עולה?', 'תודה. אפשר לדבר עם נציג?']) {
      expect(isGratitude(t), t).toBe(false)
    }
  })

  it('control still routes a bare thanks to the silent close, which is where courtesy hooks in', () => {
    const move = classifySalesMove('תודה רבה')
    const control = decideConversationControl({
      salesMove: move,
      inboundText: 'תודה רבה',
      previousOutbound: CLAIMED_TRANSFER,
    })
    expect(control.action).toBe('CLOSE_CONVERSATION')
    expect('send' in control ? control.send : '').toBe('silence')
  })
})

// ── 3. The transfer that never happened ─────────────────────────────────────

describe('an offered handoff the customer accepts is a real handoff', () => {
  it('REGRESSION: "כן אשמח במיידי!" after an offer is now a confirmed handoff', () => {
    expect(isConfirmedHandoffOffer({ previousOutbound: REOFFER, inboundText: 'כן אשמח במיידי!' })).toBe(true)
  })

  it('documents the defect: nothing in the old path escalated on it', () => {
    const move = classifySalesMove('כן אשמח במיידי!', { previousOutbound: REOFFER })
    expect(move).not.toBe('HANDOFF_REQUEST')
    expect(
      decidePostGeneration({
        hotSignal: true,
        uncertain: false,
        requiredComplete: true,
        turnCount: 4,
        maxTurns: 5,
        salesMove: move,
      }).action,
      'the old path returned `send`, so the agent claimed a transfer that never ran',
    ).toBe('send')
  })

  it('recognises an offer only when it is actually asked', () => {
    expect(outboundOffersHandoff(REOFFER)).toBe(true)
    expect(outboundOffersHandoff(OFFER_AND_ASK)).toBe(true)
    // A statement that a transfer already happened is not an offer.
    expect(outboundOffersHandoff(CLAIMED_TRANSFER)).toBe(false)
    expect(outboundOffersHandoff('SocialCRM מרכזת לידים במקום אחד.')).toBe(false)
  })

  it('accepts the affirmations a customer actually uses', () => {
    for (const t of ['כן', 'כן אשמח', 'כן אשמח במיידי!', 'בטח', 'yes', 'sure', 'go ahead']) {
      expect(isConfirmedHandoffOffer({ previousOutbound: REOFFER, inboundText: t }), t).toBe(true)
    }
  })

  it('does NOT fire without an offer outstanding', () => {
    expect(isConfirmedHandoffOffer({ previousOutbound: 'SocialCRM מרכזת לידים.', inboundText: 'כן' })).toBe(false)
    expect(isConfirmedHandoffOffer({ previousOutbound: undefined, inboundText: 'כן' })).toBe(false)
  })

  it('does NOT fire on a decline or a dead end', () => {
    for (const t of ['לא', 'לא תודה', 'לא עכשיו']) {
      expect(isConfirmedHandoffOffer({ previousOutbound: REOFFER, inboundText: t }), t).toBe(false)
    }
  })
})

// ── 2. Continue from the answer ─────────────────────────────────────────────

describe('an answer advances the next step instead of restarting the pitch', () => {
  const promptFor = (over: Record<string, unknown> = {}) =>
    buildQualifyUser({
      transcript: [
        { direction: 'inbound', text: 'ואיך אפשר להתקדם עם זה?' },
        { direction: 'outbound', text: OFFER_AND_ASK },
        { direction: 'inbound', text: 'קרן מקונן\nעסק למספרת כלבים' },
      ],
      qualification: {},
      collectFields: { required: [], optional: [] },
      guidance: 'SocialCRM מרכזת לידים במקום אחד.',
      salesMove: 'PRODUCT_FIT',
      salesStrategy: 'product_fit',
      ...over,
    })

  it('tells the model the customer just answered, and forbids repeating itself', () => {
    const p = promptFor({ answeringOurRequest: true })
    expect(p).toContain('בדיוק ענה/תה לשאלה ששאלת')
    expect(p).toContain('אסור לחזור ולהסביר מה העסק עושה')
    expect(p).toContain('אסור לשאול שוב את אותה שאלה')
  })

  it('separates business TYPE from business NAME, and forbids inventing one', () => {
    const p = promptFor({ answeringOurRequest: true })
    expect(p).toContain('מספרת כלבים')
    expect(p).toContain('הוא לא שם העסק')
    expect(p).toContain('אל תמציא/י שם')
  })

  it('forbids asking for the same permission twice', () => {
    const p = promptFor({ answeringOurRequest: true, handoffAlreadyOffered: true })
    expect(p).toContain('אל תבקש/י את אותו אישור שוב')
  })

  it('says none of it on an ordinary turn', () => {
    const p = promptFor()
    expect(p).not.toContain('בדיוק ענה/תה לשאלה ששאלת')
    expect(p).not.toContain('אל תבקש/י את אותו אישור שוב')
  })

  it('the 11:57 turn really does offer a handoff, so the flag would have been set', () => {
    expect(outboundOffersHandoff(OFFER_AND_ASK)).toBe(true)
  })
})
