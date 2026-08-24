/**
 * A3 — per-turn conversation classification.
 *
 * Three things have to hold and none of them are visible from the worker alone:
 * the row maps every classification field (a dropped `draft` would let canary
 * turns pollute every aggregate), the write happens exactly once on each of the
 * three terminal outcomes and never on an early exit, and the insert really is
 * first-write-wins on ("conversationId","triggerSequence") — which only the
 * generated SQL can prove, because a mocked writer accepts any conflict clause.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const failAutoResponseJob = vi.hoisted(() => vi.fn())
const skipAutoResponseJob = vi.hoisted(() => vi.fn())
const completeAutoResponseJob = vi.hoisted(() => vi.fn())
const countSentToday = vi.hoisted(() => vi.fn())
const enqueueAutoResponse = vi.hoisted(() => vi.fn())
const skipPendingNoResponseJobs = vi.hoisted(() => vi.fn())
const getOrCreateAiState = vi.hoisted(() => vi.fn())
const recordTurn = vi.hoisted(() => vi.fn())
const mergeOnly = vi.hoisted(() => vi.fn())
const markEscalated = vi.hoisted(() => vi.fn())
const markClosed = vi.hoisted(() => vi.fn())
const persistOutboundWhatsapp = vi.hoisted(() => vi.fn())
const insertQualifyDraftReview = vi.hoisted(() => vi.fn())
const recordTurnClassification = vi.hoisted(() => vi.fn())
const tableRows = vi.hoisted(() => ({
  conversations: null as unknown,
  clients: null as unknown,
  messages: null as unknown,
  connections: null as unknown,
  jobs: null as unknown,
  messageList: [] as unknown[],
}))

vi.mock('@/lib/analytics/track', () => ({ track: vi.fn() }))
vi.mock('@/lib/inbox/persistOutboundWhatsapp', () => ({ persistOutboundWhatsapp }))
vi.mock('@/lib/inbox/autoresponse/waTrace', () => ({ waTrace: vi.fn() }))
vi.mock('@/lib/inbox/onWhatsappSendFailure', () => ({ applyIreWhatsappSendFailure: vi.fn() }))
vi.mock('@/db/qualifyDraftReview', () => ({ insertQualifyDraftReview }))
vi.mock('@/db/autoResponseJobs', () => ({
  failAutoResponseJob,
  skipAutoResponseJob,
  completeAutoResponseJob,
  countSentToday,
  enqueueAutoResponse,
  deferAutoResponseJob: vi.fn(),
  skipPendingNoResponseJobs,
  hasSentFirstContact: vi.fn(),
  claimAutoResponseJobs: vi.fn(),
  reclaimStaleAutoResponseJobs: vi.fn(),
}))
vi.mock('@/db/conversationAiState', () => ({
  getOrCreateAiState,
  recordTurn,
  mergeOnly,
  markEscalated,
  markHumanActive: vi.fn(),
  markStopped: vi.fn(),
  markClosed,
}))
vi.mock('@/db/conversationIntelligence', () => ({
  upsertManyConversationIntelligence: vi.fn(),
  getMaxMessageSequence: vi.fn(async () => 1),
  INTEL_KIND_TEMPERATURE: 'temperature',
}))
// The real builder stays real — the mapping tests below exercise it. Only the
// write is spied, so the worker assertions see the exact input it was handed.
vi.mock('@/db/conversationTurnClassification', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/db/conversationTurnClassification')>()
  return { ...actual, recordTurnClassification }
})
vi.mock('@/config/db', async () => {
  // Real pg builder for the classification table ONLY, so the insert's conflict
  // clause is assertable via .toSQL(). It is never awaited, so it never connects.
  const knex = (await import('knex')).default
  const sqlOnly = knex({ client: 'pg' })
  const chainFor = (table: string) => {
    if (table === 'conversation_turn_classification') return sqlOnly(table) as unknown as Record<string, unknown>
    const chain: Record<string, unknown> = {}
    const self = () => chain
    chain.where = self
    chain.whereNotNull = self
    chain.whereRaw = self
    chain.orderBy = self
    chain.limit = self
    chain.count = self
    chain.update = async () => 1
    chain.insert = async () => [1]
    chain.select = async () => tableRows.messageList
    chain.first = async () => {
      if (table === 'inbox_conversations') return tableRows.conversations
      if (table === 'clients') return tableRows.clients
      if (table === 'whatsapp_connections') return tableRows.connections
      if (table === 'auto_response_jobs') return tableRows.jobs
      if (table === 'inbox_messages') return tableRows.messages
      return null
    }
    return chain
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
import {
  buildTurnClassification,
  turnClassificationInsertQuery,
  type TurnClassificationInput,
} from '@/db/conversationTurnClassification'
import type { AutoResponseJob } from '@/db/autoResponseJobs'
import type { ResponseProfile } from '@/lib/inbox/autoresponse/responseProfile'

const JOB: AutoResponseJob = {
  id: 61,
  agencyId: 103,
  conversationId: 382,
  leadId: 1417,
  channel: 'whatsapp',
  reason: 'qualify_turn',
  triggerSequence: 4,
  attempts: 2,
  maxAttempts: 3,
  createdAt: new Date().toISOString(),
}

const baseSettings = {
  agencyId: 103,
  channel: 'whatsapp',
  enabled: true,
  quietHours: {},
  dailyCap: 200,
  guidance: null,
  mode: 'qualify' as const,
  maxTurns: 5,
  collectFields: { required: ['name'], optional: [] },
  draft: false,
  replyMode: 'ai' as const,
  fixedBody: null,
  delaySeconds: 5,
}

const ctxWith = (over: Partial<typeof baseSettings> = {}): QualifyCtx => ({
  master: true,
  settings: { ...baseSettings, ...over },
  conv: {
    id: 382,
    businessPhoneNumberId: '972007939322425',
    customerWaId: '972524186300',
    customerName: 'george',
  },
  lead: { id: 1417, userId: 332, handlerId: null, status: 'new' },
})

const STATEMENT = 'המערכת מרכזת את כל הלידים במקום אחד.'
const CLEAN_REPLY = 'מה הכי מפריע לך בזה עכשיו?'
/** Contains הנחה → FORBIDDEN → 'forbidden' → safety. Surviving one regeneration forces the guardrail handoff. */
const FORBIDDEN_REPLY = 'יש הנחה מיוחדת, רוצה לשמוע?'

const genOk = (reply: string) => ({
  ok: true as const,
  reply,
  extracted: {},
  objective: 'understand_pain' as const,
  understanding: { pain: null, impact: null, currentWorkflow: null, desiredOutcome: null },
  hotSignal: false,
  uncertain: false,
  salesMove: null,
  model: 'claude-test-model',
})

function inbound(text: string) {
  return { direction: 'inbound', text, sentByUserId: null, channelTimestamp: new Date(), createdAt: new Date(), metadata: null }
}
function outbound(text: string, metadata: unknown = { source: 'auto_response' }) {
  return { direction: 'outbound', text, sentByUserId: null, channelTimestamp: new Date(), createdAt: new Date(), metadata }
}

/** A transcript whose final inbound reaches generation (ASK_QUESTION → RUN_AI). */
const REACHES_GENERATION = () => [inbound('היי אחי מה קורה?'), outbound(STATEMENT), inbound('יש לי עסק')]

const okSend = () => vi.fn(async () => ({ ok: true as const, wamid: 'w' }))

// ── 1. Pure builder mapping ────────────────────────────────────────────────────

describe('buildTurnClassification', () => {
  const profile: ResponseProfile = {
    tone: 'casual',
    emotion: 'frustrated',
    urgency: 'high',
    language: 'he',
    customerStyle: 'short',
    establishedTone: 'professional',
    vocative: 'אחי',
  }
  const input = (over: Partial<TurnClassificationInput> = {}): TurnClassificationInput => ({
    job: JOB,
    salesMove: 'DISCOVERY',
    salesStrategy: 'discover',
    responseProfile: profile,
    hotSignal: true,
    uncertain: false,
    decision: { action: 'send' },
    draft: false,
    turnCount: 4,
    model: 'claude-test-model',
    ...over,
  })

  it('maps every job field, including attribution', () => {
    const row = buildTurnClassification(input())
    expect(row).toMatchObject({
      agencyId: 103,
      conversationId: 382,
      leadId: 1417,
      triggerSequence: 4,
      jobId: 61,
      attempt: 2,
    })
  })

  it('maps all seven response-profile fields', () => {
    const row = buildTurnClassification(input())
    expect(row).toMatchObject({
      tone: 'casual',
      emotion: 'frustrated',
      urgency: 'high',
      language: 'he',
      customerStyle: 'short',
      establishedTone: 'professional',
      vocative: 'אחי',
    })
  })

  it('keeps a null vocative null rather than dropping the field', () => {
    const row = buildTurnClassification(input({ responseProfile: { ...profile, vocative: null } }))
    expect(row.vocative).toBeNull()
    expect('vocative' in row).toBe(true)
  })

  it('carries the classification signals and the model', () => {
    const row = buildTurnClassification(input())
    expect(row.salesMove).toBe('DISCOVERY')
    expect(row.salesStrategy).toBe('discover')
    expect(row.hotSignal).toBe(true)
    expect(row.uncertain).toBe(false)
    expect(row.model).toBe('claude-test-model')
  })

  it('normalises a missing model to null', () => {
    expect(buildTurnClassification(input({ model: undefined })).model).toBeNull()
  })

  it('records escalationReason only on the escalate decision', () => {
    const send = buildTurnClassification(input())
    expect(send.decision).toBe('send')
    expect(send.escalationReason).toBeNull()

    const esc = buildTurnClassification(input({ decision: { action: 'escalate', reason: 'guardrail' } }))
    expect(esc.decision).toBe('escalate')
    expect(esc.escalationReason).toBe('guardrail')
  })

  it('preserves a leadless conversation as a null leadId', () => {
    const row = buildTurnClassification(input({ job: { ...JOB, leadId: null } }))
    expect(row.leadId).toBeNull()
  })

  // Mutation guard: deleting `draft: input.draft` from the builder fails here.
  it('carries the draft flag through in both states', () => {
    expect(buildTurnClassification(input({ draft: true })).draft).toBe(true)
    expect(buildTurnClassification(input({ draft: false })).draft).toBe(false)
  })
})

// ── 2–6. Worker wiring ─────────────────────────────────────────────────────────

describe('processQualifyJob turn classification', () => {
  beforeEach(() => {
    failAutoResponseJob.mockReset().mockResolvedValue(undefined)
    skipAutoResponseJob.mockReset().mockResolvedValue(undefined)
    completeAutoResponseJob.mockReset().mockResolvedValue(undefined)
    countSentToday.mockReset().mockResolvedValue(0)
    enqueueAutoResponse.mockReset().mockResolvedValue(77)
    skipPendingNoResponseJobs.mockReset().mockResolvedValue(1)
    recordTurn.mockReset().mockResolvedValue(undefined)
    mergeOnly.mockReset().mockResolvedValue(undefined)
    markClosed.mockReset().mockResolvedValue(undefined)
    markEscalated.mockReset().mockResolvedValue(undefined)
    insertQualifyDraftReview.mockReset().mockResolvedValue(undefined)
    recordTurnClassification.mockReset().mockResolvedValue(undefined)
    persistOutboundWhatsapp.mockReset().mockResolvedValue({ messageId: 4001, sequence: 9 })
    getOrCreateAiState.mockReset().mockResolvedValue({ aiState: 'ai_qualifying', aiTurnCount: 3, qualification: {} })
    tableRows.connections = { phone_number_id: '972007939322425', access_token: 't', user_id: 332 }
    tableRows.conversations = { id: 382, isPersonal: false }
    tableRows.messageList = []
  })

  const payload = () => recordTurnClassification.mock.calls[0]![0] as TurnClassificationInput

  // 4. SEND
  it('records exactly one classification on the send path', async () => {
    tableRows.messageList = REACHES_GENERATION()
    const generateQualify = vi.fn(async () => genOk(CLEAN_REPLY))
    const outcome = await processQualifyJob(JOB, ctxWith(), { send: okSend(), generateQualify })

    expect(outcome).toBe('sent')
    expect(recordTurnClassification).toHaveBeenCalledTimes(1)
    expect(payload()).toMatchObject({
      job: expect.objectContaining({ id: 61, triggerSequence: 4, attempts: 2 }),
      decision: { action: 'send' },
      draft: false,
      turnCount: 4,
      model: 'claude-test-model',
    })
    expect(payload().responseProfile.language).toBe('he')
    expect(payload().salesMove).toBeTruthy()
  })

  // 2. DRAFT
  it('records exactly one classification on the draft path, flagged as draft', async () => {
    tableRows.messageList = REACHES_GENERATION()
    const generateQualify = vi.fn(async () => genOk(CLEAN_REPLY))
    const send = okSend()
    const outcome = await processQualifyJob(JOB, ctxWith({ draft: true }), { send, generateQualify })

    expect(outcome).toBe('skipped')
    expect(send).not.toHaveBeenCalled()
    expect(recordTurnClassification).toHaveBeenCalledTimes(1)
    expect(payload().draft).toBe(true)
  })

  // 3. ESCALATE — a safety violation surviving one regeneration forces the guardrail handoff.
  it('records exactly one classification on the escalate path', async () => {
    tableRows.messageList = REACHES_GENERATION()
    const generateQualify = vi.fn(async () => genOk(FORBIDDEN_REPLY))
    await processQualifyJob(JOB, ctxWith(), { send: okSend(), generateQualify })

    expect(generateQualify).toHaveBeenCalledTimes(2)
    expect(markEscalated).toHaveBeenCalled()
    expect(recordTurnClassification).toHaveBeenCalledTimes(1)
    expect(payload().decision).toEqual({ action: 'escalate', reason: 'guardrail' })
    expect(payload().draft).toBe(false)
  })

  // 5. EARLY EXITS — no responseProfile / hotSignal exists on these paths.
  it.each([
    ['GPT eligibility WAIT', [inbound('👍'), outbound(STATEMENT), inbound('יש לי עסק')]],
    ['control handoff', [inbound('אפשר לדבר עם נציג'), outbound(STATEMENT), inbound('יש לי עסק')]],
    ['control close', [inbound('תודה אחי'), outbound(STATEMENT), inbound('יש לי עסק')]],
  ])('writes nothing on an early exit: %s', async (_label, messages) => {
    tableRows.messageList = messages
    const generateQualify = vi.fn()
    await processQualifyJob(JOB, ctxWith(), { send: okSend(), generateQualify })

    expect(generateQualify).not.toHaveBeenCalled()
    expect(recordTurnClassification).not.toHaveBeenCalled()
  })

  it('writes nothing when generation fails', async () => {
    tableRows.messageList = REACHES_GENERATION()
    const generateQualify = vi.fn(async () => ({ ok: false as const, skipReason: 'ai_unavailable' as const }))
    await processQualifyJob(JOB, ctxWith(), { send: okSend(), generateQualify })

    expect(generateQualify).toHaveBeenCalledTimes(1)
    expect(recordTurnClassification).not.toHaveBeenCalled()
  })

  // 6. FAILURE ISOLATION
  it('still sends when the classification write throws', async () => {
    tableRows.messageList = REACHES_GENERATION()
    recordTurnClassification.mockRejectedValue(new Error('relation does not exist'))
    const generateQualify = vi.fn(async () => genOk(CLEAN_REPLY))
    const send = okSend()

    const outcome = await processQualifyJob(JOB, ctxWith(), { send, generateQualify })

    expect(outcome).toBe('sent')
    expect(send).toHaveBeenCalledTimes(1)
    expect(completeAutoResponseJob).toHaveBeenCalledTimes(1)
  })

  it('still suppresses the send when the classification write throws on the draft path', async () => {
    tableRows.messageList = REACHES_GENERATION()
    recordTurnClassification.mockRejectedValue(new Error('relation does not exist'))
    const generateQualify = vi.fn(async () => genOk(CLEAN_REPLY))
    const send = okSend()

    const outcome = await processQualifyJob(JOB, ctxWith({ draft: true }), { send, generateQualify })

    expect(outcome).toBe('skipped')
    expect(send).not.toHaveBeenCalled()
    expect(insertQualifyDraftReview).toHaveBeenCalledTimes(1)
  })
})

// ── 7. Conflict target and ignore semantics, from the generated SQL ────────────

describe('turnClassificationInsertQuery SQL', () => {
  it('is first-write-wins on exactly (conversationId, triggerSequence)', () => {
    const row = buildTurnClassification({
      job: JOB,
      salesMove: 'DISCOVERY',
      salesStrategy: 'discover',
      responseProfile: {
        tone: 'neutral',
        emotion: 'neutral',
        urgency: 'normal',
        language: 'he',
        customerStyle: 'short',
        establishedTone: 'neutral',
        vocative: null,
      },
      hotSignal: false,
      uncertain: false,
      decision: { action: 'send' },
      draft: false,
      turnCount: 4,
      model: null,
    })
    const { sql, bindings } = turnClassificationInsertQuery(row).toSQL()

    expect(sql).toContain('insert into "conversation_turn_classification"')
    // Removing `.ignore()` drops "do nothing"; changing the target breaks the pair.
    expect(sql).toMatch(/on conflict \("conversationId", "triggerSequence"\) do nothing/)
    expect(sql).not.toMatch(/do update/)
    // The draft flag really reaches the statement, not just the row object.
    expect(sql).toContain('"draft"')
    expect(bindings).toContain(false)
  })
})
