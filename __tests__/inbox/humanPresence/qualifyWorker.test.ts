/**
 * WhatsApp Agent — Human Presence through the real qualify worker.
 *
 * End-to-end for one autonomous turn: does the agent spend an AI call, does it
 * cancel one in flight, and does anything reach WhatsApp. The pure model and the
 * boundary tests cover the decisions; this covers the orchestration around them.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const skipAutoResponseJob = vi.hoisted(() => vi.fn())
const failAutoResponseJob = vi.hoisted(() => vi.fn())
const completeAutoResponseJob = vi.hoisted(() => vi.fn())
const countSentToday = vi.hoisted(() => vi.fn())
const getOrCreateAiState = vi.hoisted(() => vi.fn())
const recordTurn = vi.hoisted(() => vi.fn())
const markHumanActive = vi.hoisted(() => vi.fn())
const persistOutboundWhatsapp = vi.hoisted(() => vi.fn())
const readHumanPresence = vi.hoisted(() => vi.fn())
const tableRows = vi.hoisted(() => ({
  connections: null as unknown,
  messageList: [] as unknown[],
  // main's assertIreSendAllowed re-reads the conversation immediately before the
  // Graph call: it must exist, not be personal, and belong to this agency.
  conversation: { id: 382, isPersonal: false } as unknown,
}))

vi.mock('@/lib/analytics/track', () => ({ track: vi.fn() }))
vi.mock('@/lib/inbox/persistOutboundWhatsapp', () => ({ persistOutboundWhatsapp }))
vi.mock('@/lib/inbox/autoresponse/waTrace', () => ({ waTrace: vi.fn() }))
vi.mock('@/lib/inbox/onWhatsappSendFailure', () => ({ applyIreWhatsappSendFailure: vi.fn() }))
vi.mock('@/db/conversationHumanPresence', () => ({ readHumanPresence, recordHumanTyping: vi.fn(), markHumanActiveByConversation: vi.fn() }))
vi.mock('@/db/autoResponseJobs', () => ({
  skipAutoResponseJob,
  failAutoResponseJob,
  completeAutoResponseJob,
  countSentToday,
  enqueueAutoResponse: vi.fn(),
  deferAutoResponseJob: vi.fn(),
  skipPendingNoResponseJobs: vi.fn(),
  hasSentFirstContact: vi.fn(),
  claimAutoResponseJobs: vi.fn(),
  reclaimStaleAutoResponseJobs: vi.fn(),
}))
vi.mock('@/db/conversationAiState', () => ({
  getOrCreateAiState,
  recordTurn,
  mergeOnly: vi.fn(),
  markEscalated: vi.fn(),
  markHumanActive,
  markStopped: vi.fn(),
  markClosed: vi.fn(),
}))
vi.mock('@/db/conversationIntelligence', () => ({
  upsertManyConversationIntelligence: vi.fn(),
  getMaxMessageSequence: vi.fn(async () => 1),
  INTEL_KIND_TEMPERATURE: 'temperature',
}))
vi.mock('@/config/db', () => {
  const chainFor = (table: string) => {
    const c: Record<string, unknown> = {}
    const self = () => c
    c.where = self
    c.whereNotNull = self
    c.orderBy = self
    c.limit = self
    c.update = async () => 1
    c.select = async () => tableRows.messageList
    c.first = async () => {
      if (table === 'whatsapp_connections') return tableRows.connections
      if (table === 'inbox_conversations') return tableRows.conversation
      return null
    }
    return c
  }
  return {
    db: Object.assign((table: string) => chainFor(table), {
      raw: (sql: string) => sql,
      fn: { now: () => new Date() },
      transaction: async (fn: (trx: unknown) => unknown) => fn({}),
    }),
  }
})

import { processQualifyJob, type QualifyCtx } from '@/lib/inbox/autoresponse/qualifyWorker'
import { HUMAN_TYPING_TTL_MS } from '@/lib/inbox/autoresponse/humanPresence'
import type { AutoResponseJob } from '@/db/autoResponseJobs'

const T0 = Date.parse('2026-08-23T09:00:00.000Z')
const at = (ms: number): string => new Date(T0 + ms).toISOString()

const JOB: AutoResponseJob = {
  id: 61,
  agencyId: 103,
  conversationId: 382,
  leadId: 1417,
  channel: 'whatsapp',
  reason: 'qualify_turn',
  triggerSequence: 4,
  attempts: 1,
  maxAttempts: 3,
  createdAt: at(0),
}

const CTX: QualifyCtx = {
  master: true,
  settings: {
    agencyId: 103,
    channel: 'whatsapp',
    enabled: true,
    quietHours: {},
    dailyCap: 200,
    guidance: null,
    agentInstructions: null,
    businessProfile: null,
    mode: 'qualify',
    maxTurns: 5,
    collectFields: { required: ['name'], optional: [] },
    draft: false,
    replyMode: 'ai',
    fixedBody: null,
    delaySeconds: 5,
  },
  conv: { id: 382, businessPhoneNumberId: '972007939322425', customerWaId: '972524186300', customerName: 'george' },
  lead: { id: 1417, userId: 332, handlerId: null, status: 'new' },
}

const OK_GEN = {
  ok: true as const,
  reply: 'מה הכי מפריע לך בזה עכשיו?',
  extracted: {},
  corrected: [],
  objective: 'understand_pain' as const,
  understanding: { pain: null, impact: null, currentWorkflow: null, desiredOutcome: null },
  hotSignal: false,
  uncertain: false,
  salesMove: null,
}

const CLEAN = { aiState: 'ai_qualifying', humanTypingUntil: null, humanTypingAt: null, now: at(1_000) }
const typingAt = (ms: number, nowMs: number) => ({
  aiState: 'ai_qualifying',
  humanTypingAt: at(ms),
  humanTypingUntil: at(ms + HUMAN_TYPING_TTL_MS),
  now: at(nowMs),
})

const inbound = (text: string) => ({
  direction: 'inbound',
  text,
  sentByUserId: null,
  channelTimestamp: new Date(),
  createdAt: new Date(),
  metadata: null,
})
const outbound = (text: string) => ({
  direction: 'outbound',
  text,
  sentByUserId: null,
  channelTimestamp: new Date(),
  createdAt: new Date(),
  metadata: { source: 'auto_response' },
})

/**
 * A transcript that reaches generation: the agent answered, the customer asked a
 * product question. Newest-first — the worker loads `ORDER BY sequence DESC` and
 * reverses, so this array reads backwards in time.
 */
const ENGAGED = () => [inbound('מה המחיר?'), outbound('המערכת מרכזת את כל הלידים במקום אחד.'), inbound('יש לי עסק')]

const skipReasons = (): string[] => skipAutoResponseJob.mock.calls.map((c) => String(c[1]))

beforeEach(() => {
  skipAutoResponseJob.mockReset().mockResolvedValue(undefined)
  failAutoResponseJob.mockReset().mockResolvedValue(undefined)
  completeAutoResponseJob.mockReset().mockResolvedValue(undefined)
  countSentToday.mockReset().mockResolvedValue(0)
  recordTurn.mockReset().mockResolvedValue(undefined)
  markHumanActive.mockReset().mockResolvedValue(undefined)
  persistOutboundWhatsapp.mockReset().mockResolvedValue({ messageId: 4001, sequence: 9 })
  getOrCreateAiState.mockReset().mockResolvedValue({ aiState: 'ai_qualifying', aiTurnCount: 3, qualification: {} })
  readHumanPresence.mockReset().mockResolvedValue(CLEAN)
  tableRows.connections = { phone_number_id: '972007939322425', access_token: 't', user_id: 332 }
  tableRows.conversation = { id: 382, isPersonal: false }
  tableRows.messageList = ENGAGED()
})

describe('reading a conversation does not stop the agent', () => {
  it('with no typing signal the agent generates and sends', async () => {
    const send = vi.fn(async () => ({ ok: true as const, wamid: 'wamid.1' }))
    const generateQualify = vi.fn(async () => OK_GEN)
    const outcome = await processQualifyJob(JOB, CTX, { send, generateQualify })

    expect(outcome).toBe('sent')
    expect(generateQualify).toHaveBeenCalledTimes(1)
    expect(send).toHaveBeenCalledTimes(1)
    expect(recordTurn).toHaveBeenCalled()
  })
})

describe('typing stops the agent before an AI call is spent', () => {
  it('a live typing signal at turn start skips without calling the model', async () => {
    readHumanPresence.mockResolvedValue(typingAt(-1_000, 1_000))
    const send = vi.fn()
    const generateQualify = vi.fn()
    const outcome = await processQualifyJob(JOB, CTX, { send, generateQualify })

    expect(outcome).toBe('skipped')
    expect(skipReasons()).toContain('human_typing')
    expect(generateQualify).not.toHaveBeenCalled()
    expect(send).not.toHaveBeenCalled()
  })

  it('typing is NOT takeover — the conversation is never marked human_active', async () => {
    readHumanPresence.mockResolvedValue(typingAt(-1_000, 1_000))
    await processQualifyJob(JOB, CTX, { send: vi.fn(), generateQualify: vi.fn() })
    expect(markHumanActive).not.toHaveBeenCalled()
  })
})

describe('typing that starts DURING generation', () => {
  it('cancels the in-flight generation and sends nothing', async () => {
    // Clean at turn start, so generation begins. The rep starts typing while the
    // model is running; the watcher aborts the provider call.
    readHumanPresence.mockResolvedValueOnce(CLEAN).mockResolvedValue(typingAt(2_000, 3_000))
    const send = vi.fn()
    // Resolves only when the abort actually fires — proving the signal reaches
    // the generator rather than being quietly dropped.
    const generateQualify = vi.fn(async (args: { abortSignal?: AbortSignal }) => {
      await new Promise<void>((resolve) => {
        if (args.abortSignal?.aborted) return resolve()
        args.abortSignal?.addEventListener('abort', () => resolve(), { once: true })
      })
      return { ok: false as const, skipReason: 'ai_unavailable' as const }
    })

    const outcome = await processQualifyJob(JOB, CTX, { send, generateQualify })

    expect(outcome).toBe('skipped')
    expect(skipReasons()).toContain('human_typing')
    expect(send).not.toHaveBeenCalled()
    // A cancelled generation is NOT a provider outage: retrying it would burn the
    // job's attempts and eventually deliver the reply the human displaced.
    expect(failAutoResponseJob).not.toHaveBeenCalled()
  })

  it('a reply that WINS the race with the abort is discarded, not sent', async () => {
    // The model returned before cancellation could land. The boundary refuses it.
    readHumanPresence.mockResolvedValueOnce(CLEAN).mockResolvedValue(typingAt(2_000, 9_000))
    const send = vi.fn(async () => ({ ok: true as const, wamid: 'wamid.must-not-happen' }))
    const generateQualify = vi.fn(async () => OK_GEN)

    const outcome = await processQualifyJob(JOB, CTX, { send, generateQualify })

    expect(outcome).toBe('skipped')
    expect(skipReasons()).toContain('human_typing_this_turn')
    expect(send).not.toHaveBeenCalled()
    expect(persistOutboundWhatsapp).not.toHaveBeenCalled()
    expect(recordTurn).not.toHaveBeenCalled()
  })

  it('a delayed completion long after the TTL lapsed still cannot send', async () => {
    readHumanPresence.mockResolvedValueOnce(CLEAN).mockResolvedValue({
      aiState: 'ai_qualifying',
      humanTypingAt: at(2_000),
      humanTypingUntil: at(2_000 + HUMAN_TYPING_TTL_MS),
      now: at(600_000),
    })
    const send = vi.fn()
    const outcome = await processQualifyJob(JOB, CTX, { send, generateQualify: vi.fn(async () => OK_GEN) })

    expect(outcome).toBe('skipped')
    expect(skipReasons()).toContain('human_typing_this_turn')
    expect(send).not.toHaveBeenCalled()
  })
})

describe('after the rep has sent a message', () => {
  it('the turn stops at the pre-generation gate with no AI call', async () => {
    getOrCreateAiState.mockResolvedValue({ aiState: 'human_active', aiTurnCount: 3, qualification: {} })
    readHumanPresence.mockResolvedValue({ ...CLEAN, aiState: 'human_active' })
    const generateQualify = vi.fn()
    const send = vi.fn()

    const outcome = await processQualifyJob(JOB, CTX, { send, generateQualify })

    expect(outcome).toBe('skipped')
    expect(skipReasons()).toContain('human_active')
    expect(generateQualify).not.toHaveBeenCalled()
    expect(send).not.toHaveBeenCalled()
  })

  it('a retried job cannot send even if the lifecycle row lags behind', async () => {
    // Worst case: the AI-state row still says ai_qualifying (stale read) but the
    // presence row already knows. The boundary, not the cached fact, decides.
    getOrCreateAiState.mockResolvedValue({ aiState: 'ai_qualifying', aiTurnCount: 3, qualification: {} })
    readHumanPresence.mockResolvedValueOnce(CLEAN).mockResolvedValue({ ...CLEAN, aiState: 'human_active' })
    const send = vi.fn()
    const outcome = await processQualifyJob({ ...JOB, attempts: 3 }, CTX, {
      send,
      generateQualify: vi.fn(async () => OK_GEN),
    })

    expect(outcome).toBe('skipped')
    expect(skipReasons()).toContain('human_active')
    expect(send).not.toHaveBeenCalled()
  })
})

describe('a browser disconnect does not permanently block the agent', () => {
  it('once the TTL has lapsed the next turn is answered normally', async () => {
    // Orphaned marker from a tab that died during the PREVIOUS turn; this job was
    // created afterwards, so the keystroke is not part of it.
    readHumanPresence.mockResolvedValue({
      aiState: 'ai_qualifying',
      humanTypingAt: at(-60_000),
      humanTypingUntil: at(-60_000 + HUMAN_TYPING_TTL_MS),
      now: at(1_000),
    })
    const send = vi.fn(async () => ({ ok: true as const, wamid: 'wamid.2' }))
    const outcome = await processQualifyJob(JOB, CTX, { send, generateQualify: vi.fn(async () => OK_GEN) })

    expect(outcome).toBe('sent')
    expect(send).toHaveBeenCalledTimes(1)
  })
})

describe("main's IRE send gate is still enforced alongside Human Presence", () => {
  it('a personal conversation is refused even with no human present', async () => {
    // The older invariant. Human Presence must not have displaced it.
    tableRows.conversation = { id: 382, isPersonal: true }
    const send = vi.fn()
    const outcome = await processQualifyJob(JOB, CTX, { send, generateQualify: vi.fn(async () => OK_GEN) })

    expect(outcome).toBe('skipped')
    expect(skipReasons()).toContain('personal')
    expect(send).not.toHaveBeenCalled()
  })

  it('a deleted conversation is refused even with no human present', async () => {
    tableRows.conversation = null
    const send = vi.fn()
    const outcome = await processQualifyJob(JOB, CTX, { send, generateQualify: vi.fn(async () => OK_GEN) })

    expect(outcome).toBe('skipped')
    expect(skipReasons()).toContain('conversation_gone')
    expect(send).not.toHaveBeenCalled()
  })
})
