import fs from 'fs'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  decideNoResponseJob,
  isNoResponseSystemKind,
  isTerminalOutboundText,
  nextAllowedAfterQuietHours,
  NO_RESPONSE_CLOSE_DELAY_SECONDS,
  NO_RESPONSE_CLOSED_STATE_REASON,
  NO_RESPONSE_CLOSED_TEXT,
  NO_RESPONSE_WARNING_DELAY_SECONDS,
  NO_RESPONSE_WARNING_TEXT,
  withinQuietHours,
  type NoResponseFacts,
} from '@/lib/inbox/autoresponse/noResponseClose'
import { conversationCloser, countConsecutiveAiOutbounds } from '@/lib/inbox/autoresponse/conversationControl'

const enqueueAutoResponse = vi.hoisted(() => vi.fn())
const skipAutoResponseJob = vi.hoisted(() => vi.fn())
const completeAutoResponseJob = vi.hoisted(() => vi.fn())
const deferAutoResponseJob = vi.hoisted(() => vi.fn())
const skipPendingNoResponseJobs = vi.hoisted(() => vi.fn())
const getOrCreateAiState = vi.hoisted(() => vi.fn())
const markClosed = vi.hoisted(() => vi.fn())
const sendIreOutbound = vi.hoisted(() => vi.fn())
const generateQualifyTurn = vi.hoisted(() => vi.fn())
const tableRows = vi.hoisted(() => ({
  messageList: [] as Array<{ direction: string; text: string; sequence: number; metadata?: unknown }>,
  jobStatus: 'processing' as string,
  transcriptReads: 0,
  onTranscriptRead: null as null | (() => void),
}))

vi.mock('@/lib/analytics/track', () => ({ track: vi.fn() }))
vi.mock('@/lib/inbox/autoresponse/ireSend', () => ({ sendIreOutbound }))
vi.mock('@/db/conversationAiState', () => ({
  getOrCreateAiState,
  markClosed,
  recordTurn: vi.fn(),
  mergeOnly: vi.fn(),
  markEscalated: vi.fn(),
  markHumanActive: vi.fn(),
  markStopped: vi.fn(),
}))
vi.mock('@/db/autoResponseJobs', () => ({
  enqueueAutoResponse,
  skipAutoResponseJob,
  completeAutoResponseJob,
  deferAutoResponseJob,
  skipPendingNoResponseJobs,
}))
vi.mock('@/lib/inbox/autoresponse/qualify', () => ({
  generateQualifyTurn,
}))
vi.mock('@/config/db', () => {
  const chainFor = (table: string) => {
    const chain: Record<string, unknown> = {}
    const self = () => chain
    chain.where = self
    chain.orderBy = self
    chain.limit = self
    chain.select = async () => {
      tableRows.transcriptReads += 1
      tableRows.onTranscriptRead?.()
      return tableRows.messageList.slice().sort((a, b) => Number(b.sequence) - Number(a.sequence))
    }
    chain.first = async () => {
      if (table === 'auto_response_jobs') return { status: tableRows.jobStatus }
      return null
    }
    return chain
  }
  const db = Object.assign((table: string) => chainFor(table), {
    transaction: async (fn: (trx: unknown) => unknown) => fn({}),
    fn: { now: () => new Date() },
    raw: async () => ({ rows: [] }),
  })
  return { db }
})

import { processNoResponseJob, scheduleNoResponseWarning } from '@/lib/inbox/autoresponse/processNoResponseJob'
import { enqueueInboundAutoResponse } from '@/lib/inbox/autoresponse/enqueueInboundAutoResponse'
import type { AutoResponseJob } from '@/db/autoResponseJobs'

const read = (rel: string) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8')

const JOB: AutoResponseJob = {
  id: 90,
  agencyId: 103,
  conversationId: 840,
  leadId: 1469,
  channel: 'whatsapp',
  reason: 'no_response_warning',
  triggerSequence: 10,
  attempts: 1,
  maxAttempts: 3,
  createdAt: new Date().toISOString(),
}

const CTX = {
  settings: {
    agencyId: 103,
    channel: 'whatsapp',
    enabled: true,
    quietHours: {},
    dailyCap: 200,
    guidance: null,
    agentInstructions: null,
    mode: 'qualify' as const,
    maxTurns: 5,
    collectFields: { required: [], optional: [] },
    draft: false,
    replyMode: 'ai' as const,
    fixedBody: null,
    delaySeconds: 5,
  },
  conv: {
    id: 840,
    businessPhoneNumberId: '972007939322425',
    customerWaId: '972524186300',
    customerName: 'george',
  },
  lead: { userId: 332, handlerId: null },
}

const CONTINUE = 'כמה לידים נכנסים אליך בחודש?'

function facts(over: Partial<NoResponseFacts> = {}): NoResponseFacts {
  return {
    phase: 'warning',
    aiState: 'ai_qualifying',
    lastDirection: 'outbound',
    lastText: CONTINUE,
    lastKind: '',
    lastSequence: 10,
    maxInboundSequence: 9,
    triggerSequence: 10,
    withinQuietHours: false,
    conversationMissing: false,
    ...over,
  }
}

beforeEach(() => {
  enqueueAutoResponse.mockReset().mockResolvedValue(91)
  skipAutoResponseJob.mockReset().mockResolvedValue(undefined)
  completeAutoResponseJob.mockReset().mockResolvedValue(true)
  deferAutoResponseJob.mockReset().mockResolvedValue(undefined)
  skipPendingNoResponseJobs.mockReset().mockResolvedValue(1)
  getOrCreateAiState.mockReset().mockResolvedValue({ aiState: 'ai_qualifying' })
  markClosed.mockReset().mockResolvedValue(undefined)
  sendIreOutbound.mockReset().mockResolvedValue({ ok: true, messageId: 501, sequence: 11 })
  generateQualifyTurn.mockReset()
  tableRows.jobStatus = 'processing'
  tableRows.transcriptReads = 0
  tableRows.onTranscriptRead = null
  tableRows.messageList = [
    { direction: 'inbound', text: 'שלום', sequence: 9 },
    { direction: 'outbound', text: CONTINUE, sequence: 10, metadata: { source: 'auto_response' } },
  ]
})

describe('no-response policy (pure)', () => {
  it('warning does not send if customer replied', () => {
    expect(decideNoResponseJob(facts({ maxInboundSequence: 11 }))).toEqual({ action: 'skip', reason: 'customer_replied' })
  })

  it('warning does not send if last message is inbound', () => {
    expect(decideNoResponseJob(facts({ lastDirection: 'inbound', lastText: 'רגע אני פה', lastSequence: 11, maxInboundSequence: 11 }))).toEqual({
      action: 'skip',
      reason: 'customer_replied',
    })
  })

  it('warning does not send if CLOSED', () => {
    expect(decideNoResponseJob(facts({ aiState: 'closed' }))).toEqual({ action: 'skip', reason: 'already_closed' })
  })

  it('warning does not send if ESCALATED', () => {
    expect(decideNoResponseJob(facts({ aiState: 'escalated' }))).toEqual({ action: 'skip', reason: 'already_escalated' })
  })

  it('warning does not send if human_active', () => {
    expect(decideNoResponseJob(facts({ aiState: 'human_active' }))).toEqual({ action: 'skip', reason: 'human_active' })
  })

  it('warning does not send if opted_out', () => {
    expect(decideNoResponseJob(facts({ aiState: 'opted_out' }))).toEqual({ action: 'skip', reason: 'opted_out' })
  })

  it('warning does not send if outbound is terminal', () => {
    expect(decideNoResponseJob(facts({ lastText: conversationCloser('he') }))).toEqual({ action: 'skip', reason: 'stale_trigger' })
    expect(isTerminalOutboundText(conversationCloser('he'))).toBe(true)
    expect(isTerminalOutboundText(NO_RESPONSE_CLOSED_TEXT)).toBe(true)
    expect(isTerminalOutboundText(NO_RESPONSE_WARNING_TEXT)).toBe(false)
  })

  it('duplicate warning is prevented', () => {
    expect(
      decideNoResponseJob(facts({ lastText: NO_RESPONSE_WARNING_TEXT, lastKind: 'no_response_warning' })),
    ).toEqual({ action: 'skip', reason: 'duplicate_warning' })
  })

  it('close does not send if customer replied', () => {
    expect(
      decideNoResponseJob(
        facts({
          phase: 'close',
          lastText: NO_RESPONSE_WARNING_TEXT,
          lastKind: 'no_response_warning',
          lastSequence: 12,
          triggerSequence: 10,
          maxInboundSequence: 11,
        }),
      ),
    ).toEqual({ action: 'skip', reason: 'customer_replied' })
  })

  it('close does not send if conversation became closed/escalated/human', () => {
    const waiting = facts({
      phase: 'close',
      lastText: NO_RESPONSE_WARNING_TEXT,
      lastKind: 'no_response_warning',
      lastSequence: 11,
      triggerSequence: 10,
    })
    expect(decideNoResponseJob({ ...waiting, aiState: 'closed' })).toEqual({ action: 'skip', reason: 'already_closed' })
    expect(decideNoResponseJob({ ...waiting, aiState: 'escalated' })).toEqual({ action: 'skip', reason: 'already_escalated' })
    expect(decideNoResponseJob({ ...waiting, aiState: 'human_active' })).toEqual({ action: 'skip', reason: 'human_active' })
  })

  it('stale close after inbound cannot close', () => {
    expect(
      decideNoResponseJob(
        facts({
          phase: 'close',
          lastDirection: 'inbound',
          lastText: 'רגע אני פה',
          lastSequence: 12,
          triggerSequence: 10,
          maxInboundSequence: 12,
        }),
      ),
    ).toEqual({ action: 'skip', reason: 'customer_replied' })
  })

  it('duplicate close is prevented', () => {
    expect(
      decideNoResponseJob(
        facts({
          phase: 'close',
          lastText: NO_RESPONSE_CLOSED_TEXT,
          lastKind: 'no_response_close',
          lastSequence: 12,
          triggerSequence: 10,
        }),
      ),
    ).toEqual({ action: 'skip', reason: 'duplicate_close' })
  })

  it('quiet hours prevent sending and keep the job for the next window', () => {
    expect(decideNoResponseJob(facts({ withinQuietHours: true }))).toEqual({ action: 'defer_quiet_hours' })
    const now = new Date('2026-08-19T12:30:00.000Z')
    const qh = { tz: 'UTC', startHour: 12, endHour: 13 }
    expect(withinQuietHours(qh, now)).toBe(true)
    const next = nextAllowedAfterQuietHours(qh, now)
    expect(withinQuietHours(qh, next)).toBe(false)
    expect(next.getTime()).toBeGreaterThan(now.getTime())
  })

  it('customer reply during quiet-hours wait still supersedes the job', () => {
    expect(decideNoResponseJob(facts({ withinQuietHours: true, maxInboundSequence: 11 }))).toEqual({
      action: 'skip',
      reason: 'customer_replied',
    })
  })

  it('conversation missing is a stable skip', () => {
    expect(decideNoResponseJob(facts({ conversationMissing: true }))).toEqual({
      action: 'skip',
      reason: 'conversation_missing',
    })
  })

  it('valid warning/close may send', () => {
    expect(decideNoResponseJob(facts())).toEqual({ action: 'send' })
    expect(
      decideNoResponseJob(
        facts({
          phase: 'close',
          lastText: NO_RESPONSE_WARNING_TEXT,
          lastKind: 'no_response_warning',
          lastSequence: 11,
          triggerSequence: 10,
        }),
      ),
    ).toEqual({ action: 'send' })
  })
})

describe('no-response worker', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('warning sends deterministic text and never calls OpenAI', async () => {
    const send = vi.fn()
    const outcome = await processNoResponseJob(JOB, CTX, { send })
    expect(outcome).toBe('sent')
    expect(sendIreOutbound).toHaveBeenCalledWith(
      JOB,
      CTX,
      send,
      NO_RESPONSE_WARNING_TEXT,
      expect.objectContaining({ source: 'auto_response', kind: 'no_response_warning' }),
    )
    expect(generateQualifyTurn).not.toHaveBeenCalled()
    expect(completeAutoResponseJob).toHaveBeenCalledWith(90, 501)
  })

  it('warning schedules close at +180s using the CONTINUE triggerSequence', async () => {
    await processNoResponseJob(JOB, CTX, { send: vi.fn() })
    expect(enqueueAutoResponse).toHaveBeenCalledWith(
      {},
      expect.objectContaining({
        reason: 'no_response_close',
        delaySeconds: NO_RESPONSE_CLOSE_DELAY_SECONDS,
        triggerSequence: 10,
      }),
    )
  })

  it('CONTINUE outbound schedules warning at +600s', async () => {
    const id = await scheduleNoResponseWarning({
      agencyId: 103,
      conversationId: 840,
      leadId: 1469,
      channel: 'whatsapp',
      triggerSequence: 10,
    })
    expect(id).toBe(91)
    expect(enqueueAutoResponse).toHaveBeenCalledWith(
      {},
      expect.objectContaining({
        reason: 'no_response_warning',
        delaySeconds: NO_RESPONSE_WARNING_DELAY_SECONDS,
        triggerSequence: 10,
      }),
    )
  })

  it('close sends deterministic text, marks CLOSED with no_response, never calls OpenAI', async () => {
    tableRows.messageList = [
      { direction: 'inbound', text: 'שלום', sequence: 9 },
      { direction: 'outbound', text: CONTINUE, sequence: 10, metadata: { source: 'auto_response' } },
      {
        direction: 'outbound',
        text: NO_RESPONSE_WARNING_TEXT,
        sequence: 11,
        metadata: { source: 'auto_response', kind: 'no_response_warning' },
      },
    ]
    sendIreOutbound.mockResolvedValue({ ok: true, messageId: 502, sequence: 12 })
    const closeJob = { ...JOB, id: 91, reason: 'no_response_close' as const, triggerSequence: 10 }
    const outcome = await processNoResponseJob(closeJob, CTX, { send: vi.fn() })
    expect(outcome).toBe('sent')
    expect(sendIreOutbound).toHaveBeenCalledWith(
      closeJob,
      CTX,
      expect.any(Function),
      NO_RESPONSE_CLOSED_TEXT,
      expect.objectContaining({ source: 'auto_response', kind: 'no_response_close' }),
    )
    expect(markClosed).toHaveBeenCalledWith(840, NO_RESPONSE_CLOSED_STATE_REASON)
    expect(generateQualifyTurn).not.toHaveBeenCalled()
  })

  it('warning does not send if customer replied (execute-time re-read)', async () => {
    tableRows.messageList = [
      { direction: 'outbound', text: CONTINUE, sequence: 10, metadata: { source: 'auto_response' } },
      { direction: 'inbound', text: 'רגע אני פה', sequence: 11 },
    ]
    const outcome = await processNoResponseJob(JOB, CTX, { send: vi.fn() })
    expect(outcome).toBe('skipped')
    expect(skipAutoResponseJob).toHaveBeenCalledWith(90, 'customer_replied')
    expect(sendIreOutbound).not.toHaveBeenCalled()
    expect(generateQualifyTurn).not.toHaveBeenCalled()
  })

  it('stale close race after inbound cannot close the conversation', async () => {
    tableRows.messageList = [
      { direction: 'outbound', text: NO_RESPONSE_WARNING_TEXT, sequence: 11, metadata: { source: 'auto_response', kind: 'no_response_warning' } },
      { direction: 'inbound', text: 'רגע אני פה', sequence: 12 },
    ]
    const closeJob = { ...JOB, id: 91, reason: 'no_response_close' as const, triggerSequence: 10 }
    const outcome = await processNoResponseJob(closeJob, CTX, { send: vi.fn() })
    expect(outcome).toBe('skipped')
    expect(skipAutoResponseJob).toHaveBeenCalledWith(91, 'customer_replied')
    expect(markClosed).not.toHaveBeenCalled()
    expect(sendIreOutbound).not.toHaveBeenCalled()
  })

  it('quiet-hours job remains/reschedules for the next allowed window', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-19T12:30:00.000Z'))
    const outcome = await processNoResponseJob(
      JOB,
      { ...CTX, settings: { ...CTX.settings, quietHours: { tz: 'UTC', startHour: 12, endHour: 13 } } },
      { send: vi.fn() },
    )
    expect(outcome).toBe('deferred')
    expect(deferAutoResponseJob).toHaveBeenCalledWith(90, expect.any(Date))
    const when = deferAutoResponseJob.mock.calls[0][1] as Date
    expect(when.getTime()).toBeGreaterThan(Date.now())
    expect(sendIreOutbound).not.toHaveBeenCalled()
    expect(skipAutoResponseJob).not.toHaveBeenCalled()
  })

  it('warning does not send if CLOSED', async () => {
    getOrCreateAiState.mockResolvedValue({ aiState: 'closed' })
    const outcome = await processNoResponseJob(JOB, CTX, { send: vi.fn() })
    expect(outcome).toBe('skipped')
    expect(skipAutoResponseJob).toHaveBeenCalledWith(90, 'already_closed')
    expect(sendIreOutbound).not.toHaveBeenCalled()
  })

  it('warning does not send if ESCALATED', async () => {
    getOrCreateAiState.mockResolvedValue({ aiState: 'escalated' })
    const outcome = await processNoResponseJob(JOB, CTX, { send: vi.fn() })
    expect(outcome).toBe('skipped')
    expect(skipAutoResponseJob).toHaveBeenCalledWith(90, 'already_escalated')
    expect(sendIreOutbound).not.toHaveBeenCalled()
  })

  it('warning does not send if human_active', async () => {
    getOrCreateAiState.mockResolvedValue({ aiState: 'human_active' })
    const outcome = await processNoResponseJob(JOB, CTX, { send: vi.fn() })
    expect(outcome).toBe('skipped')
    expect(skipAutoResponseJob).toHaveBeenCalledWith(90, 'human_active')
    expect(sendIreOutbound).not.toHaveBeenCalled()
  })

  it('warning does not send if opted_out', async () => {
    getOrCreateAiState.mockResolvedValue({ aiState: 'opted_out' })
    const outcome = await processNoResponseJob(JOB, CTX, { send: vi.fn() })
    expect(outcome).toBe('skipped')
    expect(skipAutoResponseJob).toHaveBeenCalledWith(90, 'opted_out')
    expect(sendIreOutbound).not.toHaveBeenCalled()
  })

  it('warning does not send if outbound is terminal', async () => {
    tableRows.messageList = [
      { direction: 'inbound', text: 'שלום', sequence: 9 },
      { direction: 'outbound', text: conversationCloser('he'), sequence: 10, metadata: { source: 'auto_response' } },
    ]
    const outcome = await processNoResponseJob(JOB, CTX, { send: vi.fn() })
    expect(outcome).toBe('skipped')
    expect(skipAutoResponseJob).toHaveBeenCalledWith(90, 'stale_trigger')
    expect(sendIreOutbound).not.toHaveBeenCalled()
  })

  it('duplicate warning is prevented', async () => {
    tableRows.messageList = [
      {
        direction: 'outbound',
        text: NO_RESPONSE_WARNING_TEXT,
        sequence: 10,
        metadata: { source: 'auto_response', kind: 'no_response_warning' },
      },
    ]
    const outcome = await processNoResponseJob(JOB, CTX, { send: vi.fn() })
    expect(sendIreOutbound).not.toHaveBeenCalled()
    expect(generateQualifyTurn).not.toHaveBeenCalled()
    expect(outcome).toBe('sent')
    expect(enqueueAutoResponse).toHaveBeenCalledWith(
      {},
      expect.objectContaining({ reason: 'no_response_close', triggerSequence: 10 }),
    )
  })

  it('duplicate close is prevented', async () => {
    tableRows.messageList = [
      {
        direction: 'outbound',
        text: NO_RESPONSE_CLOSED_TEXT,
        sequence: 11,
        metadata: { source: 'auto_response', kind: 'no_response_close' },
      },
    ]
    const closeJob = { ...JOB, id: 91, reason: 'no_response_close' as const, triggerSequence: 10 }
    const outcome = await processNoResponseJob(closeJob, CTX, { send: vi.fn() })
    expect(sendIreOutbound).not.toHaveBeenCalled()
    expect(generateQualifyTurn).not.toHaveBeenCalled()
    expect(markClosed).toHaveBeenCalledWith(840, NO_RESPONSE_CLOSED_STATE_REASON)
    expect(outcome).toBe('sent')
  })

  it('close does not send if conversation became closed/escalated/human', async () => {
    tableRows.messageList = [
      {
        direction: 'outbound',
        text: NO_RESPONSE_WARNING_TEXT,
        sequence: 11,
        metadata: { source: 'auto_response', kind: 'no_response_warning' },
      },
    ]
    const closeJob = { ...JOB, id: 91, reason: 'no_response_close' as const, triggerSequence: 10 }
    getOrCreateAiState.mockResolvedValue({ aiState: 'escalated' })
    const outcome = await processNoResponseJob(closeJob, CTX, { send: vi.fn() })
    expect(outcome).toBe('skipped')
    expect(skipAutoResponseJob).toHaveBeenCalledWith(91, 'already_escalated')
    expect(sendIreOutbound).not.toHaveBeenCalled()
    expect(markClosed).not.toHaveBeenCalled()
  })
})

describe('no-response TOCTOU guards', () => {
  it('A. CONTINUE with no inbound schedules close on the CONTINUE triggerSequence', async () => {
    const outcome = await processNoResponseJob(JOB, CTX, { send: vi.fn() })
    expect(outcome).toBe('sent')
    expect(enqueueAutoResponse).toHaveBeenCalledTimes(1)
    expect(enqueueAutoResponse).toHaveBeenCalledWith(
      {},
      expect.objectContaining({ reason: 'no_response_close', triggerSequence: 10 }),
    )
  })

  it('B. inbound 11 then warning persist 12 does not schedule close', async () => {
    sendIreOutbound.mockImplementation(async () => {
      tableRows.messageList = [
        { direction: 'inbound', text: 'שלום', sequence: 9 },
        { direction: 'outbound', text: CONTINUE, sequence: 10, metadata: { source: 'auto_response' } },
        { direction: 'inbound', text: 'רגע אני פה', sequence: 11 },
        {
          direction: 'outbound',
          text: NO_RESPONSE_WARNING_TEXT,
          sequence: 12,
          metadata: { source: 'auto_response', kind: 'no_response_warning' },
        },
      ]
      return { ok: true, messageId: 501, sequence: 12 }
    })
    const outcome = await processNoResponseJob(JOB, CTX, { send: vi.fn() })
    expect(outcome).toBe('sent')
    expect(sendIreOutbound).toHaveBeenCalledTimes(1)
    expect(enqueueAutoResponse).not.toHaveBeenCalled()
    expect(markClosed).not.toHaveBeenCalled()
  })

  it('C. recovery with inbound 11 and warning 12 does not schedule close', async () => {
    tableRows.messageList = [
      { direction: 'inbound', text: 'שלום', sequence: 9 },
      { direction: 'outbound', text: CONTINUE, sequence: 10, metadata: { source: 'auto_response' } },
      { direction: 'inbound', text: 'רגע אני פה', sequence: 11 },
      {
        direction: 'outbound',
        text: NO_RESPONSE_WARNING_TEXT,
        sequence: 12,
        metadata: { source: 'auto_response', kind: 'no_response_warning' },
      },
    ]
    const outcome = await processNoResponseJob(JOB, CTX, { send: vi.fn() })
    expect(outcome).toBe('skipped')
    expect(skipAutoResponseJob).toHaveBeenCalledWith(90, 'customer_replied')
    expect(sendIreOutbound).not.toHaveBeenCalled()
    expect(enqueueAutoResponse).not.toHaveBeenCalled()
    expect(markClosed).not.toHaveBeenCalled()
  })

  it('D. complete no-op on skipped job does not schedule close', async () => {
    completeAutoResponseJob.mockResolvedValue(false)
    const outcome = await processNoResponseJob(JOB, CTX, { send: vi.fn() })
    expect(outcome).toBe('sent')
    expect(sendIreOutbound).toHaveBeenCalledTimes(1)
    expect(completeAutoResponseJob).toHaveBeenCalledWith(90, 501)
    expect(enqueueAutoResponse).not.toHaveBeenCalled()
  })

  it('E. inbound appearing before Graph skips the warning send', async () => {
    tableRows.onTranscriptRead = () => {
      if (tableRows.transcriptReads === 2) {
        tableRows.messageList = [
          { direction: 'inbound', text: 'שלום', sequence: 9 },
          { direction: 'outbound', text: CONTINUE, sequence: 10, metadata: { source: 'auto_response' } },
          { direction: 'inbound', text: 'רגע אני פה', sequence: 11 },
        ]
      }
    }
    const outcome = await processNoResponseJob(JOB, CTX, { send: vi.fn() })
    expect(outcome).toBe('skipped')
    expect(skipAutoResponseJob).toHaveBeenCalledWith(90, 'customer_replied')
    expect(sendIreOutbound).not.toHaveBeenCalled()
    expect(enqueueAutoResponse).not.toHaveBeenCalled()
  })

  it('E2. job no longer processing before Graph skips the warning send', async () => {
    tableRows.jobStatus = 'skipped'
    const outcome = await processNoResponseJob(JOB, CTX, { send: vi.fn() })
    expect(outcome).toBe('skipped')
    expect(skipAutoResponseJob).toHaveBeenCalledWith(90, 'inbound_superseded')
    expect(sendIreOutbound).not.toHaveBeenCalled()
    expect(enqueueAutoResponse).not.toHaveBeenCalled()
  })

  it('F. recovery of an already-sent warning with no inbound schedules close once on CONTINUE', async () => {
    tableRows.messageList = [
      { direction: 'inbound', text: 'שלום', sequence: 9 },
      { direction: 'outbound', text: CONTINUE, sequence: 10, metadata: { source: 'auto_response' } },
      {
        direction: 'outbound',
        text: NO_RESPONSE_WARNING_TEXT,
        sequence: 12,
        metadata: { source: 'auto_response', kind: 'no_response_warning' },
      },
    ]
    const outcome = await processNoResponseJob(JOB, CTX, { send: vi.fn() })
    expect(outcome).toBe('sent')
    expect(sendIreOutbound).not.toHaveBeenCalled()
    expect(enqueueAutoResponse).toHaveBeenCalledTimes(1)
    expect(enqueueAutoResponse).toHaveBeenCalledWith(
      {},
      expect.objectContaining({ reason: 'no_response_close', triggerSequence: 10 }),
    )
  })

  it('G. inbound after warning skips the close job', async () => {
    tableRows.messageList = [
      { direction: 'outbound', text: CONTINUE, sequence: 10, metadata: { source: 'auto_response' } },
      {
        direction: 'outbound',
        text: NO_RESPONSE_WARNING_TEXT,
        sequence: 12,
        metadata: { source: 'auto_response', kind: 'no_response_warning' },
      },
      { direction: 'inbound', text: 'רגע אני פה', sequence: 13 },
    ]
    const closeJob = { ...JOB, id: 91, reason: 'no_response_close' as const, triggerSequence: 10 }
    const outcome = await processNoResponseJob(closeJob, CTX, { send: vi.fn() })
    expect(outcome).toBe('skipped')
    expect(skipAutoResponseJob).toHaveBeenCalledWith(91, 'customer_replied')
    expect(sendIreOutbound).not.toHaveBeenCalled()
    expect(markClosed).not.toHaveBeenCalled()
  })
})

describe('no-response integration with Stop Policy / jobs', () => {
  it('no-response messages do not count as sales AI consecutive outbound', () => {
    expect(
      countConsecutiveAiOutbounds([
        { direction: 'inbound', metadata: null },
        { direction: 'outbound', metadata: { source: 'auto_response' } },
        { direction: 'outbound', metadata: { source: 'auto_response', kind: 'no_response_warning' } },
      ]),
    ).toBe(1)
    expect(isNoResponseSystemKind('no_response_warning')).toBe(true)
  })

  it('inbound supersedes pending warning/close in the SAME transaction before qualify_turn', async () => {
    const q = {
      where() {
        return this
      },
      async first() {
        return { mode: 'qualify', delaySeconds: 5 }
      },
    }
    const trx = Object.assign((table: string) => {
      void table
      return q
    }, q)
    skipPendingNoResponseJobs.mockImplementation(async () => {
      expect(enqueueAutoResponse).not.toHaveBeenCalled()
      return 1
    })
    await enqueueInboundAutoResponse(trx as never, {
      agencyId: 103,
      conversationId: 840,
      leadId: 1469,
      triggerSequence: 12,
    })
    expect(skipPendingNoResponseJobs).toHaveBeenCalledWith(trx, 840)
    expect(enqueueAutoResponse).toHaveBeenCalledWith(
      trx,
      expect.objectContaining({ reason: 'qualify_turn', triggerSequence: 12 }),
    )
    expect(skipPendingNoResponseJobs.mock.invocationCallOrder[0]).toBeLessThan(enqueueAutoResponse.mock.invocationCallOrder[0])
  })

  it('CONTINUE path in qualifyWorker schedules warning after complete', () => {
    const src = read('lib/inbox/autoresponse/qualifyWorker.ts')
    expect(src).toContain('await scheduleNoResponseWarning({')
    // Lead ordering is unchanged: complete, then schedule. Task 13 only adds the
    // Contact guard around the schedule, so leadId=NULL jobs get no Lead warning.
    expect(src).toContain(
      'await completeAutoResponseJob(job.id, r.messageId)\n  if (isPositiveLeadId(job.leadId)) {\n    await scheduleNoResponseWarning({',
    )
    const closerBlock = src.slice(
      src.indexOf("control.action === 'CLOSE_CONVERSATION' && control.send === 'closer'"),
      src.indexOf('// ── Generate one structured turn'),
    )
    expect(closerBlock).not.toContain('scheduleNoResponseWarning')
  })

  it('worker routes no-response jobs before qualify GPT', () => {
    const src = read('lib/inbox/autoresponse/worker.ts')
    const proc = read('lib/inbox/autoresponse/processNoResponseJob.ts')
    expect(src).toContain("job.reason === 'no_response_warning'")
    expect(src.indexOf('processNoResponseJob')).toBeLessThan(src.indexOf('processQualifyJob('))
    expect(proc).not.toContain("from './qualify'")
    expect(proc).not.toContain('allowsOutbound')
    expect(proc).not.toContain('countSentToday')
  })

  it('warning/close do not count toward AI daily cap', () => {
    const src = read('db/autoResponseJobs.ts')
    expect(src).toContain(`reason NOT IN ('no_response_warning','no_response_close')`)
    expect(src).toContain(".where({ id, status: 'processing' })")
  })

  it('migration adds no-response reasons without being run from tests', () => {
    const src = read('migrations/20260819120000_auto_response_jobs_no_response.cjs')
    expect(src).toContain("'first_contact','qualify_turn','no_response_warning','no_response_close'")
  })

  it('qualifyWorker gates close confirmation on the last outbound warning kind', () => {
    const src = read('lib/inbox/autoresponse/qualifyWorker.ts')
    expect(src).toContain('closeOfferPending')
    expect(src).toContain('isNoResponseWarningMessage(previousOutbound, previousOutboundKind)')
    expect(src).toContain('skipPendingNoResponseJobs(trx, conv.id)')
  })

  it('confirmed close + 10 minutes later does not send another warning (aiState closed)', async () => {
    getOrCreateAiState.mockResolvedValue({ aiState: 'closed', stoppedReason: 'no_response_confirmed' })
    const outcome = await processNoResponseJob(JOB, CTX, { send: vi.fn() })
    expect(outcome).toBe('skipped')
    expect(skipAutoResponseJob).toHaveBeenCalledWith(90, 'already_closed')
    expect(sendIreOutbound).not.toHaveBeenCalled()
    expect(enqueueAutoResponse).not.toHaveBeenCalled()
    expect(generateQualifyTurn).not.toHaveBeenCalled()
  })

  it('confirmed close + later close job does not remain pending or send', async () => {
    getOrCreateAiState.mockResolvedValue({ aiState: 'closed', stoppedReason: 'no_response_confirmed' })
    const closeJob = { ...JOB, id: 91, reason: 'no_response_close' as const, triggerSequence: 10 }
    const outcome = await processNoResponseJob(closeJob, CTX, { send: vi.fn() })
    expect(outcome).toBe('skipped')
    expect(skipAutoResponseJob).toHaveBeenCalledWith(91, 'already_closed')
    expect(sendIreOutbound).not.toHaveBeenCalled()
    expect(markClosed).not.toHaveBeenCalled()
  })
})
