import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  isLowInformationInbound,
  shouldInvokeSalesAi,
  type GptEligibilityInput,
} from '@/lib/inbox/autoresponse/gptEligibility'
import { classifySalesMove } from '@/lib/inbox/autoresponse/salesIntent'
import { decideConversationControl } from '@/lib/inbox/autoresponse/conversationControl'
import { NO_RESPONSE_WARNING_TEXT } from '@/lib/inbox/autoresponse/noResponseClose'

const STATEMENT = 'המערכת מרכזת את כל הלידים במקום אחד.'
const EXPLAIN_OFFER = 'רוצה שאסביר איך זה עובד?'

function elig(over: Partial<GptEligibilityInput> & Pick<GptEligibilityInput, 'inboundText'>): ReturnType<typeof shouldInvokeSalesAi> {
  const inboundText = over.inboundText
  const previousOutbound = over.previousOutbound ?? STATEMENT
  const salesMove =
    over.salesMove ??
    classifySalesMove(inboundText, { previousOutbound })
  return shouldInvokeSalesAi({
    inboundText,
    previousOutbound,
    salesMove,
    controlAction: over.controlAction ?? 'CONTINUE',
    customerInboundCount: over.customerInboundCount ?? 3,
    previousCustomerText: over.previousCustomerText,
    previousOutboundKind: over.previousOutboundKind,
  })
}

describe('isLowInformationInbound', () => {
  it('treats punctuation, emoji, and sub-two-letter text as low information', () => {
    expect(isLowInformationInbound('')).toBe(true)
    expect(isLowInformationInbound('.')).toBe(true)
    expect(isLowInformationInbound('...')).toBe(true)
    expect(isLowInformationInbound('?')).toBe(true)
    expect(isLowInformationInbound('??')).toBe(true)
    expect(isLowInformationInbound('👍')).toBe(true)
    expect(isLowInformationInbound('😂')).toBe(true)
    expect(isLowInformationInbound('🙏')).toBe(true)
    expect(isLowInformationInbound('👍👍')).toBe(true)
  })

  it('does not treat real words as low information', () => {
    expect(isLowInformationInbound('תודה')).toBe(false)
    expect(isLowInformationInbound('כן')).toBe(false)
    expect(isLowInformationInbound('מה המחיר?')).toBe(false)
  })
})

describe('shouldInvokeSalesAi — WAIT leftovers if Control already continued', () => {
  it.each(['תודה', 'תודה אחי', 'סבבה', 'אוקיי'])('%s after a statement → WAIT', (inbound) => {
    expect(elig({ inboundText: inbound, controlAction: 'CONTINUE' })).toEqual({
      decision: 'WAIT',
      reason: expect.stringMatching(/ACKNOWLEDGEMENT|SHORT_AFFIRMATIVE/),
    })
  })

  it.each(['👍', '😂', '🙏', '...', '?', '??', '.'])('%s → WAIT LOW_INFORMATION before real-question', (inbound) => {
    expect(elig({ inboundText: inbound, controlAction: 'ASK_QUESTION' })).toEqual({
      decision: 'WAIT',
      reason: 'LOW_INFORMATION',
    })
  })

  it('bare כן after a statement → WAIT (not a pending question)', () => {
    expect(elig({ inboundText: 'כן', previousOutbound: STATEMENT })).toEqual({
      decision: 'WAIT',
      reason: 'SHORT_AFFIRMATIVE',
    })
  })

  it('repeated greeting after the conversation started → WAIT', () => {
    expect(elig({ inboundText: 'היי', customerInboundCount: 4 })).toEqual({
      decision: 'WAIT',
      reason: 'GREETING_REPEAT',
    })
  })

  it('duplicate DISCOVERY inbound → WAIT', () => {
    expect(
      elig({
        inboundText: 'בדיקה בדיקה',
        previousCustomerText: 'בדיקה בדיקה',
        salesMove: 'DISCOVERY',
        controlAction: 'ASK_QUESTION',
      }),
    ).toEqual({ decision: 'WAIT', reason: 'NO_NEW_CONTENT' })
  })
})

describe('shouldInvokeSalesAi — RUN_AI for meaningful content', () => {
  it('כן after רוצה שאסביר? → RUN_AI PENDING_QUESTION', () => {
    expect(elig({ inboundText: 'כן', previousOutbound: EXPLAIN_OFFER })).toEqual({
      decision: 'RUN_AI',
      reason: 'PENDING_QUESTION',
    })
  })

  it('כן, אבל יש לי שאלה → RUN_AI', () => {
    expect(elig({ inboundText: 'כן, אבל יש לי שאלה' }).decision).toBe('RUN_AI')
  })

  it('תודה, ויש לי עוד שאלה → RUN_AI', () => {
    expect(elig({ inboundText: 'תודה, ויש לי עוד שאלה' }).decision).toBe('RUN_AI')
  })

  it('סבבה, איך מתחילים? → RUN_AI', () => {
    expect(elig({ inboundText: 'סבבה, איך מתחילים?' })).toEqual({
      decision: 'RUN_AI',
      reason: 'REAL_QUESTION',
    })
  })

  it.each(['מה המחיר?', 'איך זה עובד?', 'אני רוצה להתחיל', 'לא הבנתי', 'אני צריך עזרה', 'יש לי שאלה'])(
    '%s → RUN_AI',
    (inbound) => {
      expect(elig({ inboundText: inbound }).decision).toBe('RUN_AI')
    },
  )

  it.each([30, 50, 100])('turn %i + מה המחיר? → RUN_AI (no max_turns)', (count) => {
    expect(elig({ inboundText: 'מה המחיר?', customerInboundCount: count })).toMatchObject({
      decision: 'RUN_AI',
    })
  })

  it('first-turn greeting → RUN_AI', () => {
    expect(elig({ inboundText: 'היי', customerInboundCount: 1, controlAction: 'ASK_QUESTION' })).toEqual({
      decision: 'RUN_AI',
      reason: 'FIRST_TURN',
    })
  })
})

describe('shouldInvokeSalesAi does not own no-response close', () => {
  it('warning + כן is Control CLOSE and must not be this function’s job', () => {
    const inbound = 'כן'
    const control = decideConversationControl({
      salesMove: classifySalesMove(inbound, { previousOutbound: NO_RESPONSE_WARNING_TEXT }),
      inboundText: inbound,
      previousOutbound: NO_RESPONSE_WARNING_TEXT,
      previousOutboundKind: 'no_response_warning',
      closeOfferPending: true,
    })
    expect(control.action).toBe('CLOSE_CONVERSATION')
    // If Control failed open, the warning's '?' must not authorize GPT.
    expect(
      shouldInvokeSalesAi({
        inboundText: inbound,
        previousOutbound: NO_RESPONSE_WARNING_TEXT,
        previousOutboundKind: 'no_response_warning',
        salesMove: 'DISCOVERY',
        controlAction: 'CONTINUE',
        customerInboundCount: 4,
      }),
    ).toEqual({ decision: 'WAIT', reason: 'SHORT_AFFIRMATIVE' })
  })
})

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
const waTrace = vi.hoisted(() => vi.fn())
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
vi.mock('@/lib/inbox/autoresponse/waTrace', () => ({ waTrace }))
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

import { processQualifyJob, type QualifyCtx } from '@/lib/inbox/autoresponse/qualifyWorker'
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

function inbound(text: string, extra: Record<string, unknown> = {}) {
  return {
    direction: 'inbound',
    text,
    sentByUserId: null,
    channelTimestamp: new Date(),
    createdAt: new Date(),
    metadata: null,
    ...extra,
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

describe('processQualifyJob GPT eligibility', () => {
  beforeEach(() => {
    failAutoResponseJob.mockReset().mockResolvedValue(undefined)
    skipAutoResponseJob.mockReset().mockResolvedValue(undefined)
    completeAutoResponseJob.mockReset().mockResolvedValue(undefined)
    countSentToday.mockReset().mockResolvedValue(0)
    skipPendingNoResponseJobs.mockReset().mockResolvedValue(1)
    recordTurn.mockReset().mockResolvedValue(undefined)
    markClosed.mockReset().mockResolvedValue(undefined)
    persistOutboundWhatsapp.mockReset().mockResolvedValue({ messageId: 4001 })
    waTrace.mockReset()
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
    // Task 13: the pre-Graph send gate re-reads the conversation and fails closed.
    tableRows.conversations = { id: 340, isPersonal: false }
  })

  it('WAIT thumbs-up skips GPT, does not close, traces GPT_ELIGIBILITY', async () => {
    // Worker loads newest-first then reverses. Last element here is the oldest.
    tableRows.messageList = [inbound('👍'), outbound(STATEMENT), inbound('יש לי עסק')]
    const generateQualify = vi.fn()
    const send = vi.fn()
    const outcome = await processQualifyJob(JOB, CTX, { send, generateQualify })
    expect(outcome).toBe('skipped')
    expect(generateQualify).not.toHaveBeenCalled()
    expect(send).not.toHaveBeenCalled()
    expect(markClosed).not.toHaveBeenCalled()
    expect(skipAutoResponseJob).toHaveBeenCalledWith(61, 'gpt_wait_LOW_INFORMATION')
    expect(waTrace).toHaveBeenCalledWith(
      'GPT_ELIGIBILITY',
      expect.objectContaining({ conversationId: 382, jobId: 61 }),
      expect.objectContaining({ decision: 'WAIT', reason: 'LOW_INFORMATION', controlAction: 'ASK_QUESTION' }),
    )
  })

  it('sticky PRODUCT_FIT + parking inbound skips GPT and does not close', async () => {
    tableRows.messageList = [
      inbound('אני אחשוב על זה'),
      outbound(STATEMENT),
      inbound('אני צריך מערכת לניהול לידים'),
    ]
    getOrCreateAiState.mockResolvedValue({
      aiState: 'ai_qualifying',
      aiTurnCount: 3,
      qualification: { cognition: { salesStrategy: 'product_fit' } },
    })
    const generateQualify = vi.fn()
    const send = vi.fn()
    const outcome = await processQualifyJob(JOB, CTX, { send, generateQualify })
    expect(outcome).toBe('skipped')
    expect(generateQualify).not.toHaveBeenCalled()
    expect(send).not.toHaveBeenCalled()
    expect(markClosed).not.toHaveBeenCalled()
    expect(skipAutoResponseJob).toHaveBeenCalledWith(61, 'gpt_wait_NO_MEANINGFUL_INTENT')
  })

  it('RUN_AI product question invokes GPT', async () => {
    tableRows.messageList = [inbound('מה המחיר?'), outbound(STATEMENT), inbound('יש לי עסק')]
    const generateQualify = vi.fn(async () => ({ ok: false as const, skipReason: 'ai_unavailable' as const }))
    const send = vi.fn()
    await processQualifyJob(JOB, CTX, { send, generateQualify })
    expect(generateQualify).toHaveBeenCalledTimes(1)
    expect(waTrace).toHaveBeenCalledWith(
      'GPT_ELIGIBILITY',
      expect.any(Object),
      expect.objectContaining({ decision: 'RUN_AI' }),
    )
  })

  it('warning + כן never reaches GPT eligibility', async () => {
    tableRows.messageList = [
      inbound('כן'),
      outbound(NO_RESPONSE_WARNING_TEXT, { source: 'auto_response', kind: 'no_response_warning' }),
      inbound('יש לי עסק'),
    ]
    const generateQualify = vi.fn()
    const send = vi.fn(async () => ({ ok: true as const, wamid: 'w' }))
    persistOutboundWhatsapp.mockResolvedValue({ messageId: 4001, sequence: 9 })
    const outcome = await processQualifyJob(JOB, CTX, { send, generateQualify })
    expect(generateQualify).not.toHaveBeenCalled()
    expect(outcome).toBe('sent')
    expect(markClosed).toHaveBeenCalled()
    const eligibilityTraces = waTrace.mock.calls.filter((c) => c[0] === 'GPT_ELIGIBILITY')
    expect(eligibilityTraces).toHaveLength(0)
  })
})
