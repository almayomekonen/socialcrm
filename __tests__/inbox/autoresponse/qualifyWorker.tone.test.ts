/**
 * ResponseProfile is computed only after Control CONTINUE/ASK_QUESTION and GPT Eligibility RUN_AI.
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
const markEscalated = vi.hoisted(() => vi.fn())
const markClosed = vi.hoisted(() => vi.fn())
const persistOutboundWhatsapp = vi.hoisted(() => vi.fn())
const classifyResponseProfileSpy = vi.hoisted(() => vi.fn())
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
  mergeOnly: vi.fn(),
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
vi.mock('@/config/db', () => {
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
vi.mock('@/lib/inbox/autoresponse/responseProfile', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/inbox/autoresponse/responseProfile')>()
  return {
    ...actual,
    classifyResponseProfile: (input: Parameters<typeof actual.classifyResponseProfile>[0]) => {
      classifyResponseProfileSpy(input)
      return actual.classifyResponseProfile(input)
    },
  }
})

import { processQualifyJob, type QualifyCtx } from '@/lib/inbox/autoresponse/qualifyWorker'
import { NO_RESPONSE_WARNING_TEXT } from '@/lib/inbox/autoresponse/noResponseClose'
import type { AutoResponseJob } from '@/db/autoResponseJobs'

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
  createdAt: new Date().toISOString(),
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
    mode: 'qualify',
    maxTurns: 5,
    collectFields: { required: ['name'], optional: [] },
    draft: false,
    replyMode: 'ai',
    fixedBody: null,
    delaySeconds: 5,
  },
  conv: {
    id: 382,
    businessPhoneNumberId: '972007939322425',
    customerWaId: '972524186300',
    customerName: 'george',
  },
  lead: { id: 1417, userId: 332, handlerId: null, status: 'new' },
}

const STATEMENT = 'המערכת מרכזת את כל הלידים במקום אחד.'
const EXPLAIN_OFFER = 'רוצה שאסביר איך זה עובד?'
const OK_GEN = {
  ok: true as const,
  reply: 'מה הכי מפריע לך בזה עכשיו?',
  extracted: {},
  objective: 'understand_pain' as const,
  understanding: { pain: null, impact: null, currentWorkflow: null, desiredOutcome: null },
  hotSignal: false,
  uncertain: false,
  salesMove: null,
}

type QualifyCallArgs = {
  responseProfile?: { tone: string; vocative: string | null; language: string }
  regenerationReason?: string
}

function lastQualifyArgs(generateQualify: { mock: { calls: unknown[][] } }): QualifyCallArgs {
  const first = generateQualify.mock.calls[0]
  expect(first).toBeDefined()
  return first![0] as QualifyCallArgs
}

function inbound(text: string) {
  return {
    direction: 'inbound',
    text,
    sentByUserId: null,
    channelTimestamp: new Date(),
    createdAt: new Date(),
    metadata: null,
  }
}

function outbound(text: string, metadata: unknown = { source: 'auto_response' }) {
  return {
    direction: 'outbound',
    text,
    sentByUserId: null,
    channelTimestamp: new Date(),
    createdAt: new Date(),
    metadata,
  }
}

describe('processQualifyJob ResponseProfile wiring', () => {
  beforeEach(() => {
    failAutoResponseJob.mockReset().mockResolvedValue(undefined)
    skipAutoResponseJob.mockReset().mockResolvedValue(undefined)
    completeAutoResponseJob.mockReset().mockResolvedValue(undefined)
    countSentToday.mockReset().mockResolvedValue(0)
    enqueueAutoResponse.mockReset().mockResolvedValue(77)
    skipPendingNoResponseJobs.mockReset().mockResolvedValue(1)
    recordTurn.mockReset().mockResolvedValue(undefined)
    markClosed.mockReset().mockResolvedValue(undefined)
    markEscalated.mockReset().mockResolvedValue(undefined)
    persistOutboundWhatsapp.mockReset().mockResolvedValue({ messageId: 4001, sequence: 9 })
    classifyResponseProfileSpy.mockClear()
    getOrCreateAiState.mockReset().mockResolvedValue({
      aiState: 'ai_qualifying',
      aiTurnCount: 3,
      qualification: {},
    })
    tableRows.connections = {
      phone_number_id: '972007939322425',
      access_token: 't',
      user_id: 332,
    }
  })

  it('ASK_QUESTION inbound creates ResponseProfile and GPT runs', async () => {
    tableRows.messageList = [inbound('היי אחי מה קורה?'), outbound(STATEMENT), inbound('יש לי עסק')]
    const generateQualify = vi.fn(async (_args: QualifyCallArgs) => ({ ok: false as const, skipReason: 'ai_unavailable' as const }))
    await processQualifyJob(JOB, CTX, { send: vi.fn(), generateQualify })
    expect(classifyResponseProfileSpy).toHaveBeenCalledTimes(1)
    expect(generateQualify).toHaveBeenCalledTimes(1)
    const args = lastQualifyArgs(generateQualify)
    expect(args.responseProfile?.tone).toBe('casual')
    expect(args.responseProfile?.vocative).toBe('אחי')
    expect(args.responseProfile?.language).toBe('he')
  })

  it('CONTINUE product question creates ResponseProfile and GPT runs', async () => {
    tableRows.messageList = [inbound('מה המחיר?'), outbound(STATEMENT), inbound('יש לי עסק')]
    const generateQualify = vi.fn(async () => ({ ok: false as const, skipReason: 'ai_unavailable' as const }))
    await processQualifyJob(JOB, CTX, { send: vi.fn(), generateQualify })
    expect(classifyResponseProfileSpy).toHaveBeenCalledTimes(1)
    expect(generateQualify).toHaveBeenCalledTimes(1)
    expect(lastQualifyArgs(generateQualify).responseProfile).toEqual(expect.objectContaining({ language: 'he' }))
  })

  it('WAIT does not create ResponseProfile', async () => {
    tableRows.messageList = [inbound('👍'), outbound(STATEMENT), inbound('יש לי עסק')]
    const generateQualify = vi.fn()
    await processQualifyJob(JOB, CTX, { send: vi.fn(), generateQualify })
    expect(generateQualify).not.toHaveBeenCalled()
    expect(classifyResponseProfileSpy).not.toHaveBeenCalled()
  })

  it('CLOSE תודה אחי after an answer does not call ResponseProfile or GPT', async () => {
    tableRows.messageList = [inbound('תודה אחי'), outbound(STATEMENT), inbound('יש לי עסק')]
    const generateQualify = vi.fn()
    await processQualifyJob(JOB, CTX, { send: vi.fn(), generateQualify })
    expect(generateQualify).not.toHaveBeenCalled()
    expect(classifyResponseProfileSpy).not.toHaveBeenCalled()
    expect(markClosed).toHaveBeenCalled()
  })

  it('HANDOFF does not create ResponseProfile', async () => {
    tableRows.messageList = [inbound('אפשר לדבר עם נציג'), outbound(STATEMENT), inbound('יש לי עסק')]
    const generateQualify = vi.fn()
    const send = vi.fn(async () => ({ ok: true as const, wamid: 'w' }))
    await processQualifyJob(JOB, CTX, { send, generateQualify })
    expect(generateQualify).not.toHaveBeenCalled()
    expect(classifyResponseProfileSpy).not.toHaveBeenCalled()
  })

  it('no-response warning + כן does not call ResponseProfile or GPT', async () => {
    tableRows.messageList = [
      inbound('כן'),
      outbound(NO_RESPONSE_WARNING_TEXT, { source: 'auto_response', kind: 'no_response_warning' }),
      inbound('יש לי עסק'),
    ]
    const generateQualify = vi.fn()
    const send = vi.fn(async () => ({ ok: true as const, wamid: 'w' }))
    await processQualifyJob(JOB, CTX, { send, generateQualify })
    expect(generateQualify).not.toHaveBeenCalled()
    expect(classifyResponseProfileSpy).not.toHaveBeenCalled()
    expect(markClosed).toHaveBeenCalled()
  })

  it('כן after רוצה שאסביר? creates ResponseProfile and GPT runs', async () => {
    tableRows.messageList = [inbound('כן'), outbound(EXPLAIN_OFFER), inbound('יש לי עסק')]
    const generateQualify = vi.fn(async () => ({ ok: false as const, skipReason: 'ai_unavailable' as const }))
    await processQualifyJob(JOB, CTX, { send: vi.fn(), generateQualify })
    expect(classifyResponseProfileSpy).toHaveBeenCalledTimes(1)
    expect(generateQualify).toHaveBeenCalledTimes(1)
    expect(lastQualifyArgs(generateQualify).responseProfile).toBeTruthy()
  })

  it('ResponseProfile survives regeneration unchanged', async () => {
    tableRows.messageList = [inbound('מה המחיר?'), outbound(STATEMENT), inbound('יש לי עסק')]
    const generateQualify = vi.fn(async (args: QualifyCallArgs) => {
      if (!args.regenerationReason) {
        return { ...OK_GEN, reply: 'מה המחיר? ומה עוד תרצה לדעת?' }
      }
      return OK_GEN
    })
    const send = vi.fn(async () => ({ ok: true as const, wamid: 'w' }))
    persistOutboundWhatsapp.mockResolvedValue({ messageId: 4001, sequence: 9 })
    await processQualifyJob(JOB, CTX, { send, generateQualify })
    const calls = generateQualify.mock.calls as unknown as Array<[QualifyCallArgs]>
    expect(calls).toHaveLength(2)
    expect(calls[1][0].responseProfile).toEqual(calls[0][0].responseProfile)
    expect(calls[1][0].regenerationReason).toBeTruthy()
  })
})
