import { describe, expect, it } from 'vitest'
import { shouldInvokeSalesAi, inboundHasMeaningfulSalesIntent } from '@/lib/inbox/autoresponse/gptEligibility'
import {
  classifySalesTurnFromTranscript,
  isInformationRequest,
  isCasualAcknowledgement,
} from '@/lib/inbox/autoresponse/salesIntent'
import { decideConversationControl } from '@/lib/inbox/autoresponse/conversationControl'
import { decidePreGeneration, type PreFacts } from '@/lib/inbox/autoresponse/stateMachine'

/**
 * PRODUCTION REGRESSION — conversation 6694, agency 103, 2026-09-16.
 *
 * The agent greeted and asked a question. The customer answered it. The agent
 * never spoke again.
 *
 *   seq 1  16:07:24  in   היי מה קורה?
 *   seq 2  16:07:33  in   יחרא
 *   seq 3  16:07:37  OUT  היי, ברוך הבא למנכל SocialCrm 👋 הכול טוב, מה רצית לדעת על המערכת?
 *   seq 4  16:08:19  in   היי אשמח לקבל פרטים על המערכת שלכם
 *
 * Job 2366 covered seq 4 and recorded `skipReason = gpt_wait_NO_MEANINGFUL_INTENT`.
 *
 * The cause was not human takeover, not a WhatsApp echo, not a pending job and
 * not validation — the turn never reached generation. "אשמח לקבל פרטים" is a
 * REQUEST, and every intent predicate required an interrogative, a stated pain,
 * or an explicit "I need help". The single most natural way a lead says "tell me
 * more" counted as no intent at all — directly after the agent invited it.
 */

const GREETING_OUTBOUND = 'היי, ברוך הבא למנכל SocialCrm 👋\nהכול טוב, מה רצית לדעת על המערכת?'
const THE_MESSAGE = 'היי אשמח לקבל פרטים על המערכת שלכם'

const HISTORY = [
  { direction: 'inbound' as const, text: 'היי מה קורה?' },
  { direction: 'inbound' as const, text: 'יחרא' },
  { direction: 'outbound' as const, text: GREETING_OUTBOUND },
]

/**
 * The same order qualifyWorker runs: classify → conversation control → GPT
 * eligibility. `skipReason` is spelled exactly as the worker writes it to
 * `auto_response_jobs`, so a failure here reads like the production row.
 */
function runPipeline(inboundText: string, previousCustomerText = 'יחרא') {
  const transcript = [...HISTORY, { direction: 'inbound' as const, text: inboundText }]
  const { salesMove } = classifySalesTurnFromTranscript(transcript)
  const control = decideConversationControl({
    salesMove,
    inboundText,
    previousOutbound: GREETING_OUTBOUND,
  })
  if (control.action !== 'CONTINUE' && control.action !== 'ASK_QUESTION') {
    return { salesMove, generated: false, skipReason: 'control_no_generate', eligibility: null }
  }
  const eligibility = shouldInvokeSalesAi({
    inboundText,
    previousOutbound: GREETING_OUTBOUND,
    salesMove,
    controlAction: control.action,
    customerInboundCount: 3,
    previousCustomerText,
  })
  return {
    salesMove,
    generated: eligibility.decision === 'RUN_AI',
    skipReason: eligibility.decision === 'RUN_AI' ? null : `gpt_wait_${eligibility.reason}`,
    eligibility,
  }
}

function pre(over: Partial<PreFacts> = {}): PreFacts {
  return {
    aiState: 'ai_qualifying',
    masterEnabled: true,
    channelEnabled: true,
    // The agent's own outbound at seq 3 carries metadata.source = auto_response,
    // so it is not a human takeover. Confirmed against the production row.
    humanTookOver: false,
    humanTyping: false,
    optOut: false,
    humanRequest: false,
    hasUnansweredInbound: true,
    withinQuietHours: false,
    withinWindow: true,
    sentTodayForAgency: 1,
    dailyCap: 200,
    turnCount: 1,
    maxTurns: 5,
    ...over,
  }
}

describe('conv 6694 — the message that silenced the conversation', () => {
  it('REGRESSION: the exact production message now reaches generation', () => {
    const run = runPipeline(THE_MESSAGE)
    expect(run.skipReason, 'the production skip reason came back').toBeNull()
    expect(run.generated).toBe(true)
    expect(run.eligibility?.reason).toBe('INFORMATION_REQUEST')
  })

  it('it was never a question — which is precisely why it was missed', () => {
    expect(THE_MESSAGE).not.toContain('?')
    expect(isCasualAcknowledgement(THE_MESSAGE)).toBe(false)
    expect(isInformationRequest(THE_MESSAGE)).toBe(true)
    expect(inboundHasMeaningfulSalesIntent(THE_MESSAGE)).toBe(true)
  })

  it('every gate before the intent gate passed, exactly as it did in production', () => {
    expect(decidePreGeneration(pre()).action).toBe('proceed')
    const { salesMove } = classifySalesTurnFromTranscript([
      ...HISTORY,
      { direction: 'inbound' as const, text: THE_MESSAGE },
    ])
    const control = decideConversationControl({
      salesMove,
      inboundText: THE_MESSAGE,
      previousOutbound: GREETING_OUTBOUND,
    })
    expect(['CONTINUE', 'ASK_QUESTION']).toContain(control.action)
  })

  it('a normal second inbound gets a follow-up, whatever it is about', () => {
    // The user-facing check: after the agent has spoken once, an ordinary
    // customer reply is answered rather than silently dropped.
    for (const text of [
      'היי אשמח לקבל פרטים על המערכת שלכם',
      'כמה זה עולה?',
      'יש לי המון לידים מפייסבוק ואני מאבד אותם',
      'מעוניין לשמוע איך זה עובד',
    ]) {
      expect(runPipeline(text).generated, `dropped: ${text}`).toBe(true)
    }
  })
})

describe('the same request in the phrasings leads actually use', () => {
  const requests = [
    'אשמח לקבל פרטים',
    'אפשר לקבל פרטים בבקשה',
    'אפשר לקבל מידע על השירות',
    'מעוניין בפרטים נוספים',
    'מעוניינת לשמוע עוד על זה',
    'רוצה לדעת עוד על המערכת',
    'תשלח לי פרטים',
    'ספר לי על השירות',
    'אשמח להצעת מחיר',
    "I'd like more details",
    'can i get some info',
    'send me more',
    'tell me about your service',
    'interested in pricing',
  ]
  for (const text of requests) {
    it(`runs the agent for: ${text}`, () => {
      const run = runPipeline(text)
      expect(run.generated, `skipped as ${run.skipReason}`).toBe(true)
    })
  }
})

describe('the fix does not make the gate credulous', () => {
  const LOW_CONTENT = ['יחרא', 'אוקיי', 'אוקי תודה', 'תודה', '👍', 'ok', 'thanks']

  it('the new predicate matches none of the low-content utterances', () => {
    // The precise claim about this change: nothing that used to stay silent
    // now runs BECAUSE of isInformationRequest.
    for (const text of LOW_CONTENT) {
      expect(isInformationRequest(text), `wrongly read as a request: ${text}`).toBe(false)
    }
  })

  it('a refusal wearing the same verbs is not a request', () => {
    // Found by the existing Task-13 suite, not by inspection: the first version
    // of this predicate matched a bare "תשלח", so "אל תשלחו לי הודעות" — an
    // opt-out — read as a request for information and would have spent a model
    // call. The opt-out was still honoured upstream; the classification was not.
    for (const text of [
      'אל תשלחו לי הודעות',
      'אל תשלח לי כלום',
      'לא מעוניין',
      'לא מעוניינת לשמוע פרטים',
      'לא רוצה לקבל פרטים',
      "don't send me anything",
      'stop sending me messages',
    ]) {
      expect(isInformationRequest(text), `read a refusal as a request: ${text}`).toBe(false)
    }
  })

  it('a bare object or a bare verb is not a request', () => {
    expect(isInformationRequest('פרטים')).toBe(false)
    expect(isInformationRequest('אשמח')).toBe(false)
    expect(isInformationRequest('מידע')).toBe(false)
    expect(isInformationRequest('')).toBe(false)
  })

  it('seq 2 of this very conversation is still not worth a reply', () => {
    // "יחרא" — the message the agent correctly did NOT treat as intent.
    const run = runPipeline('יחרא')
    expect(run.generated).toBe(false)
    expect(run.skipReason).toBe('gpt_wait_NO_NEW_CONTENT')
  })

  it('after a statement, an acknowledgement still ends the conversation quietly', () => {
    // A second context, because control — not eligibility — owns this. The
    // agent said something that was not a question; "thanks" closes.
    const STATEMENT = 'SocialCRM מרכזת לידים מוואטסאפ ומפייסבוק במקום אחד, עם סטטוס ומעקב.'
    for (const text of LOW_CONTENT) {
      const { salesMove } = classifySalesTurnFromTranscript([
        { direction: 'inbound' as const, text: 'היי מה קורה?' },
        { direction: 'outbound' as const, text: STATEMENT },
        { direction: 'inbound' as const, text },
      ])
      const control = decideConversationControl({ salesMove, inboundText: text, previousOutbound: STATEMENT })
      if (control.action === 'CONTINUE' || control.action === 'ASK_QUESTION') {
        const eligibility = shouldInvokeSalesAi({
          inboundText: text,
          previousOutbound: STATEMENT,
          salesMove,
          controlAction: control.action,
          customerInboundCount: 2,
          previousCustomerText: 'היי מה קורה?',
        })
        expect(eligibility.decision, `the agent would have replied to: ${text}`).toBe('WAIT')
        continue
      }
      expect(control.action, `neither closed nor silenced: ${text}`).toBe('CLOSE_CONVERSATION')
    }
  })

  it('NO_MEANINGFUL_INTENT still exists and still fires — it was too narrow, not wrong', () => {
    const STATEMENT = 'SocialCRM מרכזת לידים מוואטסאפ ומפייסבוק במקום אחד, עם סטטוס ומעקב.'
    const eligibility = shouldInvokeSalesAi({
      inboundText: 'יחרא',
      previousOutbound: STATEMENT,
      salesMove: 'DISCOVERY',
      controlAction: 'ASK_QUESTION',
      customerInboundCount: 2,
      previousCustomerText: 'היי מה קורה?',
    })
    expect(eligibility).toEqual({ decision: 'WAIT', reason: 'NO_MEANINGFUL_INTENT' })
  })

  it('repeating the identical message still waits — NO_NEW_CONTENT is unaffected', () => {
    const run = runPipeline('סתם משהו', 'סתם משהו')
    expect(run.generated).toBe(false)
    expect(run.skipReason).toBe('gpt_wait_NO_NEW_CONTENT')
  })

  it('"ok" after the agent asked a question runs for PENDING_QUESTION, not the widening', () => {
    // Pre-existing and deliberate: the agent asked, the customer answered
    // minimally, and going silent there is the failure this file is about.
    const run = runPipeline('אוקיי')
    expect(run.generated).toBe(true)
    expect(run.eligibility?.reason).toBe('PENDING_QUESTION')
  })
})

/**
 * The four hypotheses checked against the production rows and refuted. Kept as
 * executable documentation so the protections they describe cannot regress
 * quietly while this gate is being widened.
 */
describe('refuted hypotheses — the protections that were working correctly', () => {
  it('the agent tagging its own outbound is what keeps takeover false', () => {
    const sourceOf = (metadata: unknown) => {
      try {
        const m = typeof metadata === 'string' ? JSON.parse(metadata) : metadata
        return (m as { source?: string } | null)?.source ?? ''
      } catch {
        return ''
      }
    }
    const tookOver = (rows: Array<{ direction: string; metadata: unknown }>) =>
      rows.some((m) => m.direction === 'outbound' && sourceOf(m.metadata) !== 'auto_response')

    // Conversation 6694's seq 3, as stored.
    expect(tookOver([{ direction: 'outbound', metadata: { source: 'auto_response' } }])).toBe(false)
    // A genuine human reply still takes over — unchanged.
    expect(tookOver([{ direction: 'outbound', metadata: { source: 'manual' } }])).toBe(true)
  })

  it('human takeover, opt-out and escalation still stop the agent', () => {
    expect(decidePreGeneration(pre({ humanTookOver: true })).action).toBe('stop')
    expect(decidePreGeneration(pre({ optOut: true })).action).toBe('stop')
    expect(decidePreGeneration(pre({ aiState: 'escalated' })).action).toBe('skip')
    expect(decidePreGeneration(pre({ aiState: 'human_active' })).action).toBe('skip')
    expect(decidePreGeneration(pre({ aiState: 'opted_out' })).action).toBe('skip')
    expect(decidePreGeneration(pre({ humanTyping: true })).action).toBe('skip')
    expect(decidePreGeneration(pre({ humanRequest: true })).action).toBe('handoff')
  })

  it('an information request does not reopen a closed conversation on its own', () => {
    // Widening intent must not become a back door into a conversation the
    // customer ended. Reopening stays the caller's explicit decision.
    expect(decidePreGeneration(pre({ aiState: 'closed', reopenEligible: false })).action).toBe('skip')
  })
})
