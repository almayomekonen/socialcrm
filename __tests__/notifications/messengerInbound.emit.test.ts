/**
 * message.messenger_inbound — a customer's Facebook Messenger message reaches the
 * notification engine exactly as a WhatsApp arrival does (bell, toast, push when
 * away), with Messenger's own identity so nothing collides with the WhatsApp inbox.
 *
 * Runs without a database.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  row: null as Record<string, unknown> | null,
  throwOnRead: false,
  wheres: [] as unknown[],
  notify: vi.fn(async (_event: { payload?: Record<string, unknown> }) => ({ enqueued: true, jobId: 1 })),
}))

vi.mock('@/config/db', () => {
  const qb: Record<string, unknown> = {}
  qb.leftJoin = () => qb
  qb.where = (w: unknown) => {
    h.wheres.push(w)
    return qb
  }
  qb.first = async () => {
    if (h.throwOnRead) throw new Error('db down')
    return h.row
  }
  return { db: () => qb }
})
vi.mock('@/lib/notifications/emit', () => ({ notifyEvent: h.notify }))

import { eventKeyForEvent } from '@/lib/notifications/eventKey'
import { conversationInboundKey, messengerInboundKey } from '@/lib/notifications/collapseKeys'
import { planNotification, type PlanInput } from '@/lib/notifications/plan'
import { NOTIFICATION_REGISTRY } from '@/lib/notifications/registry'
import { resolveRecipients, type RecipientContext } from '@/db/notifications/recipients'
import { notifyMessengerInbound } from '@/lib/facebook/messenger/notifyMessengerInbound'
import type { EventContext, NotificationEvent } from '@/lib/notifications/types'

const DEF = NOTIFICATION_REGISTRY['message.messenger_inbound']
const AGENCY = 103
const CONV = 7

const ctx = (over: Partial<EventContext> = {}): EventContext => ({
  type: 'message.messenger_inbound',
  agencyId: AGENCY,
  entityType: 'messenger_conversation',
  entityId: CONV,
  actorUserId: null,
  occurredAt: new Date('2026-09-15T09:00:00Z'),
  payload: { leadName: 'דנה לוי', messageId: 55, leadId: null },
  groupCount: 1,
  ...over,
})

const recipientContext = (over: Partial<RecipientContext> = {}): RecipientContext => ({
  handlerByLead: new Map(),
  adminsByAgency: new Map([
    [AGENCY, [1, 2]],
    [999, [900]],
  ]),
  platformOperatorIds: [],
  ...over,
})

beforeEach(() => {
  h.row = null
  h.throwOnRead = false
  h.wheres = []
  h.notify.mockClear()
})

describe('identity — never collides with the WhatsApp inbox', () => {
  it('event key is per stored Messenger message, namespaced by type and entity', () => {
    const event: NotificationEvent = { ...ctx(), payload: { messageId: 55 } }
    expect(eventKeyForEvent(event)).toBe(`message.messenger_inbound:${AGENCY}:messenger_conversation:${CONV}:msg:55`)
    expect(eventKeyForEvent({ ...event, payload: { messageId: 56 } })).not.toBe(eventKeyForEvent(event))
  })

  it('an event without the stored message id is refused rather than collapsing every message into one key', () => {
    expect(() => eventKeyForEvent({ ...ctx(), payload: {} })).toThrow(/messageId/)
  })

  it('collapse key differs from a WhatsApp conversation with the same id', () => {
    expect(messengerInboundKey(ctx())).toBe(`messenger:${CONV}:inbound`)
    expect(messengerInboundKey(ctx())).not.toBe(conversationInboundKey({ ...ctx(), entityType: 'conversation' }))
  })

  it('opens the Messenger conversation, not a WhatsApp one', () => {
    expect(DEF.entity(ctx())).toEqual({ type: 'messenger_conversation', id: CONV })
    expect(DEF.deepLink(ctx())).toBe(`/inbox/messenger?c=${CONV}`)
  })
})

describe('copy', () => {
  it('names the sender when known, and says Messenger', () => {
    expect(DEF.title(ctx())).toBe('הודעת Messenger חדשה — דנה לוי')
  })

  it('degrades to name-free copy instead of inventing a name', () => {
    expect(DEF.title(ctx({ payload: { messageId: 55, leadName: null } }))).toBe('הודעת Messenger חדשה')
  })

  it('reads correctly right-to-left with a Latin name: Hebrew always closes the text before the dash', () => {
    // A Latin word right before " — " fuses with a Latin name into one left-to-right
    // run and the line renders scrambled ("Messenger — Almayo Mekonen-הודעה חדשה ב").
    for (const groupCount of [1, 4]) {
      const title = DEF.title(ctx({ groupCount, payload: { messageId: 55, leadName: 'Almayo Mekonen' } }))
      const [lead, name] = title.split(' — ')
      expect(name).toBe('Almayo Mekonen')
      expect(lead).toMatch(/[\u0590-\u05FF]$/)
    }
  })

  it('counts the arrivals the open row absorbed', () => {
    expect(DEF.title(ctx({ groupCount: 3 }))).toBe('3 הודעות Messenger חדשות — דנה לוי')
  })
})

describe('recipients — lead_handler_or_admins', () => {
  const resolve = (leadId: number | null, context = recipientContext()) =>
    resolveRecipients({ rule: DEF.recipients, agencyId: AGENCY, leadId, context })

  it('a conversation with no ליד yet goes to the agency admins — never another agency', () => {
    expect(resolve(null)).toEqual([1, 2])
  })

  it("a linked ליד with a נציג goes to that נציג only", () => {
    expect(resolve(40, recipientContext({ handlerByLead: new Map([[`${AGENCY}:40`, 7]]) }))).toEqual([7])
  })

  it('a linked but unassigned ליד goes to the admins', () => {
    expect(resolve(40, recipientContext({ handlerByLead: new Map([[`${AGENCY}:40`, null]]) }))).toEqual([1, 2])
  })

  it('a ליד the context does not know still reaches the admins — the conversation needs an owner', () => {
    expect(resolve(41)).toEqual([1, 2])
  })

  it('handler_or_admin (WhatsApp) is unchanged: no ליד, nobody', () => {
    expect(resolveRecipients({ rule: 'handler_or_admin', agencyId: AGENCY, leadId: null, context: recipientContext() })).toEqual([])
  })
})

describe('channels — the same urgency as a WhatsApp arrival', () => {
  const plan = (presence: 'online' | 'offline') =>
    planNotification({
      job: {
        agencyId: AGENCY,
        type: 'message.messenger_inbound',
        actorUserId: null,
        entityType: 'messenger_conversation',
        entityId: CONV,
        payload: { messageId: 55, leadName: 'דנה לוי', leadId: null },
        createdAt: '2026-09-15T09:00:00.000Z',
      },
      context: recipientContext(),
      presence: () => presence,
      capabilities: { in_app: true, toast: true, web_push: true, email: false },
    } satisfies PlanInput)

  it('online: bell and toast; away: bell and push', () => {
    const online = plan('online')
    const offline = plan('offline')
    if (!('plan' in online) || !('plan' in offline)) throw new Error('expected plans')
    expect(online.plan.recipients.map((r) => r.channels)).toEqual([
      ['in_app', 'toast'],
      ['in_app', 'toast'],
    ])
    expect(offline.plan.recipients[0].channels).toEqual(['in_app', 'web_push'])
    expect(online.plan).toMatchObject({
      category: 'messages',
      priority: 'high',
      entityType: 'messenger_conversation',
      deepLink: `/inbox/messenger?c=${CONV}`,
      collapseKey: `messenger:${CONV}:inbound`,
    })
  })
})

describe('notifyMessengerInbound — the emit site', () => {
  const input = { agencyId: AGENCY, conversationId: CONV, messageId: 55, occurredAt: new Date('2026-09-15T09:00:00Z') }

  it('prefers the linked ליד name, like the Messenger tab', async () => {
    h.row = { leadId: 40, customerName: 'Dana Messenger', firstName: 'דנה', lastName: 'לוי' }
    await notifyMessengerInbound(input)
    expect(h.notify).toHaveBeenCalledWith({
      type: 'message.messenger_inbound',
      agencyId: AGENCY,
      entityType: 'messenger_conversation',
      entityId: CONV,
      actorUserId: null,
      occurredAt: input.occurredAt,
      payload: { leadId: 40, leadName: 'דנה לוי', messageId: 55, provider: 'messenger' },
    })
  })

  it('falls back to the Messenger profile name, then to no name', async () => {
    h.row = { leadId: null, customerName: 'Dana Messenger', firstName: null, lastName: null }
    await notifyMessengerInbound(input)
    expect(h.notify.mock.calls[0]?.[0].payload).toMatchObject({ leadId: null, leadName: 'Dana Messenger' })

    h.row = { leadId: null, customerName: null, firstName: null, lastName: null }
    await notifyMessengerInbound(input)
    expect(h.notify.mock.calls[1]?.[0].payload).toMatchObject({ leadName: null })
  })

  it('reads the conversation inside the agency the message was stored under', async () => {
    h.row = { leadId: null, customerName: null, firstName: null, lastName: null }
    await notifyMessengerInbound(input)
    expect(h.wheres).toContainEqual({ 'mc.id': CONV, 'mc.agencyId': AGENCY })
  })

  it('reports a failed enqueue so the worker retries, and treats a deliberate refusal as done', async () => {
    h.row = { leadId: null, customerName: null, firstName: null, lastName: null }
    expect(await notifyMessengerInbound(input)).toBe(true)
    h.notify.mockResolvedValueOnce({ enqueued: false, reason: 'duplicate' } as never)
    expect(await notifyMessengerInbound(input)).toBe(true)
    h.notify.mockResolvedValueOnce({ enqueued: false, reason: 'kill_switch' } as never)
    expect(await notifyMessengerInbound(input)).toBe(true)
    h.notify.mockResolvedValueOnce({ enqueued: false, reason: 'error' } as never)
    expect(await notifyMessengerInbound(input)).toBe(false)
  })

  it('a failed name read still notifies — name-free, to the admins', async () => {
    h.throwOnRead = true
    await notifyMessengerInbound(input)
    expect(h.notify).toHaveBeenCalledTimes(1)
    expect(h.notify.mock.calls[0]?.[0].payload).toMatchObject({ leadId: null, leadName: null, messageId: 55 })
  })
})
