/**
 * Task 13 — worker routing and safety for Contact jobs (groups B + E + G).
 *
 * "Can the AI respond?" is decided by the server before GPT. A personal
 * conversation is never answered, a Contact job is never mistaken for a dead
 * Lead, and the Lead decision tree is untouched.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { resolveInboundLeadDecision } from '@/lib/whatsapp/resolveInboundLead'
import { isPositiveLeadId } from '@/lib/inbox/autoresponse/contactJob'

const claimAutoResponseJobs = vi.hoisted(() => vi.fn())
const reclaimStaleAutoResponseJobs = vi.hoisted(() => vi.fn())
const completeAutoResponseJob = vi.hoisted(() => vi.fn())
const skipAutoResponseJob = vi.hoisted(() => vi.fn())
const failAutoResponseJob = vi.hoisted(() => vi.fn())
const countSentToday = vi.hoisted(() => vi.fn())
const hasSentFirstContact = vi.hoisted(() => vi.fn())
const getMasterEnabled = vi.hoisted(() => vi.fn())
const getChannelSettings = vi.hoisted(() => vi.fn())
const persistOutboundWhatsapp = vi.hoisted(() => vi.fn())
const processQualifyJob = vi.hoisted(() => vi.fn())
const processNoResponseJob = vi.hoisted(() => vi.fn())
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
vi.mock('@/lib/inbox/autoresponse/qualifyWorker', () => ({ processQualifyJob }))
vi.mock('@/lib/inbox/autoresponse/processNoResponseJob', () => ({ processNoResponseJob }))
vi.mock('@/db/autoResponseJobs', () => ({
  claimAutoResponseJobs,
  reclaimStaleAutoResponseJobs,
  completeAutoResponseJob,
  skipAutoResponseJob,
  failAutoResponseJob,
  countSentToday,
  hasSentFirstContact,
  enqueueAutoResponse: vi.fn(),
  deferAutoResponseJob: vi.fn(),
  skipPendingNoResponseJobs: vi.fn(),
  // The worker's lease heartbeat and pre-send fence: this worker still owns its jobs.
  renewAutoResponseJobLease: vi.fn(async () => true),
  ownsAutoResponseJob: vi.fn(async () => true),
}))
vi.mock('@/db/autoResponseSettings', () => ({ getMasterEnabled, getChannelSettings }))
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

import { runAutoResponseWorker } from '@/lib/inbox/autoresponse/worker'
import type { AutoResponseJob } from '@/db/autoResponseJobs'

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

beforeEach(() => {
  claimAutoResponseJobs.mockReset().mockResolvedValue([CONTACT_JOB])
  reclaimStaleAutoResponseJobs.mockReset().mockResolvedValue(0)
  completeAutoResponseJob.mockReset().mockResolvedValue(undefined)
  skipAutoResponseJob.mockReset().mockResolvedValue(undefined)
  failAutoResponseJob.mockReset().mockResolvedValue(undefined)
  countSentToday.mockReset().mockResolvedValue(0)
  hasSentFirstContact.mockReset().mockResolvedValue(false)
  getMasterEnabled.mockReset().mockResolvedValue(true)
  persistOutboundWhatsapp.mockReset().mockResolvedValue({ messageId: 5001 })
  processQualifyJob.mockReset().mockResolvedValue('sent')
  processNoResponseJob.mockReset().mockResolvedValue('sent')
  getChannelSettings.mockReset().mockResolvedValue({
    enabled: true,
    mode: 'qualify',
    replyMode: 'ai',
    fixedBody: null,
    dailyCap: 200,
    quietHours: {},
    guidance: null,
    maxTurns: 5,
    collectFields: { required: [], optional: [] },
    draft: false,
    delaySeconds: 5,
  })
  tableRows.conversations = {
    id: 1290,
    businessPhoneNumberId: '972007939322425',
    customerWaId: '972537736636',
    customerName: null,
    lastMessageText: 'היי שלום',
    isPersonal: false,
    leadId: null,
  }
  tableRows.clients = null
  tableRows.connections = { phone_number_id: '972007939322425', access_token: 't', user_id: 332 }
  tableRows.messageList = []
})

describe('Task 13 — a Contact job is not a dead Lead', () => {
  it('leadId NULL routes into the qualify pipeline instead of skipping lead_gone', async () => {
    const summary = await runAutoResponseWorker({ deps: { send: vi.fn() } as never })

    expect(processQualifyJob).toHaveBeenCalledTimes(1)
    expect(skipAutoResponseJob).not.toHaveBeenCalled()
    expect(summary.sent).toBe(1)

    const ctx = processQualifyJob.mock.calls[0]![1] as { lead: { id: number | null } }
    expect(ctx.lead.id).toBeNull()
  })

  it('a Lead job whose Lead really is gone still skips lead_gone (no regression)', async () => {
    claimAutoResponseJobs.mockResolvedValue([{ ...CONTACT_JOB, leadId: 1417 }])
    tableRows.clients = null

    await runAutoResponseWorker({ deps: { send: vi.fn() } as never })

    expect(processQualifyJob).not.toHaveBeenCalled()
    expect(skipAutoResponseJob).toHaveBeenCalledWith(90, 'lead_gone')
  })

  it('31. once the conversation has been promoted, the Contact job adopts that Lead', async () => {
    tableRows.conversations = { ...(tableRows.conversations as object), leadId: 1417 }
    tableRows.clients = { id: 1417, userId: 332, handlerId: null, status: 'new', firstName: 'דוד' }

    await runAutoResponseWorker({ deps: { send: vi.fn() } as never })

    expect(processQualifyJob).toHaveBeenCalledTimes(1)
    const job = processQualifyJob.mock.calls[0]![0] as AutoResponseJob
    const ctx = processQualifyJob.mock.calls[0]![1] as { lead: { id: number | null } }
    // One job, now Lead-scoped: no duplicate Lead and no duplicate job.
    expect(job.leadId).toBe(1417)
    expect(ctx.lead.id).toBe(1417)
  })
})

describe('Task 13 B9 — a personal conversation is never answered', () => {
  it('personal skips before any GPT or outbound', async () => {
    tableRows.conversations = { ...(tableRows.conversations as object), isPersonal: true }
    const send = vi.fn()

    const summary = await runAutoResponseWorker({ deps: { send } as never })

    expect(processQualifyJob).not.toHaveBeenCalled()
    expect(send).not.toHaveBeenCalled()
    expect(persistOutboundWhatsapp).not.toHaveBeenCalled()
    expect(skipAutoResponseJob).toHaveBeenCalledWith(90, 'personal')
    expect(summary.sent).toBe(0)
  })

  it('personal wins for a Lead job too', async () => {
    claimAutoResponseJobs.mockResolvedValue([{ ...CONTACT_JOB, leadId: 1417 }])
    tableRows.clients = { id: 1417, userId: 332, handlerId: null, status: 'new', firstName: 'דוד' }
    tableRows.conversations = { ...(tableRows.conversations as object), isPersonal: true }

    await runAutoResponseWorker({ deps: { send: vi.fn() } as never })

    expect(processQualifyJob).not.toHaveBeenCalled()
    expect(skipAutoResponseJob).toHaveBeenCalledWith(90, 'personal')
  })
})

describe('Task 13 G30 — the Lead no-response lifecycle does not run for Contacts', () => {
  it.each(['no_response_warning', 'no_response_close'] as const)(
    'a Contact %s job is skipped, not sent',
    async (reason) => {
      claimAutoResponseJobs.mockResolvedValue([{ ...CONTACT_JOB, reason }])

      await runAutoResponseWorker({ deps: { send: vi.fn() } as never })

      expect(processNoResponseJob).not.toHaveBeenCalled()
      expect(skipAutoResponseJob).toHaveBeenCalledWith(90, 'contact_no_response')
    },
  )

  it('the same job for a real Lead still runs the lifecycle (no regression)', async () => {
    claimAutoResponseJobs.mockResolvedValue([
      { ...CONTACT_JOB, leadId: 1417, reason: 'no_response_warning' as const },
    ])
    tableRows.clients = { id: 1417, userId: 332, handlerId: null, status: 'new', firstName: 'דוד' }

    await runAutoResponseWorker({ deps: { send: vi.fn() } as never })

    expect(processNoResponseJob).toHaveBeenCalledTimes(1)
  })
})

describe('Task 13 E — the existing Lead decision tree is unchanged', () => {
  it('17. a remembered Lead still wins', () => {
    expect(
      resolveInboundLeadDecision({
        isPersonal: false,
        leadId: 1417,
        matchingLeadIds: [],
        hasCtwaReferral: false,
      }),
    ).toEqual({ kind: 'remembered_lead', leadId: 1417 })
  })

  it('18. a single phone match still auto-links', () => {
    expect(
      resolveInboundLeadDecision({
        isPersonal: false,
        leadId: null,
        matchingLeadIds: [1417],
        hasCtwaReferral: false,
      }),
    ).toEqual({ kind: 'auto_link', leadId: 1417 })
  })

  it('19. multiple matches still refuse to guess', () => {
    expect(
      resolveInboundLeadDecision({
        isPersonal: false,
        leadId: null,
        matchingLeadIds: [1417, 1418],
        hasCtwaReferral: false,
      }),
    ).toEqual({ kind: 'contact' })
  })

  it('personal still short-circuits the whole tree', () => {
    expect(
      resolveInboundLeadDecision({
        isPersonal: true,
        leadId: 1417,
        matchingLeadIds: [1417],
        hasCtwaReferral: true,
      }),
    ).toEqual({ kind: 'personal' })
  })

  it('CTWA still auto-creates', () => {
    expect(
      resolveInboundLeadDecision({
        isPersonal: false,
        leadId: null,
        matchingLeadIds: [],
        hasCtwaReferral: true,
      }),
    ).toEqual({ kind: 'auto_create_ctwa' })
  })
})

describe('Task 13 — Contact job identity predicate', () => {
  it('only a real Lead id counts', () => {
    expect(isPositiveLeadId(1417)).toBe(true)
    expect(isPositiveLeadId(null)).toBe(false)
    expect(isPositiveLeadId(undefined)).toBe(false)
    expect(isPositiveLeadId(0)).toBe(false)
    expect(isPositiveLeadId(-1)).toBe(false)
    expect(isPositiveLeadId(Number.NaN)).toBe(false)
  })
})
