/**
 * Task 13 — Contact IRE through the real qualify worker (groups A + G).
 *
 * A durable job whose leadId is NULL belongs to a non-personal WhatsApp Contact.
 * conversationId stays the durable identity: the worker runs the same eligibility,
 * ResponseProfile, validator and send gate a Lead gets, persists the outbound with
 * leadId=NULL, and schedules no Lead-specific no-response warning.
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
const persistOutboundWhatsapp = vi.hoisted(() => vi.fn())
const shadowIngestQualification = vi.hoisted(() => vi.fn())
const shadowReasonAndDecide = vi.hoisted(() => vi.fn())
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
  markEscalated: vi.fn(),
  markHumanActive: vi.fn(),
  markStopped: vi.fn(),
  markClosed: vi.fn(),
}))
vi.mock('@/db/conversationIntelligence', () => ({
  upsertManyConversationIntelligence: vi.fn(),
  getMaxMessageSequence: vi.fn(async () => 1),
  INTEL_KIND_TEMPERATURE: 'temperature',
}))
vi.mock('@/lib/ai/worldModel/shadow', () => ({ shadowIngestQualification, shadowReasonAndDecide }))
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

import { processQualifyJob, type QualifyCtx } from '@/lib/inbox/autoresponse/qualifyWorker'
import type { AutoResponseJob } from '@/db/autoResponseJobs'

/** A Contact job: no Lead yet, conversationId is the identity. */
const CONTACT_JOB: AutoResponseJob = {
  id: 90,
  agencyId: 103,
  conversationId: 1290,
  leadId: null,
  channel: 'whatsapp',
  reason: 'qualify_turn',
  triggerSequence: 1,
  attempts: 1,
  maxAttempts: 3,
  createdAt: new Date().toISOString(),
}

const CONTACT_CTX: QualifyCtx = {
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
    id: 1290,
    businessPhoneNumberId: '972007939322425',
    customerWaId: '972537736636',
    customerName: null,
  },
  lead: { id: null, userId: null, handlerId: null, status: null },
}

const OK_GEN = {
  ok: true as const,
  reply: 'שמח שפנית. מה הכי מפריע לך בניהול הלידים היום?',
  extracted: {},
  objective: 'understand_pain' as const,
  understanding: { pain: null, impact: null, currentWorkflow: null, desiredOutcome: null },
  hotSignal: false,
  uncertain: false,
  salesMove: null,
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

type QualifyCallArgs = {
  responseProfile?: { tone: string; language: string; vocative: string | null }
}

function gen() {
  return vi.fn(async (_args: QualifyCallArgs) => OK_GEN)
}

beforeEach(() => {
  failAutoResponseJob.mockReset().mockResolvedValue(undefined)
  skipAutoResponseJob.mockReset().mockResolvedValue(undefined)
  completeAutoResponseJob.mockReset().mockResolvedValue(undefined)
  countSentToday.mockReset().mockResolvedValue(0)
  enqueueAutoResponse.mockReset().mockResolvedValue(91)
  skipPendingNoResponseJobs.mockReset().mockResolvedValue(0)
  recordTurn.mockReset().mockResolvedValue(undefined)
  persistOutboundWhatsapp.mockReset().mockResolvedValue({ messageId: 5001, sequence: 2 })
  shadowIngestQualification.mockReset().mockResolvedValue(undefined)
  shadowReasonAndDecide.mockReset().mockResolvedValue(undefined)
  getOrCreateAiState.mockReset().mockResolvedValue({
    aiState: 'ai_qualifying',
    aiTurnCount: 0,
    qualification: {},
  })
  tableRows.connections = {
    phone_number_id: '972007939322425',
    access_token: 't',
    user_id: 332,
  }
  tableRows.conversations = { id: 1290, isPersonal: false }
  tableRows.messageList = [inbound('היי שלום')]
})

describe('Task 13 A — an unknown non-personal Contact is answered automatically', () => {
  it('1. "היי שלום" runs GPT and sends, with no Lead anywhere in the path', async () => {
    const send = vi.fn(async () => ({ ok: true as const, wamid: 'wamid.c1' }))
    const generateQualify = gen()

    const outcome = await processQualifyJob(CONTACT_JOB, CONTACT_CTX, { send, generateQualify })

    expect(outcome).toBe('sent')
    expect(generateQualify).toHaveBeenCalledTimes(1)
    expect(send).toHaveBeenCalledTimes(1)
  })

  it('2. "היי אחי מה קורה" mirrors a casual Hebrew register', async () => {
    tableRows.messageList = [inbound('היי אחי מה קורה')]
    const generateQualify = gen()

    await processQualifyJob(CONTACT_JOB, CONTACT_CTX, {
      send: vi.fn(async () => ({ ok: true as const, wamid: 'w' })),
      generateQualify,
    })

    expect(generateQualify).toHaveBeenCalledTimes(1)
    const args = generateQualify.mock.calls[0]![0]
    expect(args.responseProfile?.language).toBe('he')
    expect(args.responseProfile?.tone).toBe('casual')
    expect(args.responseProfile?.vocative).toBe('אחי')
  })

  it('3. "Hello" answers in English', async () => {
    tableRows.messageList = [inbound('Hello')]
    const generateQualify = gen()

    await processQualifyJob(CONTACT_JOB, CONTACT_CTX, {
      send: vi.fn(async () => ({ ok: true as const, wamid: 'w' })),
      generateQualify,
    })

    expect(generateQualify).toHaveBeenCalledTimes(1)
    const args = generateQualify.mock.calls[0]![0]
    expect(args.responseProfile?.language).toBe('en')
  })
})

describe('Task 13 G — Contact job bookkeeping', () => {
  it('29. the outbound is persisted against the conversation with leadId NULL', async () => {
    await processQualifyJob(CONTACT_JOB, CONTACT_CTX, {
      send: vi.fn(async () => ({ ok: true as const, wamid: 'w' })),
      generateQualify: gen(),
    })

    expect(persistOutboundWhatsapp).toHaveBeenCalledTimes(1)
    const persisted = persistOutboundWhatsapp.mock.calls[0]![0] as { leadId: number | null; agencyId: number }
    expect(persisted.leadId).toBeNull()
    expect(persisted.agencyId).toBe(103)
  })

  it('30. a Contact is never given the Lead no-response warning', async () => {
    await processQualifyJob(CONTACT_JOB, CONTACT_CTX, {
      send: vi.fn(async () => ({ ok: true as const, wamid: 'w' })),
      generateQualify: gen(),
    })

    expect(completeAutoResponseJob).toHaveBeenCalledTimes(1)
    const warnings = enqueueAutoResponse.mock.calls.filter(
      (c) => (c[1] as { reason?: string } | undefined)?.reason === 'no_response_warning',
    )
    expect(warnings).toHaveLength(0)
  })

  it('a Lead job on the same path still schedules its warning (no regression)', async () => {
    const leadJob: AutoResponseJob = { ...CONTACT_JOB, leadId: 1417 }
    const leadCtx: QualifyCtx = {
      ...CONTACT_CTX,
      lead: { id: 1417, userId: 332, handlerId: null, status: 'new' },
    }

    await processQualifyJob(leadJob, leadCtx, {
      send: vi.fn(async () => ({ ok: true as const, wamid: 'w' })),
      generateQualify: gen(),
    })

    const warnings = enqueueAutoResponse.mock.calls.filter(
      (c) => (c[1] as { reason?: string } | undefined)?.reason === 'no_response_warning',
    )
    expect(warnings).toHaveLength(1)
  })

  it('Contact turns do not write Lead-scoped World Model shadow rows', async () => {
    await processQualifyJob(CONTACT_JOB, CONTACT_CTX, {
      send: vi.fn(async () => ({ ok: true as const, wamid: 'w' })),
      generateQualify: gen(),
    })

    expect(shadowIngestQualification).not.toHaveBeenCalled()
    expect(shadowReasonAndDecide).not.toHaveBeenCalled()
  })
})

describe('Task 13 G32 — a personal flag set mid-flight wins over a stale read', () => {
  it('32. the pre-Graph re-read aborts the outbound', async () => {
    const send = vi.fn(async () => ({ ok: true as const, wamid: 'w' }))
    // Eligibility ran against a non-personal conversation; the user marks it
    // personal before the Graph call. The gate re-reads and refuses.
    tableRows.conversations = { id: 1290, isPersonal: true }

    const outcome = await processQualifyJob(CONTACT_JOB, CONTACT_CTX, {
      send,
      generateQualify: gen(),
    })

    expect(send).not.toHaveBeenCalled()
    expect(persistOutboundWhatsapp).not.toHaveBeenCalled()
    expect(outcome).toBe('skipped')
    expect(skipAutoResponseJob).toHaveBeenCalledWith(90, 'personal')
  })

  it('a deleted conversation also fails closed', async () => {
    const send = vi.fn(async () => ({ ok: true as const, wamid: 'w' }))
    tableRows.conversations = null

    await processQualifyJob(CONTACT_JOB, CONTACT_CTX, { send, generateQualify: gen() })

    expect(send).not.toHaveBeenCalled()
    expect(skipAutoResponseJob).toHaveBeenCalledWith(90, 'conversation_gone')
  })
})
