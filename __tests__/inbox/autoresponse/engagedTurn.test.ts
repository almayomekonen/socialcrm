import { describe, expect, it } from 'vitest'
import {
  decideEngagedTurn,
  isClosingAcknowledgement,
  isConversationDeferral,
  saysNothing,
} from '@/lib/inbox/autoresponse/engagedTurn'
import { shouldInvokeSalesAi } from '@/lib/inbox/autoresponse/gptEligibility'
import { classifySalesTurnFromTranscript } from '@/lib/inbox/autoresponse/salesIntent'
import { decideConversationControl } from '@/lib/inbox/autoresponse/conversationControl'

/**
 * THE PRODUCT RULE, exercised as whole conversations rather than isolated
 * utterances — because the rule is precisely that an utterance does not mean
 * anything on its own.
 *
 * Before this change, ten direct answers to the agent's own questions were run
 * through the pipeline for a garage, a clinic and SocialCRM. NINE were dropped.
 * These are those conversations, played turn by turn.
 */

type Turn = { direction: 'inbound' | 'outbound'; text: string }

/**
 * Replay a scripted conversation through the real pipeline — classifier,
 * Conversation Control, then the eligibility gate — in the same order
 * qualifyWorker runs them, and report what happened to each customer turn.
 */
function replay(script: Turn[], opts: { agentHasSpoken?: boolean } = {}) {
  const results: Array<{ text: string; answered: boolean; reason: string }> = []
  const history: Turn[] = []
  let agentSpoke = opts.agentHasSpoken ?? false
  let previousCustomerText: string | undefined

  for (const turn of script) {
    if (turn.direction === 'outbound') {
      history.push(turn)
      agentSpoke = true
      continue
    }
    const transcript = [...history, turn]
    const { salesMove } = classifySalesTurnFromTranscript(transcript)
    const previousOutbound = [...history].reverse().find((m) => m.direction === 'outbound')?.text
    const control = decideConversationControl({ salesMove, inboundText: turn.text, previousOutbound })

    if (control.action !== 'CONTINUE' && control.action !== 'ASK_QUESTION') {
      results.push({ text: turn.text, answered: false, reason: `control_${control.action}` })
    } else {
      const eligibility = shouldInvokeSalesAi({
        inboundText: turn.text,
        previousOutbound,
        salesMove,
        controlAction: control.action,
        customerInboundCount: transcript.filter((m) => m.direction === 'inbound').length,
        previousCustomerText,
        agentHasSpoken: agentSpoke,
      })
      results.push({
        text: turn.text,
        answered: eligibility.decision === 'RUN_AI',
        reason: eligibility.reason,
      })
    }
    previousCustomerText = turn.text
    history.push(turn)
  }
  return results
}

const dropped = (rows: ReturnType<typeof replay>) => rows.filter((r) => !r.answered)

// ── A garage ────────────────────────────────────────────────────────────────
const GARAGE: Turn[] = [
  { direction: 'inbound', text: 'היי, יש לי בעיה ברכב' },
  { direction: 'outbound', text: 'היי, ברוך הבא למוסך אלון 👋 איזה רכב ומה התקלה?' },
  { direction: 'inbound', text: 'טויוטה 2020' },
  { direction: 'outbound', text: 'תודה. מה קורה עם הרכב?' },
  { direction: 'inbound', text: 'רעש בבלמים' },
  { direction: 'outbound', text: 'הבנתי. רק טיפול או גם בדיקה לפני טסט?' },
  { direction: 'inbound', text: 'רק טיפול' },
  { direction: 'outbound', text: 'מצוין. מתי נוח לך להביא?' },
  { direction: 'inbound', text: 'מחר' },
  { direction: 'outbound', text: 'אעביר לצוות שיחזרו אליך לתיאום. זה בסדר?' },
  { direction: 'inbound', text: 'כן' },
]

// ── A clinic ────────────────────────────────────────────────────────────────
const CLINIC: Turn[] = [
  { direction: 'inbound', text: 'שלום, רציתי לקבוע' },
  { direction: 'outbound', text: 'היי, ברוך הבא למרפאת שיניים חיוך 👋 מה הפנייה?' },
  { direction: 'inbound', text: 'כאב בשן' },
  { direction: 'outbound', text: 'מבין. ביטוח פרטי או קופה?' },
  { direction: 'inbound', text: 'מכבי' },
  { direction: 'outbound', text: 'תודה. מתי נוח לך?' },
  { direction: 'inbound', text: 'בבוקר' },
  { direction: 'outbound', text: 'ומה השם המלא?' },
  { direction: 'inbound', text: 'דנה לוי' },
]

// ── SocialCRM ───────────────────────────────────────────────────────────────
const SOCIALCRM: Turn[] = [
  { direction: 'inbound', text: 'היי מה קורה?' },
  { direction: 'outbound', text: 'היי, ברוך הבא ל SocialCRM 👋 מה רצית לדעת על המערכת?' },
  { direction: 'inbound', text: 'היי אשמח לקבל פרטים על המערכת שלכם' },
  { direction: 'outbound', text: 'בשמחה. מאיפה מגיעים אליך הלידים היום?' },
  { direction: 'inbound', text: 'פייסבוק ואינסטגרם' },
  { direction: 'outbound', text: 'וכמה בערך בחודש?' },
  { direction: 'inbound', text: 'בערך 200' },
  { direction: 'outbound', text: 'אתם צוות או שאתה לבד על זה?' },
  { direction: 'inbound', text: 'לבד' },
]

describe('a whole conversation, not a sequence of isolated utterances', () => {
  it.each([
    ['garage', GARAGE],
    ['clinic', CLINIC],
    ['socialcrm', SOCIALCRM],
  ])('%s — every customer turn is answered', (_name, script) => {
    const rows = replay(script)
    expect(
      dropped(rows).map((r) => `"${r.text}" → ${r.reason}`),
      'the agent asked a question and ignored the reply',
    ).toEqual([])
  })

  it('the answers carrying the real information are the short ones', () => {
    // Every one of these was dropped as NO_MEANINGFUL_INTENT before the change.
    const rows = replay(GARAGE)
    const byText = new Map(rows.map((r) => [r.text, r]))
    for (const text of ['טויוטה 2020', 'רק טיפול', 'מחר', 'כן']) {
      expect(byText.get(text)?.answered, `dropped: ${text}`).toBe(true)
    }
  })
})

describe('corrections are ordinary turns, not special cases', () => {
  it('a customer who corrects themselves is answered', () => {
    const rows = replay([
      { direction: 'inbound', text: 'היי' },
      { direction: 'outbound', text: 'היי, ברוך הבא למוסך אלון 👋 איזה רכב?' },
      { direction: 'inbound', text: 'מאזדה 3 משנת 2018' },
      { direction: 'outbound', text: 'תודה. מה התקלה?' },
      { direction: 'inbound', text: 'סליחה, זה לא 2018 אלא 2019' },
    ])
    expect(dropped(rows)).toEqual([])
  })

  it('a bare year as a correction still lands', () => {
    const rows = replay([
      { direction: 'inbound', text: 'היי' },
      { direction: 'outbound', text: 'היי 👋 איזה רכב ומאיזו שנה?' },
      { direction: 'inbound', text: 'מאזדה 2018' },
      { direction: 'outbound', text: 'קיבלתי, מאזדה 2018. מה התקלה?' },
      { direction: 'inbound', text: '2019' },
    ])
    expect(dropped(rows)).toEqual([])
  })
})

describe('rapid messages — several inbounds before the agent answers', () => {
  it('a burst is answered, not treated as noise', () => {
    const rows = replay([
      { direction: 'inbound', text: 'היי' },
      { direction: 'outbound', text: 'היי, ברוך הבא למוסך אלון 👋 איזה רכב ומה התקלה?' },
      { direction: 'inbound', text: 'טויוטה' },
      { direction: 'inbound', text: '2020' },
      { direction: 'inbound', text: 'רעש בבלמים' },
    ])
    expect(dropped(rows)).toEqual([])
  })

  it('but the identical message twice adds nothing the second time', () => {
    // With no question open — a verbatim repeat is the customer double-tapping.
    const d = decideEngagedTurn({
      agentAwaitingAnswer: false,
      inboundText: 'שלחתי לכם מייל',
      previousCustomerText: 'שלחתי לכם מייל',
    })
    expect(d).toEqual({ answer: false, reason: 'NO_NEW_CONTENT' })
  })

  it('the same word answering two different questions is NOT a repeat', () => {
    // "כן" to "רק טיפול?" and "כן" to "מחר בבוקר?" are two different answers.
    const d = decideEngagedTurn({
      agentAwaitingAnswer: true,
      inboundText: 'כן',
      previousCustomerText: 'כן',
    })
    expect(d.answer).toBe(true)
  })
})

describe('silence still has to be earned — the short list of reasons', () => {
  it('nothing was said', () => {
    expect(decideEngagedTurn({ agentAwaitingAnswer: true, inboundText: '👍' })).toEqual({
      answer: false,
      reason: 'LOW_INFORMATION',
    })
  })

  it('…but a number is something, even with no letters in it', () => {
    expect(saysNothing('2019')).toBe(false)
    expect(saysNothing('👍')).toBe(true)
    expect(saysNothing('.')).toBe(true)
    expect(decideEngagedTurn({ agentAwaitingAnswer: true, inboundText: '2019' }).answer).toBe(true)
  })

  it('they asked us to hold on', () => {
    expect(decideEngagedTurn({ agentAwaitingAnswer: true, inboundText: 'רגע' }).reason).toBe('HOLD_ON')
  })

  it('a genuine closing acknowledgement, even with a question open', () => {
    const d = decideEngagedTurn({ agentAwaitingAnswer: true, inboundText: 'תודה רבה' })
    expect(d).toEqual({ answer: false, reason: 'CLOSING_ACKNOWLEDGEMENT' })
  })

  it('a bare "כן" with nothing outstanding to say yes to', () => {
    expect(decideEngagedTurn({ agentAwaitingAnswer: false, inboundText: 'כן' }).reason).toBe('SHORT_AFFIRMATIVE')
  })

  it('an unprompted deferral', () => {
    expect(decideEngagedTurn({ agentAwaitingAnswer: false, inboundText: 'אני אחשוב על זה' }).reason).toBe('DEFERRAL')
    expect(isConversationDeferral('אני אחשוב על זה')).toBe(true)
    expect(isConversationDeferral("i'll think about it")).toBe(true)
  })

  it('a bare greeting repeated into a conversation already under way', () => {
    expect(
      decideEngagedTurn({ agentAwaitingAnswer: false, inboundText: 'היי', isGreetingOnly: true }).reason,
    ).toBe('GREETING_REPEAT')
  })

  it('"מחר" is deliberately NOT a deferral — it is the answer to "when?"', () => {
    expect(isConversationDeferral('מחר')).toBe(false)
    expect(decideEngagedTurn({ agentAwaitingAnswer: true, inboundText: 'מחר' }).answer).toBe(true)
  })
})

describe('a question always outranks a silence rule', () => {
  it('a greeting that is also a question is a question', () => {
    // "היי אחי מה קורה?" reads as a repeated greeting to the greeting predicate.
    // Answering it is not optional.
    const d = decideEngagedTurn({
      agentAwaitingAnswer: false,
      inboundText: 'היי אחי מה קורה?',
      isGreetingOnly: true,
      containsRealQuestion: true,
    })
    expect(d).toEqual({ answer: true, reason: 'REAL_QUESTION' })
  })

  it('a question after a deferral phrase is still a question', () => {
    const d = decideEngagedTurn({
      agentAwaitingAnswer: false,
      inboundText: 'אני אחשוב על זה, כמה זה עולה?',
      containsRealQuestion: true,
    })
    expect(d.answer).toBe(true)
  })
})

describe('the opening gate is untouched — a stranger still has to earn a reply', () => {
  it('the same low-content message is silent before the agent has spoken', () => {
    const opening = shouldInvokeSalesAi({
      inboundText: 'יחרא',
      salesMove: 'DISCOVERY',
      controlAction: 'ASK_QUESTION',
      customerInboundCount: 2,
      previousCustomerText: 'היי',
      agentHasSpoken: false,
    })
    expect(opening.decision).toBe('WAIT')
    expect(opening.reason).toBe('NO_MEANINGFUL_INTENT')
  })

  it('NO_MEANINGFUL_INTENT is now an OPENING-path reason only', () => {
    // The invariant that makes the production signal readable: once the agent
    // owns a conversation, every silence has a specific named reason, so a
    // NO_MEANINGFUL_INTENT skip can no longer hide a dropped answer.
    const engagedReasons = new Set<string>()
    for (const text of ['יחרא', 'מחר', 'טויוטה 2020', 'תודה', 'כן', 'רגע', '👍', 'אני אחשוב על זה']) {
      for (const awaiting of [true, false]) {
        const r = shouldInvokeSalesAi({
          inboundText: text,
          previousOutbound: awaiting ? 'מה התקלה ברכב?' : 'המוסך פתוח א׳–ה׳ 8:00–17:00.',
          salesMove: 'DISCOVERY',
          controlAction: 'ASK_QUESTION',
          customerInboundCount: 3,
          agentHasSpoken: true,
        })
        engagedReasons.add(r.reason)
      }
    }
    expect([...engagedReasons]).not.toContain('NO_MEANINGFUL_INTENT')
  })
})

/**
 * Fixed Message is out of scope BY CONSTRUCTION, not by care.
 *
 * `replyMode === 'fixed'` forces `mode = 'acknowledge'`, and acknowledge mode
 * returns before `processQualifyJob` is ever called — so the conversation-context
 * gate is unreachable for a fixed reply, which stays the owner's own words sent
 * verbatim. Asserted here so that a future change routing fixed mode through the
 * qualify worker fails loudly rather than quietly handing it to a model.
 */
describe('Fixed Message never reaches this gate', () => {
  it('a fixed reply mode forces acknowledge mode', async () => {
    const { readFileSync } = await import('node:fs')
    const { join } = await import('node:path')
    const src = readFileSync(join(process.cwd(), 'lib/inbox/autoresponse/replyMode.ts'), 'utf8')
    const wiring = readFileSync(join(process.cwd(), 'actions/autoResponse/updateSettings.ts'), 'utf8')
    expect(src + wiring).toContain("replyMode === 'fixed'")
  })

  it('the qualify worker is entered only for mode=qualify', async () => {
    const { readFileSync } = await import('node:fs')
    const { join } = await import('node:path')
    const worker = readFileSync(join(process.cwd(), 'lib/inbox/autoresponse/worker.ts'), 'utf8')
    const branch = worker.indexOf("settings?.mode === 'qualify'")
    const fixedBranch = worker.indexOf("replyMode === 'fixed'")
    expect(branch).toBeGreaterThan(-1)
    expect(fixedBranch).toBeGreaterThan(branch)
  })

  it('nothing in the fixed path imports the engaged gate', async () => {
    const { readFileSync } = await import('node:fs')
    const { join } = await import('node:path')
    const fixed = readFileSync(join(process.cwd(), 'lib/inbox/autoresponse/renderFixedReply.ts'), 'utf8')
    expect(fixed).not.toContain('engagedTurn')
    expect(fixed).not.toContain('gptEligibility')
  })
})

describe('isClosingAcknowledgement separates a close from an answer', () => {
  it('closes on thanks and sign-offs', () => {
    for (const t of ['תודה', 'תודה רבה', 'thanks', 'ok thanks']) {
      expect(isClosingAcknowledgement(t), t).toBe(true)
    }
  })

  it('does not close on anything carrying an answer', () => {
    for (const t of ['טויוטה 2020', 'מחר', 'רק טיפול', 'מכבי', 'בערך 200', 'לבד']) {
      expect(isClosingAcknowledgement(t), t).toBe(false)
    }
  })
})
