/**
 * IRE Graph-send paths must record account restrictions immediately and
 * finalize the job as dead — never pending/backoff retry.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const recordAccountRestriction = vi.hoisted(() => vi.fn())
const deadLetterAutoResponseJob = vi.hoisted(() => vi.fn())
const failAutoResponseJob = vi.hoisted(() => vi.fn())
const skipAutoResponseJob = vi.hoisted(() => vi.fn())
const completeAutoResponseJob = vi.hoisted(() => vi.fn())
const claimAutoResponseJobs = vi.hoisted(() => vi.fn())
const reclaimStaleAutoResponseJobs = vi.hoisted(() => vi.fn())
const countSentToday = vi.hoisted(() => vi.fn())
const hasSentFirstContact = vi.hoisted(() => vi.fn())
const getMasterEnabled = vi.hoisted(() => vi.fn())
const getChannelSettings = vi.hoisted(() => vi.fn())
const getOrCreateAiState = vi.hoisted(() => vi.fn())
const tableRows = vi.hoisted(() => ({
  conversations: null as unknown,
  clients: null as unknown,
  messages: null as unknown,
  connections: null as unknown,
  jobs: null as unknown,
  messageList: [] as unknown[],
}))

vi.mock('@/lib/inbox/recordAccountRestriction', () => ({ recordAccountRestriction }))
vi.mock('@/lib/analytics/track', () => ({ track: vi.fn() }))
vi.mock('@/lib/inbox/persistOutboundWhatsapp', () => ({ persistOutboundWhatsapp: vi.fn() }))
vi.mock('@/lib/inbox/autoresponse/waTrace', () => ({ waTrace: vi.fn() }))
vi.mock('@/db/autoResponseJobs', () => ({
  deadLetterAutoResponseJob,
  failAutoResponseJob,
  skipAutoResponseJob,
  completeAutoResponseJob,
  claimAutoResponseJobs,
  reclaimStaleAutoResponseJobs,
  countSentToday,
  hasSentFirstContact,
  enqueueAutoResponse: vi.fn(),
  deferAutoResponseJob: vi.fn(),
  skipPendingNoResponseJobs: vi.fn(),
}))
vi.mock('@/db/autoResponseSettings', () => ({
  getMasterEnabled,
  getChannelSettings,
}))
vi.mock('@/db/conversationAiState', () => ({
  getOrCreateAiState,
  recordTurn: vi.fn(),
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
  const db = Object.assign((table: string) => chainFor(table), {
    raw: (sql: string) => sql,
    fn: { now: () => new Date() },
    transaction: async (fn: (trx: unknown) => unknown) => fn({}),
  })
  return { db }
})

import { runAutoResponseWorker } from '@/lib/inbox/autoresponse/worker'
import { processQualifyJob } from '@/lib/inbox/autoresponse/qualifyWorker'
import { respondPostHandoff } from '@/lib/inbox/autoresponse/postHandoff'
import type { AutoResponseJob } from '@/db/autoResponseJobs'

const JOB: AutoResponseJob = {
  id: 44,
  agencyId: 23,
  conversationId: 8,
  leadId: 9,
  channel: 'whatsapp',
  reason: 'first_contact',
  triggerSequence: 1,
  attempts: 1,
  maxAttempts: 3,
  createdAt: new Date().toISOString(),
}

const ACCOUNT_FAIL = { ok: false as const, error: 'restricted', code: '131031', httpStatus: 400 }

beforeEach(() => {
  recordAccountRestriction.mockReset().mockResolvedValue(undefined)
  deadLetterAutoResponseJob.mockReset().mockResolvedValue(undefined)
  failAutoResponseJob.mockReset().mockResolvedValue(undefined)
  skipAutoResponseJob.mockReset().mockResolvedValue(undefined)
  completeAutoResponseJob.mockReset().mockResolvedValue(undefined)
  claimAutoResponseJobs.mockReset()
  reclaimStaleAutoResponseJobs.mockReset().mockResolvedValue(0)
  countSentToday.mockReset().mockResolvedValue(0)
  hasSentFirstContact.mockReset().mockResolvedValue(false)
  getMasterEnabled.mockReset().mockResolvedValue(true)
  getOrCreateAiState.mockReset().mockResolvedValue({
    aiState: 'new',
    aiTurnCount: 0,
    qualification: {},
  })
  tableRows.conversations = {
    id: 8,
    businessPhoneNumberId: 'P1',
    customerWaId: '972500000000',
    customerName: 'דוד',
    lastMessageText: 'היי',
  }
  tableRows.clients = { id: 9, userId: 1, handlerId: null, status: 'new', firstName: 'דוד' }
  tableRows.connections = { phone_number_id: 'P1', access_token: 't', user_id: 1 }
  tableRows.messages = null
  tableRows.jobs = { status: 'dead', skipReason: null, lastError: 'x', sentMessageId: null }
  tableRows.messageList = [
    {
      direction: 'inbound',
      text: 'היי',
      sentByUserId: null,
      channelTimestamp: new Date(),
      createdAt: new Date(),
      metadata: null,
    },
  ]
})

describe('IRE first-contact + 131031', () => {
  it('records restriction, dead-letters, does not retry', async () => {
    getChannelSettings.mockResolvedValue({
      enabled: true,
      mode: 'acknowledge',
      replyMode: 'fixed',
      fixedBody: 'שלום, איך אפשר לעזור?',
      dailyCap: 100,
      quietHours: {},
      guidance: null,
      agentInstructions: null,
      businessProfile: null,
      maxTurns: 5,
      collectFields: { required: [], optional: [] },
      draft: false,
    })
    claimAutoResponseJobs.mockResolvedValue([JOB])
    const send = vi.fn(async () => ACCOUNT_FAIL)

    const summary = await runAutoResponseWorker({ deps: { send } as never })

    expect(summary.failed).toBe(1)
    expect(recordAccountRestriction).toHaveBeenCalledWith(
      expect.objectContaining({ agencyId: 23, businessPhoneNumberId: 'P1', leadId: 9 }),
    )
    expect(deadLetterAutoResponseJob).toHaveBeenCalledWith(44, expect.stringContaining('131031'), expect.stringMatching(/^arw-/))
    expect(failAutoResponseJob).not.toHaveBeenCalled()
    expect(completeAutoResponseJob).not.toHaveBeenCalled()
  })
})

describe('IRE qualify / handoff + 131031', () => {
  it('records restriction, dead-letters, does not retry', async () => {
    const send = vi.fn(async () => ACCOUNT_FAIL)
    const generateQualify = vi.fn(async () => ({
      ok: true as const,
      reply: 'איך קוראים לך?',
      extracted: {},
      corrected: [],
      objective: 'discover_need' as const,
      understanding: { pain: null, impact: null, currentWorkflow: null, desiredOutcome: null },
      hotSignal: false,
      uncertain: false,
      salesMove: null,
    }))

    const outcome = await processQualifyJob(
      { ...JOB, reason: 'qualify_turn', ownerWorkerId: 'w-1' },
      {
        master: true,
        settings: {
          agencyId: 23,
          channel: 'whatsapp',
          enabled: true,
          quietHours: {},
          dailyCap: 100,
          guidance: null,
          agentInstructions: null,
          businessProfile: null,
          mode: 'qualify',
          maxTurns: 10,
          collectFields: { required: ['name'], optional: [] },
          draft: false,
          replyMode: 'ai',
          fixedBody: null,
          delaySeconds: 0,
        },
        conv: {
          id: 8,
          businessPhoneNumberId: 'P1',
          customerWaId: '972500000000',
          customerName: 'דוד',
        },
        lead: { id: 9, userId: 1, handlerId: null, status: 'new' },
      },
      { send, generateQualify },
    )

    expect(outcome).toBe('failed')
    expect(recordAccountRestriction).toHaveBeenCalledWith(
      expect.objectContaining({ agencyId: 23, businessPhoneNumberId: 'P1', leadId: 9 }),
    )
    expect(deadLetterAutoResponseJob).toHaveBeenCalledWith(44, expect.stringContaining('131031'), 'w-1')
    expect(failAutoResponseJob).not.toHaveBeenCalled()
  })
})

describe('IRE post-handoff + 131031', () => {
  it('records restriction, dead-letters, does not retry', async () => {
    const send = vi.fn(async () => ACCOUNT_FAIL)
    const generate = vi.fn(async () => ({
      ok: true as const,
      reply: 'תודה, נציג יחזור אליך.',
      deferred: false,
    }))

    const outcome = await respondPostHandoff({
      job: { ...JOB, ownerWorkerId: 'w-1' },
      ctx: {
        master: true,
        settings: {
          agencyId: 23,
          channel: 'whatsapp',
          enabled: true,
          quietHours: {},
          dailyCap: 100,
          guidance: null,
          agentInstructions: null,
          businessProfile: null,
          mode: 'qualify',
          maxTurns: 10,
          collectFields: { required: [], optional: [] },
          draft: false,
          replyMode: 'ai',
          fixedBody: null,
          delaySeconds: 0,
        },
        conv: {
          id: 8,
          businessPhoneNumberId: 'P1',
          customerWaId: '972500000000',
          customerName: 'דוד',
        },
        lead: { id: 9, userId: 1, handlerId: null, status: 'new' },
      },
      deps: { send, generate },
      recent: [{ direction: 'inbound', text: 'תודה' }],
      lastInbound: { text: 'תודה' },
      guidance: null,
      sentToday: 0,
      dailyCap: 100,
      withinQuietHours: false,
      withinWindow: true,
      hasUnansweredInbound: true,
      budgetUsed: 0,
    })

    expect(outcome).toBe('failed')
    expect(recordAccountRestriction).toHaveBeenCalledWith(
      expect.objectContaining({ agencyId: 23, businessPhoneNumberId: 'P1', leadId: 9 }),
    )
    expect(deadLetterAutoResponseJob).toHaveBeenCalledWith(44, expect.stringContaining('131031'), 'w-1')
    expect(failAutoResponseJob).not.toHaveBeenCalled()
  })
})
