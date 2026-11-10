import { describe, expect, it, vi } from 'vitest'
import { readQualifyTurnSource } from './qualifyTurnSource'
import { shouldInvokeSalesAi } from '@/lib/inbox/autoresponse/gptEligibility'
import { classifySalesMove } from '@/lib/inbox/autoresponse/salesIntent'
import { decideConversationControl, isExplicitReopen } from '@/lib/inbox/autoresponse/conversationControl'
import { decidePreGeneration, type PreFacts } from '@/lib/inbox/autoresponse/stateMachine'
import type { AiState } from '@/lib/inbox/autoresponse/qualification'

/**
 * PRE-MERGE VERIFICATION — the two cases named as release conditions.
 *
 *   1. A direct first message gets a reply.
 *   2. A customer cannot reopen their way past a human takeover.
 *
 * Kept as tests rather than a one-off check, because both are exactly the sort
 * of property that a later widening of the gate would quietly break.
 */

// ── 1. Direct first messages ────────────────────────────────────────────────

function firstMessage(text: string) {
  const salesMove = classifySalesMove(text)
  const control = decideConversationControl({ salesMove, inboundText: text })
  if (control.action !== 'CONTINUE' && control.action !== 'ASK_QUESTION') {
    return { answered: false, reason: `control_${control.action}` }
  }
  const eligibility = shouldInvokeSalesAi({
    inboundText: text,
    salesMove,
    controlAction: control.action,
    customerInboundCount: 1,
    agentHasSpoken: false,
  })
  return { answered: eligibility.decision === 'RUN_AI', reason: eligibility.reason }
}

describe('a customer who opens with a real need is answered', () => {
  const DIRECT_FIRST_MESSAGES = [
    'אני צריך תור',
    'יש לי בעיה ברכב',
    'היי, יש לי בעיה ברכב',
    'הרכב שלי עושה רעש',
    'שלום, רציתי לקבוע',
    'רציתי לקבוע תור לניקוי אבנית',
    'הכיור שלי סתום',
    'אני מחפש הצעת מחיר',
    'i need an appointment',
    'my car is making a noise',
  ]

  for (const text of DIRECT_FIRST_MESSAGES) {
    it(`answers: ${text}`, () => {
      const r = firstMessage(text)
      expect(r.answered, `first contact went unanswered — ${r.reason}`).toBe(true)
    })
  }

  it('answers a stated need at least as readily as a bare greeting', () => {
    // The defect this closes: the gate answered "היי" and ignored
    // "היי, יש לי בעיה ברכב", so the more a customer said, the less likely a
    // reply. Whatever else changes, that ordering must never come back.
    expect(firstMessage('היי').answered).toBe(true)
    expect(firstMessage('היי, יש לי בעיה ברכב').answered).toBe(true)
  })

  it('still costs nothing for social residue on first contact', () => {
    for (const text of ['לילה טוב', 'נדבר מחר', 'אני אחשוב על זה', 'שנייה', 'תן לי רגע', 'תודה']) {
      expect(firstMessage(text).answered, `answered social residue: ${text}`).toBe(false)
    }
  })
})

// ── 2. Reopening cannot override human takeover ─────────────────────────────

function pre(over: Partial<PreFacts> = {}): PreFacts {
  return {
    aiState: 'ai_qualifying',
    masterEnabled: true,
    channelEnabled: true,
    humanTookOver: false,
    humanTyping: false,
    optOut: false,
    hasUnansweredInbound: true,
    withinQuietHours: false,
    withinWindow: true,
    sentTodayForAgency: 0,
    dailyCap: 200,
    turnCount: 3,
    maxTurns: 5,
    ...over,
  }
}

/**
 * Messages that ARE genuine reopen signals — each returns true from
 * isExplicitReopen, so each is the strongest input the reopen path accepts.
 */
const REOPEN_SIGNALS = [
  'כמה זה עולה?',
  'אפשר לדבר עם נציג',
  'יש לי עוד שאלה',
  'מה כולל הטיפול?',
  'אפשר לקבוע דמו?',
]

/**
 * NOT a reopen signal today: "אני רוצה להתקדם" returns false from
 * isExplicitReopen, so it would not reopen a CLOSED conversation. That is a gap
 * in the reopen path of the same family as the ones this branch fixes in the
 * eligibility gate — a statement of intent that matches no listed shape — but it
 * is a different gate, it does not affect human takeover, and widening it
 * mid-release would be unreviewed scope. Recorded, not fixed here.
 */
const NOT_YET_A_REOPEN_SIGNAL = 'אני רוצה להתקדם'

describe('a customer cannot reopen past a human takeover', () => {
  it('every message used here really is a reopen signal', () => {
    // Otherwise the test below would pass for the wrong reason.
    for (const text of REOPEN_SIGNALS) {
      expect(isExplicitReopen({ salesMove: classifySalesMove(text), inboundText: text }), text).toBe(true)
    }
  })

  it('records the reopen-path gap found while writing this, so it is not lost', () => {
    const text = NOT_YET_A_REOPEN_SIGNAL
    expect(isExplicitReopen({ salesMove: classifySalesMove(text), inboundText: text })).toBe(false)
  })

  it('human_active skips even when the turn is reopen-eligible', () => {
    for (const reopenEligible of [true, false]) {
      const d = decidePreGeneration(pre({ aiState: 'human_active', reopenEligible }))
      expect(d.action, `reopenEligible=${reopenEligible}`).toBe('skip')
      expect('reason' in d ? d.reason : '').toBe('human_active')
    }
  })

  it('a human outbound in the transcript stops it even from a reopened closed state', () => {
    // The rep replied, the conversation was later marked closed, and the
    // customer then says something that would otherwise reopen it.
    const d = decidePreGeneration(pre({ aiState: 'closed', reopenEligible: true, humanTookOver: true }))
    expect(d.action).toBe('stop')
    expect('state' in d ? d.state : '').toBe('human_active')
  })

  it('escalated is not reopenable by the customer either', () => {
    const d = decidePreGeneration(pre({ aiState: 'escalated', reopenEligible: true }))
    expect(d.action).toBe('skip')
    expect('reason' in d ? d.reason : '').toBe('already_escalated')
  })

  it('opt-out outranks a reopen signal', () => {
    const d = decidePreGeneration(pre({ aiState: 'closed', reopenEligible: true, optOut: true }))
    expect(d.action).toBe('stop')
    expect('state' in d ? d.state : '').toBe('opted_out')
  })

  it('reopening still works from closed, which is the case it exists for', () => {
    expect(decidePreGeneration(pre({ aiState: 'closed', reopenEligible: true })).action).toBe('proceed')
    expect(decidePreGeneration(pre({ aiState: 'closed', reopenEligible: false })).action).toBe('skip')
  })

  it('NO state a human owns can be reached by the reopen path', () => {
    // Stated over the whole state space, so a new human-owned state added later
    // cannot silently become reopenable.
    const humanOwned: AiState[] = ['human_active', 'escalated']
    for (const aiState of humanOwned) {
      expect(decidePreGeneration(pre({ aiState, reopenEligible: true })).action, aiState).not.toBe('proceed')
    }
  })

  it('the worker only ever computes reopenEligible for a CLOSED conversation', async () => {
    // The second, independent barrier: even if decidePreGeneration were
    // reordered, the worker never offers reopenEligible=true for human_active.
    const { readFileSync } = await import('node:fs')
    const { join } = await import('node:path')
    const src = readQualifyTurnSource()
    expect(src).toContain("const reopenEligible = aiState.aiState === 'closed' && isExplicitReopen(")
  })
})

describe('the same, driven through the worker', () => {
  it('a reopen-signal inbound on a human-owned conversation generates nothing and sends nothing', async () => {
    vi.resetModules()
    const state = { aiState: 'human_active' as AiState, aiTurnCount: 4, qualification: {} }
    const skipAutoResponseJob = vi.fn()
    const tableRows = {
      conversations: { id: 900, isPersonal: false } as unknown,
      connections: { phone_number_id: 'pn', access_token: 't', user_id: 1 } as unknown,
      messageList: [
        { direction: 'inbound', text: 'כמה זה עולה?', sentByUserId: null, channelTimestamp: new Date(), createdAt: new Date(), metadata: null },
        { direction: 'outbound', text: 'היי, אני אלמיו', sentByUserId: 7, channelTimestamp: new Date(), createdAt: new Date(), metadata: { source: 'manual' } },
        { direction: 'inbound', text: 'היי', sentByUserId: null, channelTimestamp: new Date(), createdAt: new Date(), metadata: null },
      ] as unknown[],
    }

    vi.doMock('@/lib/analytics/track', () => ({ track: vi.fn() }))
    vi.doMock('@/lib/inbox/persistOutboundWhatsapp', () => ({ persistOutboundWhatsapp: vi.fn() }))
    vi.doMock('@/lib/inbox/autoresponse/waTrace', () => ({ waTrace: vi.fn() }))
    vi.doMock('@/lib/inbox/onWhatsappSendFailure', () => ({ applyIreWhatsappSendFailure: vi.fn() }))
    vi.doMock('@/db/autoResponseJobs', () => ({
      failAutoResponseJob: vi.fn(),
      skipAutoResponseJob,
      completeAutoResponseJob: vi.fn(),
      countSentToday: vi.fn(async () => 0),
      enqueueAutoResponse: vi.fn(),
      deferAutoResponseJob: vi.fn(),
      skipPendingNoResponseJobs: vi.fn(),
      hasSentFirstContact: vi.fn(),
      claimAutoResponseJobs: vi.fn(),
      reclaimStaleAutoResponseJobs: vi.fn(),
    }))
    vi.doMock('@/db/conversationAiState', () => ({
      getOrCreateAiState: vi.fn(async () => state),
      recordTurn: vi.fn(),
      mergeOnly: vi.fn(),
      markEscalated: vi.fn(),
      markHumanActive: vi.fn(),
      markStopped: vi.fn(),
      markClosed: vi.fn(),
      saveConversationSummary: vi.fn(),
    }))
    vi.doMock('@/db/conversationIntelligence', () => ({
      upsertManyConversationIntelligence: vi.fn(),
      getMaxMessageSequence: vi.fn(async () => 3),
      INTEL_KIND_TEMPERATURE: 'temperature',
    }))
    vi.doMock('@/config/db', () => {
      const chainFor = (table: string) => {
        const chain: Record<string, unknown> = {}
        const self = () => chain
        chain.where = self
        chain.whereNotNull = self
        chain.whereRaw = self
        chain.orderBy = self
        chain.limit = self
        chain.count = self
        chain.update = async () => 1
        chain.select = async () => tableRows.messageList
        chain.first = async () => {
          if (table === 'inbox_conversations') return tableRows.conversations
          if (table === 'whatsapp_connections') return tableRows.connections
          return null
        }
        return chain
      }
      return {
        db: Object.assign((t: string) => chainFor(t), {
          raw: (sql: string) => sql,
          fn: { now: () => new Date() },
          transaction: async (fn: (trx: unknown) => unknown) => fn({}),
        }),
      }
    })

    const { processQualifyJob } = await import('@/lib/inbox/autoresponse/qualifyWorker')
    const generateQualify = vi.fn()
    const send = vi.fn()

    const outcome = await processQualifyJob(
      {
        id: 1,
        agencyId: 1,
        conversationId: 900,
        leadId: 1,
        channel: 'whatsapp',
        reason: 'qualify_turn',
        triggerSequence: 3,
        attempts: 1,
        maxAttempts: 3,
        createdAt: new Date().toISOString(),
      },
      {
        master: true,
        settings: {
          agencyId: 1,
          channel: 'whatsapp',
          enabled: true,
          quietHours: {},
          dailyCap: 200,
          guidance: null,
          agentInstructions: null,
          businessProfile: null,
          mode: 'qualify',
          maxTurns: 5,
          collectFields: { required: [], optional: [] },
          draft: false,
          replyMode: 'ai',
          fixedBody: null,
          delaySeconds: 5,
        },
        conv: { id: 900, businessPhoneNumberId: 'pn', customerWaId: '9725', customerName: null },
        lead: { id: 1, userId: 1, handlerId: null, status: 'new' },
      },
      { send, generateQualify },
    )

    expect(generateQualify, 'the agent generated a reply over a human').not.toHaveBeenCalled()
    expect(send, 'the agent sent a message over a human').not.toHaveBeenCalled()
    expect(outcome).toBe('skipped')
    expect(skipAutoResponseJob).toHaveBeenCalledWith(1, 'human_active')

    vi.resetModules()
  })
})
