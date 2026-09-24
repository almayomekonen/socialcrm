/**
 * P3.3 — message.inbound emitter boundary.
 *
 * HARNESS LIMITATION: `npm run test:notifications` runs with VITEST_NO_DB=1, so
 * this file cannot exercise a live Postgres insert against inbox_messages. It
 * drives the REAL `ingestWhatsappInbound` function with the DB accessors and
 * `notifyEvent` mocked, which is enough to prove:
 *
 *   - emit only when insertInboundMessage returns inserted=true
 *   - event identity uses inbox_messages.id (payload.messageId)
 *   - retries (inserted=false) produce no second notifyEvent call
 *   - two distinct message ids produce two distinct notifyEvent calls
 *   - payload carries leadId for handler_or_admin resolution
 *
 * Recipient correctness, Awareness toast coexistence, Bell retention, push
 * policy, and cross-tenant isolation are covered by plan / surface / awareness /
 * policy tests that already pin those contracts — this file does not re-open them.
 *
 * Runs without a database: `npm run test:notifications`.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { eventKeyForEvent, messageInboundEventKey } from '@/lib/notifications/eventKey'
import { AWARENESS_OWNED_CATEGORIES, selectToastable } from '@/modules/notifications/surface'
import { leadKey, resolveRecipients, type RecipientContext } from '@/db/notifications/recipients'
import { leadIdForJob, planNotification } from '@/lib/notifications/plan'
import { IN_APP_ONLY_CAPABILITIES, resolveChannels } from '@/lib/notifications/policy'
import { NOTIFICATION_REGISTRY } from '@/lib/notifications/registry'
import type { NotificationEvent, Presence } from '@/lib/notifications/types'
import type { NotificationFeedItem } from '@/modules/notifications/types'

const notifyEvent = vi.fn()
const findOrCreateConversation = vi.fn()
const ensureParticipant = vi.fn()
const insertInboundMessage = vi.fn()
const bumpConversationOnInbound = vi.fn()
const enqueueConversationAnalysis = vi.fn()
const enqueueAutoResponse = vi.fn()

vi.mock('@/lib/notifications/emit', () => ({
  notifyEvent: (...args: unknown[]) => notifyEvent(...args),
}))

vi.mock('@/db/inboxConversations', () => ({
  findOrCreateConversation: (...args: unknown[]) => findOrCreateConversation(...args),
  bumpConversationOnInbound: (...args: unknown[]) => bumpConversationOnInbound(...args),
}))

vi.mock('@/db/inboxParticipants', () => ({
  ensureParticipant: (...args: unknown[]) => ensureParticipant(...args),
}))

vi.mock('@/db/inboxMessages', () => ({
  insertInboundMessage: (...args: unknown[]) => insertInboundMessage(...args),
}))

vi.mock('@/db/conversationIntelligence', () => ({
  enqueueConversationAnalysis: (...args: unknown[]) => enqueueConversationAnalysis(...args),
}))

vi.mock('@/db/autoResponseJobs', () => ({
  enqueueAutoResponse: (...args: unknown[]) => enqueueAutoResponse(...args),
  skipPendingNoResponseJobs: async () => 0,
}))

vi.mock('@/lib/inbox/autoresponse/waTrace', () => ({
  waTrace: () => {},
}))

function makeTrx() {
  const trx: any = vi.fn(() => trx)
  trx.where = vi.fn(() => trx)
  trx.first = vi.fn().mockResolvedValue({ mode: 'off', delaySeconds: 0 })
  // The real knex transaction has .raw(); the ingest path uses it to ask
  // whether this conversation belongs to the deterministic questionnaire
  // (which suppresses the Copilot analysis job). Answering "no" keeps this
  // suite's subject unchanged: an ordinary AI-agency conversation.
  trx.raw = vi.fn().mockResolvedValue({ rows: [{ hit: false }] })
  trx.__marker = 'ingest-trx'
  return trx
}

vi.mock('@/config/db', () => ({
  db: {
    transaction: async (fn: (t: unknown) => Promise<unknown>) => {
      const t = makeTrx()
      Object.assign(t, { __marker: 'ingest-trx' })
      return fn(t)
    },
  },
}))

const { ingestWhatsappInbound } = await import('@/lib/inbox/ingestWhatsappInbound')

const AGENCY = 7
const LEAD = 42
const CONV = 900
const HANDLER = 55
const ADMIN = 1

function rawMessage(id: string) {
  return {
    id,
    from: '972501234567',
    timestamp: '1717000000',
    type: 'text',
    text: { body: 'שלום' },
  }
}

function ingestInput(over: Record<string, unknown> = {}) {
  return {
    agencyId: AGENCY,
    leadId: LEAD,
    businessPhoneNumberId: 'biz-1',
    customerWaId: '972501234567',
    customerName: 'דנה',
    rawMessage: rawMessage('wamid.AAA'),
    ...over,
  }
}

beforeEach(() => {
  notifyEvent.mockReset()
  notifyEvent.mockResolvedValue({ enqueued: true, jobId: 1 })
  findOrCreateConversation.mockReset()
  findOrCreateConversation.mockResolvedValue(CONV)
  ensureParticipant.mockReset()
  ensureParticipant.mockResolvedValue(undefined)
  insertInboundMessage.mockReset()
  bumpConversationOnInbound.mockReset()
  bumpConversationOnInbound.mockResolvedValue(undefined)
  enqueueConversationAnalysis.mockReset()
  enqueueConversationAnalysis.mockResolvedValue(undefined)
  enqueueAutoResponse.mockReset()
  enqueueAutoResponse.mockResolvedValue(null)
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('ingestWhatsappInbound → notifyEvent(message.inbound)', () => {
  it('one inbound message → one notification event', async () => {
    insertInboundMessage.mockResolvedValue({ id: 11, inserted: true, sequence: 1 })

    await ingestWhatsappInbound(ingestInput())

    expect(notifyEvent).toHaveBeenCalledTimes(1)
    expect(notifyEvent.mock.calls[0][0]).toMatchObject({
      type: 'message.inbound',
      agencyId: AGENCY,
      entityType: 'conversation',
      entityId: CONV,
      actorUserId: null,
      payload: {
        leadId: LEAD,
        leadName: 'דנה',
        messageId: 11,
        provider: 'whatsapp',
      },
    })
    expect(notifyEvent.mock.calls[0][1]).toMatchObject({ trx: expect.anything() })
  })

  it('ingestion retry (inserted=false) → no notification emit', async () => {
    insertInboundMessage.mockResolvedValue({ id: 11, inserted: false, sequence: 1 })

    await ingestWhatsappInbound(ingestInput())

    expect(notifyEvent).not.toHaveBeenCalled()
    expect(bumpConversationOnInbound).not.toHaveBeenCalled()
  })

  it('two different messages in the same conversation → two notifications', async () => {
    insertInboundMessage
      .mockResolvedValueOnce({ id: 11, inserted: true, sequence: 1 })
      .mockResolvedValueOnce({ id: 12, inserted: true, sequence: 2 })

    await ingestWhatsappInbound(ingestInput({ rawMessage: rawMessage('wamid.ONE') }))
    await ingestWhatsappInbound(ingestInput({ rawMessage: rawMessage('wamid.TWO') }))

    expect(notifyEvent).toHaveBeenCalledTimes(2)
    const keys = notifyEvent.mock.calls.map(([ev]) => eventKeyForEvent(ev as NotificationEvent))
    expect(keys).toEqual([
      'message.inbound:7:conversation:900:msg:11',
      'message.inbound:7:conversation:900:msg:12',
    ])
  })

  it('event identity remains stable for the same persisted message id', async () => {
    insertInboundMessage.mockResolvedValue({ id: 11, inserted: true, sequence: 1 })
    await ingestWhatsappInbound(ingestInput())
    const first = eventKeyForEvent(notifyEvent.mock.calls[0][0] as NotificationEvent)

    notifyEvent.mockClear()
    insertInboundMessage.mockResolvedValue({ id: 11, inserted: true, sequence: 1 })
    await ingestWhatsappInbound(ingestInput())
    const second = eventKeyForEvent(notifyEvent.mock.calls[0][0] as NotificationEvent)

    expect(first).toBe(second)
    expect(first).toBe('message.inbound:7:conversation:900:msg:11')
  })
})

describe('message.inbound event identity (discriminator choice)', () => {
  const base = (messageId: number): NotificationEvent => ({
    type: 'message.inbound',
    agencyId: AGENCY,
    entityType: 'conversation',
    entityId: CONV,
    actorUserId: null,
    occurredAt: new Date('2026-08-12T09:00:00.000Z'),
    payload: { leadId: LEAD, messageId },
  })

  it('uses inbox_messages.id — not externalId, not once-per-conversation', () => {
    expect(messageInboundEventKey(base(11))).toBe('message.inbound:7:conversation:900:msg:11')
    // Without a discriminator the second message on the conversation would vanish.
    expect(eventKeyForEvent(base(11))).not.toBe(`message.inbound:${AGENCY}:conversation:${CONV}`)
  })

  it('rejects a missing messageId rather than inventing a once-per-conversation key', () => {
    expect(() =>
      messageInboundEventKey({
        ...base(11),
        payload: { leadId: LEAD },
      }),
    ).toThrow(/messageId/)
  })
})

describe('recipient is correct — handler_or_admin via payload.leadId', () => {
  function context(over?: { handler?: number | null; leadPresent?: boolean }): RecipientContext {
    const handlerByLead = new Map<string, number | null>()
    if (over?.leadPresent !== false) {
      const handler = over && 'handler' in over ? over.handler! : HANDLER
      handlerByLead.set(leadKey(AGENCY, LEAD), handler ?? null)
    }
    return { handlerByLead, adminsByAgency: new Map([[AGENCY, [ADMIN]]]) }
  }

  it('routes to the assigned נציג of the conversation lead', () => {
    const leadId = leadIdForJob({
      entityType: 'conversation',
      entityId: CONV,
      payload: { leadId: LEAD, messageId: 11 },
    })
    expect(leadId).toBe(LEAD)
    expect(
      resolveRecipients({ rule: 'handler_or_admin', agencyId: AGENCY, leadId, context: context() }),
    ).toEqual([HANDLER])
  })

  it('never crosses tenants: same lead id, wrong agency → nobody', () => {
    expect(
      resolveRecipients({
        rule: 'handler_or_admin',
        agencyId: 999,
        leadId: LEAD,
        context: context(),
      }),
    ).toEqual([])
  })

  it('planNotification keeps in_app so Bell/Center still receive the row', () => {
    const result = planNotification({
      job: {
        agencyId: AGENCY,
        type: 'message.inbound',
        actorUserId: null,
        entityType: 'conversation',
        entityId: CONV,
        payload: { leadId: LEAD, leadName: 'דנה', messageId: 11 },
        createdAt: '2026-08-12T09:00:00.000Z',
      },
      context: context(),
      presence: () => 'online' as Presence,
      capabilities: IN_APP_ONLY_CAPABILITIES,
    })
    expect('plan' in result).toBe(true)
    if (!('plan' in result)) return
    expect(result.plan.recipients.map((r) => r.userId)).toEqual([HANDLER])
    expect(result.plan.recipients[0].channels).toEqual(['in_app'])
    expect(result.plan.category).toBe('messages')
    expect(result.plan.deepLink).toBe(`/inbox?conversation=${CONV}`)
  })
})

describe('Awareness coexistence — one visible alert, notification row may exist', () => {
  it('selectToastable suppresses messages while Awareness owns the toast', () => {
    const item: NotificationFeedItem = {
      id: 1,
      type: 'message.inbound',
      category: 'messages',
      priority: 'high',
      title: 'הודעה חדשה — דנה',
      body: null,
      entityType: 'conversation',
      entityId: CONV,
      deepLink: `/inbox?conversation=${CONV}`,
      groupCount: 1,
      createdAt: '2026-08-12T12:00:30.000Z',
      seenAt: null,
      readAt: null,
      toastEligible: true,
    }
    expect(
      selectToastable({
        items: [item],
        mountedAt: '2026-08-12T12:00:00.000Z',
        alreadyToasted: new Set(),
        suppressedCategories: AWARENESS_OWNED_CATEGORIES,
      }),
    ).toEqual([])
  })
})

describe('push remains governed by existing policy/presence', () => {
  it('message.inbound never pushes while online; pushes when idle/offline when capable', () => {
    const policy = NOTIFICATION_REGISTRY['message.inbound'].channels
    expect(policy.online).toEqual(['in_app', 'toast'])
    expect(policy.idle).toEqual(['in_app', 'web_push'])
    expect(policy.offline).toEqual(['in_app', 'web_push'])

    const all = { in_app: true, toast: true, web_push: true, email: true }
    expect(
      resolveChannels({
        policy,
        presence: 'online',
        capabilities: all,
        priority: 'high',
      }),
    ).toEqual(['in_app', 'toast'])
    expect(
      resolveChannels({
        policy,
        presence: 'offline',
        capabilities: all,
        priority: 'high',
      }),
    ).toEqual(['in_app', 'web_push'])
    // Worker default capabilities still suppress push until the flag+VAPID gate opens.
    expect(
      resolveChannels({
        policy,
        presence: 'offline',
        capabilities: IN_APP_ONLY_CAPABILITIES,
        priority: 'high',
      }),
    ).toEqual(['in_app'])
  })
})

describe('leadless inbound — store the conversation, never treat it as a lead', () => {
  it('still emits message.inbound (הודעה חדשה) and skips Lead-only analysis', async () => {
    insertInboundMessage.mockResolvedValue({ id: 21, inserted: true, sequence: 1 })

    await ingestWhatsappInbound(ingestInput({ leadId: null }))

    expect(notifyEvent).toHaveBeenCalledTimes(1)
    expect(notifyEvent.mock.calls[0][0]).toMatchObject({
      type: 'message.inbound',
      payload: { leadId: null, messageId: 21, provider: 'whatsapp' },
    })
    // Copilot conversation analysis stays Lead-scoped.
    expect(enqueueConversationAnalysis).not.toHaveBeenCalled()
  })

  it('Task 13: a non-personal Contact still gets a durable IRE job with leadId NULL', async () => {
    insertInboundMessage.mockResolvedValue({ id: 21, inserted: true, sequence: 1 })

    await ingestWhatsappInbound(ingestInput({ leadId: null }))

    expect(enqueueAutoResponse).toHaveBeenCalledTimes(1)
    expect(enqueueAutoResponse.mock.calls[0][1]).toMatchObject({ leadId: null })
  })

  it('leadId=null has no handler — not a new-lead notification', () => {
    expect(leadIdForJob({ entityType: 'conversation', entityId: CONV, payload: { leadId: null, messageId: 21 } })).toBeNull()
    expect(
      resolveRecipients({
        rule: 'handler_or_admin',
        agencyId: AGENCY,
        leadId: null,
        context: { handlerByLead: new Map(), adminsByAgency: new Map([[AGENCY, [ADMIN]]]) },
      }),
    ).toEqual([])
  })
})

