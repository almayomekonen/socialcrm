/**
 * PRODUCTION REGRESSION, at the worker — conversation 6694, agency 103.
 *
 * The gate-level test next door proves the eligibility decision changed. This
 * one drives `processQualifyJob` over the same four messages and proves what the
 * customer would actually have seen: a second inbound reaches generation,
 * validation and the outbound send, and the job completes rather than recording
 * `gpt_wait_NO_MEANINGFUL_INTENT`.
 *
 * It also pins the protections around the widened gate — human takeover,
 * opt-out and one-send-per-job — because a gate that now says RUN_AI more often
 * is exactly when those matter most.
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
const markHumanActive = vi.hoisted(() => vi.fn())
const markStopped = vi.hoisted(() => vi.fn())
const persistOutboundWhatsapp = vi.hoisted(() => vi.fn())
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
  markHumanActive,
  markStopped,
  markClosed,
  saveConversationSummary: vi.fn(),
}))
vi.mock('@/db/conversationIntelligence', () => ({
  upsertManyConversationIntelligence: vi.fn(),
  getMaxMessageSequence: vi.fn(async () => 4),
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

import { processQualifyJob, type QualifyCtx } from '@/lib/inbox/autoresponse/qualifyWorker'
import type { AutoResponseJob } from '@/db/autoResponseJobs'

const JOB: AutoResponseJob = {
  id: 2366,
  agencyId: 103,
  conversationId: 6694,
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
    guidance: 'SocialCRM מרכזת לידים מוואטסאפ ומפייסבוק במקום אחד, עם סטטוס ומעקב.',
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
  conv: {
    id: 6694,
    businessPhoneNumberId: '972007939322425',
    customerWaId: '972535316943',
    customerName: 'לקוח',
  },
  lead: { id: 1417, userId: 332, handlerId: null, status: 'new' },
}

const GREETING_OUTBOUND = 'היי, ברוך הבא למנכל SocialCrm 👋\nהכול טוב, מה רצית לדעת על המערכת?'
const THE_MESSAGE = 'היי אשמח לקבל פרטים על המערכת שלכם'

const OK_GEN = {
  ok: true as const,
  reply: 'המערכת מרכזת לידים מוואטסאפ ומפייסבוק במקום אחד. מה הכי מפריע לך היום?',
  extracted: {},
  corrected: [],
  objective: 'understand_pain' as const,
  understanding: { pain: null, impact: null, currentWorkflow: null, desiredOutcome: null },
  hotSignal: false,
  uncertain: false,
  salesMove: null,
}

const msg = (direction: 'inbound' | 'outbound', text: string, metadata: unknown = null) => ({
  direction,
  text,
  sentByUserId: null,
  channelTimestamp: new Date(),
  createdAt: new Date(),
  metadata,
})

/** The production transcript. The worker reads newest-first. */
const CONV_6694 = [
  msg('inbound', THE_MESSAGE),
  msg('outbound', GREETING_OUTBOUND, { source: 'auto_response' }),
  msg('inbound', 'יחרא'),
  msg('inbound', 'היי מה קורה?'),
]

const skipReasons = () => skipAutoResponseJob.mock.calls.map((c) => String(c[1] ?? ''))

describe('processQualifyJob over conversation 6694', () => {
  beforeEach(() => {
    failAutoResponseJob.mockReset().mockResolvedValue(undefined)
    skipAutoResponseJob.mockReset().mockResolvedValue(undefined)
    completeAutoResponseJob.mockReset().mockResolvedValue(undefined)
    countSentToday.mockReset().mockResolvedValue(1)
    enqueueAutoResponse.mockReset().mockResolvedValue(77)
    skipPendingNoResponseJobs.mockReset().mockResolvedValue(1)
    recordTurn.mockReset().mockResolvedValue(undefined)
    markClosed.mockReset().mockResolvedValue(undefined)
    markEscalated.mockReset().mockResolvedValue(undefined)
    markHumanActive.mockReset().mockResolvedValue(undefined)
    markStopped.mockReset().mockResolvedValue(undefined)
    persistOutboundWhatsapp.mockReset().mockResolvedValue({ messageId: 4001, sequence: 5 })
    getOrCreateAiState.mockReset().mockResolvedValue({
      aiState: 'ai_qualifying',
      aiTurnCount: 1,
      qualification: {},
    })
    tableRows.connections = { phone_number_id: '972007939322425', access_token: 't', user_id: 332 }
    tableRows.conversations = { id: 6694, isPersonal: false }
    tableRows.messageList = CONV_6694
  })

  it('REGRESSION: the second inbound is answered instead of skipped', async () => {
    const generateQualify = vi.fn(async () => OK_GEN)
    const send = vi.fn(async () => ({ ok: true as const, wamid: 'wamid.test' }))

    const outcome = await processQualifyJob(JOB, CTX, { send, generateQualify })

    expect(skipReasons(), 'the production skip reason came back').not.toContain(
      'gpt_wait_NO_MEANINGFUL_INTENT',
    )
    expect(generateQualify, 'generation was never reached').toHaveBeenCalledTimes(1)
    expect(outcome).toBe('sent')
  })

  it('the reply reaches the customer exactly once, and the job completes', async () => {
    const generateQualify = vi.fn(async () => OK_GEN)
    const send = vi.fn(async () => ({ ok: true as const, wamid: 'wamid.test' }))

    await processQualifyJob(JOB, CTX, { send, generateQualify })

    expect(send).toHaveBeenCalledTimes(1)
    expect(persistOutboundWhatsapp).toHaveBeenCalledTimes(1)
    expect(completeAutoResponseJob).toHaveBeenCalledTimes(1)
    expect(completeAutoResponseJob).toHaveBeenCalledWith(JOB.id, 4001)
  })

  it('it does not greet again — the agent already said hello at 16:07', async () => {
    const generateQualify = vi.fn(async () => OK_GEN)
    const send = vi.fn(async () => ({ ok: true as const, wamid: 'wamid.test' }))

    await processQualifyJob(JOB, CTX, { send, generateQualify })

    const sentText = String((send.mock.calls[0] as unknown[])?.slice(-1)[0] ?? JSON.stringify(send.mock.calls[0]))
    expect(sentText).not.toContain('ברוך הבא')
  })
})

describe('the protections around the widened gate still hold', () => {
  beforeEach(() => {
    skipAutoResponseJob.mockReset().mockResolvedValue(undefined)
    completeAutoResponseJob.mockReset().mockResolvedValue(undefined)
    countSentToday.mockReset().mockResolvedValue(1)
    skipPendingNoResponseJobs.mockReset().mockResolvedValue(1)
    markHumanActive.mockReset().mockResolvedValue(undefined)
    markStopped.mockReset().mockResolvedValue(undefined)
    persistOutboundWhatsapp.mockReset().mockResolvedValue({ messageId: 4002, sequence: 5 })
    getOrCreateAiState.mockReset().mockResolvedValue({
      aiState: 'ai_qualifying',
      aiTurnCount: 1,
      qualification: {},
    })
    tableRows.connections = { phone_number_id: '972007939322425', access_token: 't', user_id: 332 }
    tableRows.conversations = { id: 6694, isPersonal: false }
  })

  it('a human reply stops the agent, even on an information request', async () => {
    // Same message, but a rep answered by hand in between: metadata.source is
    // not auto_response. The agent must go quiet and stay quiet.
    tableRows.messageList = [
      msg('inbound', THE_MESSAGE),
      msg('outbound', 'היי, אני אלמיו, אשמח לעזור', { source: 'manual' }),
      msg('inbound', 'היי מה קורה?'),
    ]
    const generateQualify = vi.fn()
    const send = vi.fn()

    await processQualifyJob(JOB, CTX, { send, generateQualify })

    expect(generateQualify).not.toHaveBeenCalled()
    expect(send).not.toHaveBeenCalled()
    expect(markHumanActive).toHaveBeenCalled()
  })

  it('an opt-out stops the agent, and an information request in the same breath does not override it', async () => {
    tableRows.messageList = [
      msg('inbound', 'תפסיקו לשלוח לי הודעות'),
      msg('outbound', GREETING_OUTBOUND, { source: 'auto_response' }),
      msg('inbound', 'היי מה קורה?'),
    ]
    const generateQualify = vi.fn()
    const send = vi.fn()

    await processQualifyJob(JOB, CTX, { send, generateQualify })

    expect(generateQualify).not.toHaveBeenCalled()
    expect(send).not.toHaveBeenCalled()
    expect(markStopped).toHaveBeenCalled()
  })

  it('a request for a human is a handoff, not a generated answer', async () => {
    tableRows.messageList = [
      msg('inbound', 'אפשר לדבר עם נציג'),
      msg('outbound', GREETING_OUTBOUND, { source: 'auto_response' }),
      msg('inbound', 'היי מה קורה?'),
    ]
    const generateQualify = vi.fn()
    const send = vi.fn(async () => ({ ok: true as const, wamid: 'w' }))

    await processQualifyJob(JOB, CTX, { send, generateQualify })

    expect(generateQualify).not.toHaveBeenCalled()
  })
})
