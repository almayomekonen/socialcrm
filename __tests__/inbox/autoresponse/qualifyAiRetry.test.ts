/**
 * Transient AI/provider failures must reuse failAutoResponseJob.
 * Safety skips stay terminal. Failed generation must not send or count a turn.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const failAutoResponseJob = vi.hoisted(() => vi.fn())
const skipAutoResponseJob = vi.hoisted(() => vi.fn())
const completeAutoResponseJob = vi.hoisted(() => vi.fn())
const countSentToday = vi.hoisted(() => vi.fn())
const getOrCreateAiState = vi.hoisted(() => vi.fn())
const recordTurn = vi.hoisted(() => vi.fn())
const markEscalated = vi.hoisted(() => vi.fn())
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
    }),
  }
})

import { processQualifyJob, type QualifyCtx } from '@/lib/inbox/autoresponse/qualifyWorker'
import { isRetryableIreGenerationFailure } from '@/lib/inbox/autoresponse/retryableGeneration'
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

beforeEach(() => {
  failAutoResponseJob.mockReset().mockResolvedValue(undefined)
  skipAutoResponseJob.mockReset().mockResolvedValue(undefined)
  completeAutoResponseJob.mockReset().mockResolvedValue(undefined)
  countSentToday.mockReset().mockResolvedValue(0)
  recordTurn.mockReset().mockResolvedValue(undefined)
  markEscalated.mockReset().mockResolvedValue(undefined)
  persistOutboundWhatsapp.mockReset().mockResolvedValue({ messageId: 4001 })
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
  tableRows.messageList = [
    {
      direction: 'inbound',
      text: 'יש לי עסק ואני צריכה עזרה',
      sentByUserId: null,
      channelTimestamp: new Date(),
      createdAt: new Date(),
      metadata: null,
    },
  ]
})

describe('isRetryableIreGenerationFailure', () => {
  it('retries provider unavailability only', () => {
    expect(isRetryableIreGenerationFailure('ai_unavailable')).toBe(true)
    expect(isRetryableIreGenerationFailure('budget_exhausted')).toBe(false)
    expect(isRetryableIreGenerationFailure('max_turns')).toBe(false)
    expect(isRetryableIreGenerationFailure('opt_out')).toBe(false)
  })
})

describe('qualify AI generation retry', () => {
  it('transient ai_unavailable reuses failAutoResponseJob and does not send or count a turn', async () => {
    const send = vi.fn()
    const generateQualify = vi.fn(async () => ({ ok: false as const, skipReason: 'ai_unavailable' as const }))
    const outcome = await processQualifyJob(JOB, CTX, { send, generateQualify })
    expect(outcome).toBe('failed')
    expect(failAutoResponseJob).toHaveBeenCalledWith(61, 'ai_unavailable')
    expect(skipAutoResponseJob).not.toHaveBeenCalled()
    expect(send).not.toHaveBeenCalled()
    expect(recordTurn).not.toHaveBeenCalled()
    expect(completeAutoResponseJob).not.toHaveBeenCalled()
    expect(markEscalated).not.toHaveBeenCalled()
  })

  it('successful retry after a failed generation sends exactly one outbound and then counts the turn', async () => {
    const send = vi.fn(async () => ({ ok: true as const, wamid: 'wamid.out' }))
    const generateQualify = vi
      .fn()
      .mockResolvedValueOnce({ ok: false as const, skipReason: 'ai_unavailable' as const })
      .mockResolvedValueOnce(OK_GEN)

    const first = await processQualifyJob({ ...JOB, attempts: 1 }, CTX, { send, generateQualify })
    expect(first).toBe('failed')
    expect(send).not.toHaveBeenCalled()
    expect(recordTurn).not.toHaveBeenCalled()

    const second = await processQualifyJob({ ...JOB, attempts: 2 }, CTX, { send, generateQualify })
    expect(second).toBe('sent')
    expect(send).toHaveBeenCalledTimes(1)
    expect(completeAutoResponseJob).toHaveBeenCalledTimes(1)
    expect(completeAutoResponseJob).toHaveBeenCalledWith(61, 4001)
    expect(recordTurn).toHaveBeenCalledTimes(1)
    expect(failAutoResponseJob).toHaveBeenCalledTimes(1)
  })

  it('repeated failures still go through maxAttempts via failAutoResponseJob and never fabricate a reply', async () => {
    const send = vi.fn()
    const generateQualify = vi.fn(async () => ({ ok: false as const, skipReason: 'ai_unavailable' as const }))
    const outcome = await processQualifyJob({ ...JOB, attempts: 3, maxAttempts: 3 }, CTX, {
      send,
      generateQualify,
    })
    expect(outcome).toBe('failed')
    expect(failAutoResponseJob).toHaveBeenCalledWith(61, 'ai_unavailable')
    expect(send).not.toHaveBeenCalled()
    expect(recordTurn).not.toHaveBeenCalled()
    expect(completeAutoResponseJob).not.toHaveBeenCalled()
  })

  it('budget_exhausted stays a terminal skip', async () => {
    const send = vi.fn()
    const generateQualify = vi.fn(async () => ({ ok: false as const, skipReason: 'budget_exhausted' as const }))
    const outcome = await processQualifyJob(JOB, CTX, { send, generateQualify })
    expect(outcome).toBe('skipped')
    expect(skipAutoResponseJob).toHaveBeenCalledWith(61, 'budget_exhausted')
    expect(failAutoResponseJob).not.toHaveBeenCalled()
    expect(recordTurn).not.toHaveBeenCalled()
  })

  it('hard ceiling remains a terminal skip and is not retried', async () => {
    getOrCreateAiState.mockResolvedValue({
      aiState: 'ai_qualifying',
      aiTurnCount: 7,
      qualification: {},
    })
    const send = vi.fn()
    const generateQualify = vi.fn()
    const outcome = await processQualifyJob(JOB, CTX, { send, generateQualify })
    expect(outcome).toBe('skipped')
    expect(skipAutoResponseJob).toHaveBeenCalledWith(61, 'max_turns')
    expect(failAutoResponseJob).not.toHaveBeenCalled()
    expect(generateQualify).not.toHaveBeenCalled()
    expect(recordTurn).not.toHaveBeenCalled()
  })

  it('human takeover remains a terminal skip', async () => {
    tableRows.messageList = [
      {
        direction: 'inbound',
        text: 'היי',
        sentByUserId: null,
        channelTimestamp: new Date(),
        createdAt: new Date(),
        metadata: null,
      },
      {
        direction: 'outbound',
        text: 'שלום, כאן הנציג',
        sentByUserId: 332,
        channelTimestamp: new Date(),
        createdAt: new Date(),
        metadata: { source: 'manual' },
      },
      {
        direction: 'inbound',
        text: 'עוד שאלה',
        sentByUserId: null,
        channelTimestamp: new Date(),
        createdAt: new Date(),
        metadata: null,
      },
    ]
    const send = vi.fn()
    const generateQualify = vi.fn()
    const outcome = await processQualifyJob(JOB, CTX, { send, generateQualify })
    expect(outcome).toBe('skipped')
    expect(skipAutoResponseJob).toHaveBeenCalledWith(61, 'human_active')
    expect(failAutoResponseJob).not.toHaveBeenCalled()
    expect(generateQualify).not.toHaveBeenCalled()
  })

  it('opt-out, quiet hours, daily cap, 24h window, and already-escalated stay terminal skips', async () => {
    const send = vi.fn()
    const generateQualify = vi.fn()

    tableRows.messageList = [
      {
        direction: 'inbound',
        text: 'תפסיקו לכתוב לי',
        sentByUserId: null,
        channelTimestamp: new Date(),
        createdAt: new Date(),
        metadata: null,
      },
    ]
    await expect(processQualifyJob(JOB, CTX, { send, generateQualify })).resolves.toBe('skipped')
    expect(skipAutoResponseJob).toHaveBeenCalledWith(61, 'opt_out')

    skipAutoResponseJob.mockClear()
    tableRows.messageList = [
      {
        direction: 'inbound',
        text: 'יש לי עסק ואני צריכה עזרה',
        sentByUserId: null,
        channelTimestamp: new Date(),
        createdAt: new Date(),
        metadata: null,
      },
    ]
    await expect(
      processQualifyJob(JOB, { ...CTX, settings: { ...CTX.settings, quietHours: { tz: 'UTC', startHour: 0, endHour: 24 } } }, {
        send,
        generateQualify,
      }),
    ).resolves.toBe('skipped')
    expect(skipAutoResponseJob).toHaveBeenCalledWith(61, 'quiet_hours')

    skipAutoResponseJob.mockClear()
    countSentToday.mockResolvedValueOnce(200)
    await expect(processQualifyJob(JOB, CTX, { send, generateQualify })).resolves.toBe('skipped')
    expect(skipAutoResponseJob).toHaveBeenCalledWith(61, 'daily_cap')

    skipAutoResponseJob.mockClear()
    tableRows.messageList = [
      {
        direction: 'inbound',
        text: 'יש לי עסק ואני צריכה עזרה',
        sentByUserId: null,
        channelTimestamp: new Date(Date.now() - 25 * 60 * 60 * 1000),
        createdAt: new Date(Date.now() - 25 * 60 * 60 * 1000),
        metadata: null,
      },
    ]
    await expect(processQualifyJob(JOB, CTX, { send, generateQualify })).resolves.toBe('skipped')
    expect(skipAutoResponseJob).toHaveBeenCalledWith(61, 'outside_window')

    skipAutoResponseJob.mockClear()
    tableRows.messageList = [
      {
        direction: 'inbound',
        text: 'יש לי עסק ואני צריכה עזרה',
        sentByUserId: null,
        channelTimestamp: new Date(),
        createdAt: new Date(),
        metadata: null,
      },
    ]
    getOrCreateAiState.mockResolvedValueOnce({
      aiState: 'escalated',
      aiTurnCount: 3,
      qualification: {},
    })
    await expect(processQualifyJob(JOB, CTX, { send, generateQualify })).resolves.toBe('skipped')
    expect(skipAutoResponseJob).toHaveBeenCalledWith(61, 'already_escalated')
    expect(failAutoResponseJob).not.toHaveBeenCalled()
    expect(generateQualify).not.toHaveBeenCalled()
  })

  it('LLM hotSignal without HANDOFF_REQUEST sends the generated reply and does not escalate', async () => {
    const send = vi.fn(async () => ({ ok: true as const, wamid: 'wamid.hot' }))
    const generateQualify = vi.fn(async () => ({ ...OK_GEN, hotSignal: true, salesMove: 'BUYING_SIGNAL' as const }))
    const outcome = await processQualifyJob(JOB, CTX, { send, generateQualify })
    expect(outcome).toBe('sent')
    expect(markEscalated).not.toHaveBeenCalled()
    expect(recordTurn).toHaveBeenCalledTimes(1)
    expect(send).toHaveBeenCalledTimes(1)
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ body: OK_GEN.reply }))
    expect(failAutoResponseJob).not.toHaveBeenCalled()
  })

  it('explicit human request still hands off without using generation retry', async () => {
    tableRows.messageList = [
      {
        direction: 'inbound',
        text: 'תעביר אותי לנציג',
        sentByUserId: null,
        channelTimestamp: new Date(),
        createdAt: new Date(),
        metadata: null,
      },
    ]
    const send = vi.fn(async () => ({ ok: true as const, wamid: 'wamid.human' }))
    const generateQualify = vi.fn(async () => ({ ...OK_GEN, hotSignal: false, salesMove: 'DISCOVERY' as const }))
    const outcome = await processQualifyJob(JOB, CTX, { send, generateQualify })
    expect(outcome).toBe('sent')
    expect(markEscalated).toHaveBeenCalledWith(382, 'human_request')
    expect(recordTurn).not.toHaveBeenCalled()
    expect(send).toHaveBeenCalledTimes(1)
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({ body: 'מישהו מהצוות ימשיך איתך ויחזור אליך בהקדם.' }),
    )
    expect(generateQualify).not.toHaveBeenCalled()
  })

  it('regeneration gen1 hotSignal=false gen2 hotSignal=true must not escalate', async () => {
    const send = vi.fn(async () => ({ ok: true as const, wamid: 'wamid.regen' }))
    const generateQualify = vi
      .fn()
      .mockResolvedValueOnce({
        ...OK_GEN,
        reply: 'מה הכי מפריע לך בזה עכשיו? ומה היית רוצה שיהיה אחרת?',
        hotSignal: false,
        salesMove: 'DISCOVERY' as const,
      })
      .mockResolvedValueOnce({
        ...OK_GEN,
        reply: 'מה הכי מפריע לך בזה עכשיו?',
        hotSignal: true,
        salesMove: 'BUYING_SIGNAL' as const,
      })
    const outcome = await processQualifyJob(JOB, CTX, { send, generateQualify })
    expect(generateQualify).toHaveBeenCalledTimes(2)
    expect(outcome).toBe('sent')
    expect(markEscalated).not.toHaveBeenCalled()
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ body: 'מה הכי מפריע לך בזה עכשיו?' }))
    expect(recordTurn).toHaveBeenCalledTimes(1)
  })

  it('regeneration gen1 hotSignal=true gen2 hotSignal=false still follows the classifier, not gen2', async () => {
    const send = vi.fn(async () => ({ ok: true as const, wamid: 'wamid.regen2' }))
    const generateQualify = vi
      .fn()
      .mockResolvedValueOnce({
        ...OK_GEN,
        reply: 'מה הכי מפריע לך בזה עכשיו? ומה היית רוצה שיהיה אחרת?',
        hotSignal: true,
        salesMove: 'HANDOFF_REQUEST' as const,
      })
      .mockResolvedValueOnce({
        ...OK_GEN,
        reply: 'מה הכי מפריע לך בזה עכשיו?',
        hotSignal: false,
        salesMove: 'DISCOVERY' as const,
      })
    const outcome = await processQualifyJob(JOB, CTX, { send, generateQualify })
    expect(generateQualify).toHaveBeenCalledTimes(2)
    expect(outcome).toBe('sent')
    expect(markEscalated).not.toHaveBeenCalled()
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ body: 'מה הכי מפריע לך בזה עכשיו?' }))
  })

  it('fallback plus stale LLM hotSignal must not escalate without HANDOFF_REQUEST', async () => {
    const send = vi.fn(async () => ({ ok: true as const, wamid: 'wamid.fb' }))
    const generateQualify = vi.fn(async () => ({
      ...OK_GEN,
      reply: 'מה הכי מפריע לך בזה עכשיו? ומה היית רוצה שיהיה אחרת?',
      hotSignal: true,
      salesMove: 'BUYING_SIGNAL' as const,
    }))
    const outcome = await processQualifyJob(JOB, CTX, { send, generateQualify })
    expect(generateQualify).toHaveBeenCalledTimes(2)
    expect(outcome).toBe('sent')
    expect(markEscalated).not.toHaveBeenCalled()
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ body: 'מה הכי מפריע לך בזה עכשיו?' }))
    expect(recordTurn).toHaveBeenCalledTimes(1)
  })

  it('production conv 561: classifier DISCOVERY + LLM BUYING/hot + valid reply must send the reply', async () => {
    const generated =
      'כדי להתקדם, נתחיל במיפוי קצר של מקורות הלידים ונראה איך לרכז את המעקב. מאיפה רוב הלידים נכנסים היום—וואטסאפ, פייסבוק או האתר?'
    tableRows.messageList = [
      {
        direction: 'inbound',
        text: 'אוקיי איך אנחנו מתקדמים?',
        sentByUserId: null,
        channelTimestamp: new Date(),
        createdAt: new Date(),
        metadata: null,
      },
      {
        direction: 'outbound',
        text: 'SocialCRM מרכזת את כל הלידים במקום אחד, עם סטטוס ומעקב לכל פנייה—כך קל לראות במה צריך לטפל ולא לאבד לידים בין כל הפניות.',
        sentByUserId: 332,
        channelTimestamp: new Date(),
        createdAt: new Date(),
        metadata: { source: 'auto_response', reason: 'qualify_turn' },
      },
      {
        direction: 'inbound',
        text: 'יש לי עסק של נדל״ן ונכנסים לי הרבה לקוחות אני צריך עזרה בניהול לידים',
        sentByUserId: null,
        channelTimestamp: new Date(),
        createdAt: new Date(),
        metadata: null,
      },
    ]
    getOrCreateAiState.mockResolvedValue({
      aiState: 'ai_qualifying',
      aiTurnCount: 1,
      qualification: { need: 'עזרה בניהול כמות גדולה של לידים בעסק נדל״ן', cognition: { lastObjective: 'advance' } },
    })
    const send = vi.fn(async () => ({ ok: true as const, wamid: 'wamid.561' }))
    const generateQualify = vi.fn(async () => ({
      ...OK_GEN,
      reply: generated,
      extracted: { need: 'עזרה בניהול כמות גדולה של לידים בעסק נדל״ן' },
      objective: 'advance' as const,
      salesMove: 'BUYING_SIGNAL' as const,
      hotSignal: true,
      uncertain: false,
    }))
    const outcome = await processQualifyJob(JOB, CTX, { send, generateQualify })
    expect(outcome).toBe('sent')
    expect(markEscalated).not.toHaveBeenCalled()
    expect(recordTurn).toHaveBeenCalledTimes(1)
    expect(send).toHaveBeenCalledTimes(1)
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        body: 'כדי להתקדם, נתחיל במיפוי קצר של מקורות הלידים ונראה איך לרכז את המעקב. מאיפה רוב הלידים נכנסים היום, וואטסאפ, פייסבוק או האתר?',
      }),
    )
    expect(send).not.toHaveBeenCalledWith(
      expect.objectContaining({ body: 'מישהו מהצוות ימשיך איתך ויחזור אליך בהקדם.' }),
    )
  })
})

describe('classifier is the sole commercial escalation authority', () => {
  it('TEST A: classifier HANDOFF_REQUEST wins over LLM hotSignal=false salesMove=PRODUCT_FIT', async () => {
    tableRows.messageList = [
      {
        direction: 'inbound',
        text: 'תעביר אותי לנציג',
        sentByUserId: null,
        channelTimestamp: new Date(),
        createdAt: new Date(),
        metadata: null,
      },
    ]
    const generated = 'מה הכי מפריע לך בזה עכשיו?'
    const send = vi.fn(async () => ({ ok: true as const, wamid: 'wamid.auth-a' }))
    const generateQualify = vi.fn(async () => ({
      ...OK_GEN,
      reply: generated,
      hotSignal: false,
      salesMove: 'PRODUCT_FIT' as const,
      uncertain: false,
    }))
    const outcome = await processQualifyJob(JOB, CTX, { send, generateQualify })
    expect(outcome).toBe('sent')
    expect(markEscalated).toHaveBeenCalledWith(382, 'human_request')
    expect(recordTurn).not.toHaveBeenCalled()
    expect(send).toHaveBeenCalledTimes(1)
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({ body: 'מישהו מהצוות ימשיך איתך ויחזור אליך בהקדם.' }),
    )
    expect(send).not.toHaveBeenCalledWith(expect.objectContaining({ body: generated }))
    expect(generateQualify).not.toHaveBeenCalled()
  })

  it('TEST B: LLM hotSignal=true salesMove=HANDOFF_REQUEST cannot override the classifier into a handoff', async () => {
    tableRows.messageList = [
      {
        direction: 'inbound',
        text: 'אוקיי איך אנחנו מתקדמים?',
        sentByUserId: null,
        channelTimestamp: new Date(),
        createdAt: new Date(),
        metadata: null,
      },
    ]
    const generated = 'מה הכי מפריע לך בזה עכשיו?'
    const send = vi.fn(async () => ({ ok: true as const, wamid: 'wamid.auth-b' }))
    const generateQualify = vi.fn(async () => ({
      ...OK_GEN,
      reply: generated,
      hotSignal: true,
      salesMove: 'HANDOFF_REQUEST' as const,
      uncertain: false,
    }))
    const outcome = await processQualifyJob(JOB, CTX, { send, generateQualify })
    expect(outcome).toBe('sent')
    expect(markEscalated).not.toHaveBeenCalled()
    expect(recordTurn).toHaveBeenCalledTimes(1)
    expect(send).toHaveBeenCalledTimes(1)
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ body: generated }))
    expect(send).not.toHaveBeenCalledWith(
      expect.objectContaining({ body: 'מישהו מהצוות ימשיך איתך ויחזור אליך בהקדם.' }),
    )
  })
})

describe('conversation 578 sales-progression worker', () => {
  const EXPLAIN_OFFER = 'רוצה שאסביר איך זה נראה בעבודה היומיומית?'
  const EXPLANATION =
    'SocialCRM מרכזת לידים מוואטסאפ ופייסבוק במקום אחד, עם סטטוס ומעקב לכל פנייה.'
  const ADVANCE_FALLBACK = 'מה הכי חשוב לך שנסדר עכשיו?'

  function inbound(text: string) {
    return {
      direction: 'inbound' as const,
      text,
      sentByUserId: null,
      channelTimestamp: new Date(),
      createdAt: new Date(),
      metadata: null,
    }
  }
  function outbound(text: string) {
    return {
      direction: 'outbound' as const,
      text,
      sentByUserId: 332,
      channelTimestamp: new Date(),
      createdAt: new Date(),
      metadata: { source: 'auto_response', reason: 'qualify_turn' },
    }
  }

  it('CASE A: כן after an explanation offer sends the explanation and does not fall back to discovery', async () => {
    tableRows.messageList = [
      inbound('כן'),
      outbound(EXPLAIN_OFFER),
      inbound('יש לי עסק של נדל״ן ונכנסים לי הרבה לקוחות אני צריך עזרה בניהול לידים'),
    ]
    getOrCreateAiState.mockResolvedValue({
      aiState: 'ai_qualifying',
      aiTurnCount: 5,
      qualification: { need: 'ניהול לידים', cognition: { salesStrategy: 'product_fit' } },
    })
    const send = vi.fn(async () => ({ ok: true as const, wamid: 'wamid.578-yes' }))
    const generateQualify = vi.fn(async () => ({
      ...OK_GEN,
      reply: EXPLANATION,
      extracted: { need: 'ניהול לידים' },
      objective: 'advance' as const,
      salesMove: 'PRODUCT_QUESTION' as const,
      hotSignal: false,
      uncertain: false,
    }))
    const outcome = await processQualifyJob(JOB, CTX, { send, generateQualify })
    expect(outcome).toBe('sent')
    expect(generateQualify).toHaveBeenCalledTimes(1)
    expect(generateQualify).toHaveBeenCalledWith(
      expect.objectContaining({ salesMove: 'PRODUCT_QUESTION', salesStrategy: 'explain' }),
    )
    expect(markEscalated).not.toHaveBeenCalled()
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ body: EXPLANATION }))
    expect(send).not.toHaveBeenCalledWith(expect.objectContaining({ body: ADVANCE_FALLBACK }))
  })

  it('CASE B: כן after a product explanation continues how_it_works and does not fall back to discovery', async () => {
    const productExplanation =
      'בפועל, השיחות מהוואטסאפ ייכנסו למערכת, ומשם מקשרים כל פנייה לליד, מעדכנים סטטוס וקובעים מתי לחזור אליו.'
    tableRows.messageList = [
      inbound('כן'),
      outbound(productExplanation),
      inbound('יש לי עסק של נדל״ן ונכנסים לי הרבה לקוחות אני צריך עזרה בניהול לידים'),
    ]
    getOrCreateAiState.mockResolvedValue({
      aiState: 'ai_qualifying',
      aiTurnCount: 5,
      qualification: { need: 'ניהול לידים', cognition: { salesStrategy: 'product_fit' } },
    })
    const send = vi.fn(async () => ({ ok: true as const, wamid: 'wamid.578-yes-b' }))
    const generateQualify = vi.fn(async () => ({
      ...OK_GEN,
      reply: productExplanation,
      extracted: { need: 'ניהול לידים' },
      objective: 'advance' as const,
      salesMove: 'PRODUCT_QUESTION' as const,
      hotSignal: false,
      uncertain: false,
    }))
    const outcome = await processQualifyJob(JOB, CTX, { send, generateQualify })
    expect(outcome).toBe('sent')
    expect(generateQualify).toHaveBeenCalledTimes(1)
    expect(generateQualify).toHaveBeenCalledWith(
      expect.objectContaining({ salesMove: 'PRODUCT_QUESTION', salesStrategy: 'how_it_works' }),
    )
    expect(generateQualify).not.toHaveBeenCalledWith(expect.objectContaining({ salesMove: 'DISCOVERY' }))
    expect(markEscalated).not.toHaveBeenCalled()
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ body: productExplanation }))
    expect(send).not.toHaveBeenCalledWith(expect.objectContaining({ body: ADVANCE_FALLBACK }))
  })

  it('תן לי הסבר קצר על המערכת sends an explanation, not a discovery fallback', async () => {
    tableRows.messageList = [
      inbound('תן לי הסבר קצר על המערכת'),
      outbound(EXPLANATION),
      inbound('יש לי עסק של נדל״ן ונכנסים לי הרבה לקוחות אני צריך עזרה בניהול לידים'),
    ]
    getOrCreateAiState.mockResolvedValue({
      aiState: 'ai_qualifying',
      aiTurnCount: 6,
      qualification: { need: 'ניהול לידים', cognition: { salesStrategy: 'explain' } },
    })
    const send = vi.fn(async () => ({ ok: true as const, wamid: 'wamid.578-explain' }))
    const generateQualify = vi.fn(async () => ({
      ...OK_GEN,
      reply: EXPLANATION,
      extracted: { need: 'ניהול לידים' },
      objective: 'advance' as const,
      salesMove: 'PRODUCT_QUESTION' as const,
      hotSignal: false,
      uncertain: false,
    }))
    const outcome = await processQualifyJob(JOB, CTX, { send, generateQualify })
    expect(outcome).toBe('sent')
    expect(generateQualify).toHaveBeenCalledTimes(1)
    expect(generateQualify).toHaveBeenCalledWith(
      expect.objectContaining({ salesMove: 'PRODUCT_QUESTION', salesStrategy: 'explain' }),
    )
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ body: EXPLANATION }))
    expect(send).not.toHaveBeenCalledWith(expect.objectContaining({ body: ADVANCE_FALLBACK }))
    expect(markEscalated).not.toHaveBeenCalled()
  })

  it('תסדר לי לידים before the hard ceiling sends product help, not silence or discovery', async () => {
    tableRows.messageList = [
      inbound('תסדר לי לידים'),
      outbound(EXPLANATION),
      inbound('יש לי עסק של נדל״ן ונכנסים לי הרבה לקוחות אני צריך עזרה בניהול לידים'),
    ]
    getOrCreateAiState.mockResolvedValue({
      aiState: 'ai_qualifying',
      aiTurnCount: 6,
      qualification: { need: 'ניהול לידים', cognition: { salesStrategy: 'explain' } },
    })
    const send = vi.fn(async () => ({ ok: true as const, wamid: 'wamid.578-organize' }))
    const generateQualify = vi.fn(async () => ({
      ...OK_GEN,
      reply: EXPLANATION,
      extracted: { need: 'ניהול לידים' },
      objective: 'advance' as const,
      salesMove: 'PRODUCT_FIT' as const,
      hotSignal: false,
      uncertain: false,
    }))
    const outcome = await processQualifyJob(JOB, CTX, { send, generateQualify })
    expect(outcome).toBe('sent')
    expect(generateQualify).toHaveBeenCalledTimes(1)
    expect(generateQualify).toHaveBeenCalledWith(
      expect.objectContaining({ salesMove: 'PRODUCT_FIT', salesStrategy: 'product_fit' }),
    )
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ body: EXPLANATION }))
    expect(send).not.toHaveBeenCalledWith(expect.objectContaining({ body: ADVANCE_FALLBACK }))
    expect(markEscalated).not.toHaveBeenCalled()
    expect(skipAutoResponseJob).not.toHaveBeenCalledWith(61, 'max_turns')
  })
})

describe('P0 ceiling override + P1 post-handoff + no-dash send', () => {
  function inbound(text: string) {
    return {
      direction: 'inbound' as const,
      text,
      sentByUserId: null,
      channelTimestamp: new Date(),
      createdAt: new Date(),
      metadata: null,
    }
  }

  it('A: aiTurnCount=7 + HANDOFF_REQUEST hands off without GPT', async () => {
    tableRows.messageList = [inbound('סבבה, תעביר אותי לנציג אנושי')]
    getOrCreateAiState.mockResolvedValue({
      aiState: 'ai_qualifying',
      aiTurnCount: 7,
      qualification: { need: 'עזרה לעסק למכירת ויברטורים', cognition: { salesStrategy: 'next_step' } },
    })
    const send = vi.fn(async () => ({ ok: true as const, wamid: 'wamid.p0-a' }))
    const generateQualify = vi.fn()
    const outcome = await processQualifyJob(JOB, CTX, { send, generateQualify })
    expect(outcome).toBe('sent')
    expect(generateQualify).not.toHaveBeenCalled()
    expect(skipAutoResponseJob).not.toHaveBeenCalledWith(61, 'max_turns')
    expect(markEscalated).toHaveBeenCalledWith(382, 'human_request')
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({ body: 'מישהו מהצוות ימשיך איתך ויחזור אליך בהקדם.' }),
    )
  })

  it('B: aiTurnCount=7 + PRODUCT_FIT skips max_turns', async () => {
    tableRows.messageList = [inbound('זה מתאים לעסק שלי')]
    getOrCreateAiState.mockResolvedValue({
      aiState: 'ai_qualifying',
      aiTurnCount: 7,
      qualification: { cognition: { salesStrategy: 'product_fit' } },
    })
    const send = vi.fn()
    const generateQualify = vi.fn()
    const outcome = await processQualifyJob(JOB, CTX, { send, generateQualify })
    expect(outcome).toBe('skipped')
    expect(skipAutoResponseJob).toHaveBeenCalledWith(61, 'max_turns')
    expect(generateQualify).not.toHaveBeenCalled()
    expect(markEscalated).not.toHaveBeenCalled()
    expect(send).not.toHaveBeenCalled()
  })

  it('C: aiTurnCount=7 + BUYING_SIGNAL skips with no handoff', async () => {
    tableRows.messageList = [inbound('אני רוצה להתחיל')]
    getOrCreateAiState.mockResolvedValue({
      aiState: 'ai_qualifying',
      aiTurnCount: 7,
      qualification: {},
    })
    const send = vi.fn()
    const generateQualify = vi.fn()
    const outcome = await processQualifyJob(JOB, CTX, { send, generateQualify })
    expect(outcome).toBe('skipped')
    expect(skipAutoResponseJob).toHaveBeenCalledWith(61, 'max_turns')
    expect(markEscalated).not.toHaveBeenCalled()
    expect(generateQualify).not.toHaveBeenCalled()
  })

  it('D: escalated + אתה מעביר אותי? sends a status confirmation without GPT', async () => {
    tableRows.messageList = [inbound('אתה מעביר אותי?')]
    getOrCreateAiState.mockResolvedValue({
      aiState: 'escalated',
      aiTurnCount: 7,
      qualification: {},
    })
    const send = vi.fn(async () => ({ ok: true as const, wamid: 'wamid.p1-d' }))
    const generateQualify = vi.fn()
    const outcome = await processQualifyJob(JOB, CTX, { send, generateQualify })
    expect(outcome).toBe('sent')
    expect(generateQualify).not.toHaveBeenCalled()
    expect(markEscalated).not.toHaveBeenCalled()
    expect(skipAutoResponseJob).not.toHaveBeenCalledWith(61, 'already_escalated')
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({ body: 'כן, העברתי את הבקשה לנציג. הוא יחזור אליך בהקדם.' }),
    )
  })

  it('E: escalated + העברת? sends the same confirmation', async () => {
    tableRows.messageList = [inbound('העברת?')]
    getOrCreateAiState.mockResolvedValue({
      aiState: 'escalated',
      aiTurnCount: 7,
      qualification: {},
    })
    const send = vi.fn(async () => ({ ok: true as const, wamid: 'wamid.p1-e' }))
    const generateQualify = vi.fn()
    const outcome = await processQualifyJob(JOB, CTX, { send, generateQualify })
    expect(outcome).toBe('sent')
    expect(generateQualify).not.toHaveBeenCalled()
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({ body: 'כן, העברתי את הבקשה לנציג. הוא יחזור אליך בהקדם.' }),
    )
  })

  it('F: escalated + תודה does not send', async () => {
    tableRows.messageList = [inbound('תודה')]
    getOrCreateAiState.mockResolvedValue({
      aiState: 'escalated',
      aiTurnCount: 7,
      qualification: {},
    })
    const send = vi.fn()
    const generateQualify = vi.fn()
    const outcome = await processQualifyJob(JOB, CTX, { send, generateQualify })
    expect(outcome).toBe('skipped')
    expect(skipAutoResponseJob).toHaveBeenCalledWith(61, 'post_handoff_ack')
    expect(send).not.toHaveBeenCalled()
    expect(generateQualify).not.toHaveBeenCalled()
  })

  it('G: generated em dash is normalized before send', async () => {
    tableRows.messageList = [inbound('איך אתה יכול לעזור')]
    getOrCreateAiState.mockResolvedValue({
      aiState: 'ai_qualifying',
      aiTurnCount: 1,
      qualification: {},
    })
    const send = vi.fn(async () => ({ ok: true as const, wamid: 'wamid.dash' }))
    const generateQualify = vi.fn(async () => ({
      ...OK_GEN,
      reply: 'הלידים מרוכזים במקום אחד — כך קל לעקוב.',
    }))
    const outcome = await processQualifyJob(JOB, CTX, { send, generateQualify })
    expect(outcome).toBe('sent')
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({ body: 'הלידים מרוכזים במקום אחד, כך קל לעקוב.' }),
    )
    expect(markEscalated).not.toHaveBeenCalled()
  })

  it('product continue-the-conversation answer attaches Product Knowledge and does not immediate-handoff', async () => {
    const prev = process.env.IRE_PRODUCT_KNOWLEDGE_AGENCY_IDS
    process.env.IRE_PRODUCT_KNOWLEDGE_AGENCY_IDS = '103'
    tableRows.messageList = [
      inbound('ימשיך שיחה  עם הלקוח'),
      {
        direction: 'outbound' as const,
        text: 'הבנתי, מענה אוטומטי לפניות חדשות בוואטסאפ כדי שלא יישארו בלי תגובה. היית רוצה שהוא רק ישיב מיד, או גם ימשיך את השיחה עם הלקוח?',
        sentByUserId: 332,
        channelTimestamp: new Date(),
        createdAt: new Date(),
        metadata: { source: 'auto_response', reason: 'qualify_turn' },
      },
    ]
    getOrCreateAiState.mockResolvedValue({
      aiState: 'ai_qualifying',
      aiTurnCount: 4,
      qualification: { need: 'להשיג שקט וניהול נכון בעסק', cognition: { salesStrategy: 'discover' } },
    })
    const send = vi.fn(async () => ({ ok: true as const, wamid: 'wamid.conv-cap' }))
    const generateQualify = vi.fn(async () => OK_GEN)
    try {
      const outcome = await processQualifyJob(JOB, CTX, { send, generateQualify })
      expect(outcome).toBe('sent')
      expect(generateQualify).toHaveBeenCalledTimes(1)
      expect(generateQualify).toHaveBeenCalledWith(
        expect.objectContaining({
          salesMove: expect.stringMatching(/^PRODUCT_(QUESTION|FIT)$/),
          salesStrategy: expect.stringMatching(/^(product_fit|explain|how_it_works)$/),
          productKnowledgeBlock: expect.stringContaining('whatsapp_inbound_auto_response'),
        }),
      )
      expect(markEscalated).not.toHaveBeenCalled()
      expect(send).not.toHaveBeenCalledWith(
        expect.objectContaining({ body: 'מישהו מהצוות ימשיך איתך ויחזור אליך בהקדם.' }),
      )
      expect(recordTurn).toHaveBeenCalledTimes(1)
    } finally {
      if (prev === undefined) delete process.env.IRE_PRODUCT_KNOWLEDGE_AGENCY_IDS
      else process.env.IRE_PRODUCT_KNOWLEDGE_AGENCY_IDS = prev
    }
  })

  it('תחבר אותי לנציג still immediate-handoffs without GPT', async () => {
    tableRows.messageList = [inbound('תחבר אותי לנציג')]
    getOrCreateAiState.mockResolvedValue({
      aiState: 'ai_qualifying',
      aiTurnCount: 4,
      qualification: {},
    })
    const send = vi.fn(async () => ({ ok: true as const, wamid: 'wamid.p0-connect' }))
    const generateQualify = vi.fn()
    const outcome = await processQualifyJob(JOB, CTX, { send, generateQualify })
    expect(outcome).toBe('sent')
    expect(generateQualify).not.toHaveBeenCalled()
    expect(markEscalated).toHaveBeenCalledWith(382, 'human_request')
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({ body: 'מישהו מהצוות ימשיך איתך ויחזור אליך בהקדם.' }),
    )
  })
})

