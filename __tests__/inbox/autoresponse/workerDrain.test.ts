/**
 * Drain behaviour: the worker only processes what claimAutoResponseJobs returns.
 * Claim SQL (`pending` AND `notBefore <= now()`, SKIP LOCKED) is the due-gate;
 * a second pass cannot send again once the job is no longer pending.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

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
  claimAutoResponseJobs,
  reclaimStaleAutoResponseJobs,
  completeAutoResponseJob,
  skipAutoResponseJob,
  failAutoResponseJob,
  countSentToday,
  hasSentFirstContact,
}))
vi.mock('@/db/autoResponseSettings', () => ({
  getMasterEnabled,
  getChannelSettings,
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
    }),
  }
})

import { runAutoResponseWorker } from '@/lib/inbox/autoresponse/worker'
import type { AutoResponseJob } from '@/db/autoResponseJobs'

const JOB: AutoResponseJob = {
  id: 39,
  agencyId: 103,
  conversationId: 340,
  leadId: 1324,
  channel: 'whatsapp',
  reason: 'first_contact',
  triggerSequence: 1,
  attempts: 1,
  maxAttempts: 3,
  createdAt: new Date().toISOString(),
}

beforeEach(() => {
  claimAutoResponseJobs.mockReset()
  reclaimStaleAutoResponseJobs.mockReset().mockResolvedValue(0)
  completeAutoResponseJob.mockReset().mockResolvedValue(undefined)
  skipAutoResponseJob.mockReset().mockResolvedValue(undefined)
  failAutoResponseJob.mockReset().mockResolvedValue(undefined)
  countSentToday.mockReset().mockResolvedValue(0)
  hasSentFirstContact.mockReset().mockResolvedValue(false)
  getMasterEnabled.mockReset().mockResolvedValue(true)
  persistOutboundWhatsapp.mockReset().mockResolvedValue({ messageId: 3321 })
  getChannelSettings.mockReset().mockResolvedValue({
    enabled: true,
    mode: 'acknowledge',
    replyMode: 'fixed',
    fixedBody: 'שלום, קיבלנו את ההודעה',
    dailyCap: 200,
    quietHours: {},
    guidance: null,
    maxTurns: 5,
    collectFields: { required: [], optional: [] },
    draft: false,
    delaySeconds: 5,
  })
  tableRows.conversations = {
    id: 340,
    businessPhoneNumberId: '972007939322425',
    customerWaId: '972537736636',
    customerName: 'Fasika',
    lastMessageText: '?',
  }
  tableRows.clients = { id: 1324, userId: 332, handlerId: null, status: 'new', firstName: 'Fasika' }
  tableRows.connections = { phone_number_id: '972007939322425', access_token: 't', user_id: 332 }
  tableRows.messages = null
  tableRows.jobs = { status: 'sent', skipReason: null, lastError: null, sentMessageId: 3321 }
  tableRows.messageList = []
})

describe('IRE worker drain', () => {
  it('does not send when claim returns nothing (job not yet due)', async () => {
    claimAutoResponseJobs.mockResolvedValue([])
    const send = vi.fn()
    const summary = await runAutoResponseWorker({ deps: { send } as never })
    expect(summary).toEqual({ claimed: 0, sent: 0, skipped: 0, failed: 0 })
    expect(send).not.toHaveBeenCalled()
    expect(completeAutoResponseJob).not.toHaveBeenCalled()
  })

  it('sends once when claim returns a due job', async () => {
    claimAutoResponseJobs.mockResolvedValue([JOB])
    const send = vi.fn(async () => ({ ok: true, wamid: 'wamid.out' }))
    const summary = await runAutoResponseWorker({ deps: { send } as never })
    expect(summary.claimed).toBe(1)
    expect(summary.sent).toBe(1)
    expect(send).toHaveBeenCalledTimes(1)
    expect(completeAutoResponseJob).toHaveBeenCalledWith(39, 3321)
  })

  it('a second drain cannot send twice for the same job', async () => {
    const send = vi.fn(async () => ({ ok: true, wamid: 'wamid.out' }))
    claimAutoResponseJobs.mockResolvedValueOnce([JOB]).mockResolvedValueOnce([])

    const first = await runAutoResponseWorker({ deps: { send } as never })
    const second = await runAutoResponseWorker({ deps: { send } as never })

    expect(first.sent).toBe(1)
    expect(second).toEqual({ claimed: 0, sent: 0, skipped: 0, failed: 0 })
    expect(send).toHaveBeenCalledTimes(1)
    expect(completeAutoResponseJob).toHaveBeenCalledTimes(1)
  })

  it('acknowledge ai_unavailable retries via failAutoResponseJob and does not send', async () => {
    getChannelSettings.mockResolvedValue({
      enabled: true,
      mode: 'acknowledge',
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
    claimAutoResponseJobs.mockResolvedValue([JOB])
    const send = vi.fn()
    const generate = vi.fn(async () => ({ ok: false as const, skipReason: 'ai_unavailable' as const }))
    const summary = await runAutoResponseWorker({ deps: { send, generate } as never })
    expect(summary).toEqual({ claimed: 1, sent: 0, skipped: 0, failed: 1 })
    expect(failAutoResponseJob).toHaveBeenCalledWith(39, 'ai_unavailable')
    expect(skipAutoResponseJob).not.toHaveBeenCalled()
    expect(send).not.toHaveBeenCalled()
  })

  it('acknowledge budget_exhausted stays a terminal skip', async () => {
    getChannelSettings.mockResolvedValue({
      enabled: true,
      mode: 'acknowledge',
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
    claimAutoResponseJobs.mockResolvedValue([JOB])
    const send = vi.fn()
    const generate = vi.fn(async () => ({ ok: false as const, skipReason: 'budget_exhausted' as const }))
    const summary = await runAutoResponseWorker({ deps: { send, generate } as never })
    expect(summary.skipped).toBe(1)
    expect(skipAutoResponseJob).toHaveBeenCalledWith(39, 'budget_exhausted')
    expect(failAutoResponseJob).not.toHaveBeenCalled()
    expect(send).not.toHaveBeenCalled()
  })
})
