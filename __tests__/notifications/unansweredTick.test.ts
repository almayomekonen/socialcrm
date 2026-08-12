/**
 * Task 7 — message.unanswered tick.
 *
 * Proves: 30m threshold, insert-once eventKey, outbound clears candidacy,
 * closed/archived/terminal silence, handler_or_admin, IN_APP_ONLY (no toast /
 * no push), collapse key, Awareness non-interference. VITEST_NO_DB=1 safe.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { eventKeyForEvent, messageUnansweredEventKey } from '@/lib/notifications/eventKey'
import { conversationUnansweredKey } from '@/lib/notifications/collapseKeys'
import { leadIdForJob, planNotification, type PlanInput } from '@/lib/notifications/plan'
import { IN_APP_ONLY, IN_APP_ONLY_CAPABILITIES, resolveChannels } from '@/lib/notifications/policy'
import { NOTIFICATION_REGISTRY } from '@/lib/notifications/registry'
import { AWARENESS_OWNED_CATEGORIES, selectToastable } from '@/modules/notifications/surface'
import { leadKey, resolveRecipients, type RecipientContext } from '@/db/notifications/recipients'
import { UNANSWERED_THRESHOLD_MS } from '@/db/notifications/unanswered'
import type { EventContext, NotificationEvent, Presence } from '@/lib/notifications/types'
import type { NotificationFeedItem } from '@/modules/notifications/types'

const notifyEvent = vi.fn()
const isNotificationsEnabled = vi.fn()
const findUnansweredConversations = vi.fn()

vi.mock('@/lib/notifications/emit', () => ({
  notifyEvent: (...args: unknown[]) => notifyEvent(...args),
}))

vi.mock('@/lib/notifications/flags', () => ({
  isNotificationsEnabled: (...args: unknown[]) => isNotificationsEnabled(...args),
}))

vi.mock('@/db/notifications/unanswered', async () => {
  const actual = await vi.importActual<typeof import('@/db/notifications/unanswered')>(
    '@/db/notifications/unanswered',
  )
  return {
    ...actual,
    findUnansweredConversations: (...args: unknown[]) => findUnansweredConversations(...args),
  }
})

const { tickUnansweredNotifications } = await import('@/lib/notifications/unansweredTick')
const { findUnansweredConversationsQuery } = await import('@/db/notifications/unanswered')

const NOW_MS = Date.parse('2026-08-12T12:00:00.000Z')
const AGENCY = 7
const CONV = 900
const LEAD = 42
const MSG = 1100
const HANDLER = 55
const ADMIN = 1

const candidate = (over: Record<string, unknown> = {}) => ({
  conversationId: CONV,
  agencyId: AGENCY,
  leadId: LEAD,
  messageId: MSG,
  lastInboundAt: new Date(NOW_MS - UNANSWERED_THRESHOLD_MS),
  firstName: 'דנה',
  lastName: 'לוי',
  ...over,
})

beforeEach(() => {
  notifyEvent.mockReset()
  notifyEvent.mockResolvedValue({ enqueued: true, jobId: 1 })
  isNotificationsEnabled.mockReset()
  isNotificationsEnabled.mockReturnValue(true)
  findUnansweredConversations.mockReset()
  findUnansweredConversations.mockResolvedValue([])
})

describe('threshold constant', () => {
  it('is locked at 30 minutes', () => {
    expect(UNANSWERED_THRESHOLD_MS).toBe(30 * 60 * 1000)
  })
})

describe('candidate SQL shape', () => {
  it('requires open + inbound + aged lastInboundAt + non-terminal lead + no later outbound', () => {
    const cutoff = new Date(NOW_MS - UNANSWERED_THRESHOLD_MS)
    const { sql, bindings } = findUnansweredConversationsQuery(cutoff, 200).toSQL()
    const lower = sql.toLowerCase()
    expect(lower).toContain('inbox_conversations')
    expect(lower).toContain(`cv.state = 'open'`)
    expect(lower).toContain(`cv."lastdirection" = 'inbound'`)
    expect(lower).toContain('cv."lastinboundat" <=')
    expect(lower).toContain(`status is distinct from 'closed'`)
    expect(lower).toContain(`status is distinct from 'lost'`)
    expect(lower).toContain(`direction = 'inbound'`)
    expect(lower).toContain(`direction = 'outbound'`)
    expect(lower).toContain('not exists')
    expect(lower).toContain('limit')
    expect(lower).not.toContain('lastreadat')
    expect(lower).not.toContain('quiet')
    expect(bindings).toEqual([cutoff, 200])
  })
})

describe('eventKey + collapse + channels', () => {
  const event = (over: Partial<NotificationEvent> = {}): NotificationEvent => ({
    type: 'message.unanswered',
    agencyId: AGENCY,
    entityType: 'conversation',
    entityId: CONV,
    actorUserId: null,
    occurredAt: new Date(NOW_MS),
    payload: { leadId: LEAD, messageId: MSG, leadName: 'דנה לוי' },
    ...over,
  })

  it('stable eventKey uses durable inbound message id', () => {
    const key = `message.unanswered:${AGENCY}:conversation:${CONV}:msg:${MSG}`
    expect(messageUnansweredEventKey(event())).toBe(key)
    expect(eventKeyForEvent(event())).toBe(key)
    expect(eventKeyForEvent(event())).toBe(eventKeyForEvent(event()))
  })

  it('new inbound head → distinct eventKey (new unanswered episode)', () => {
    const a = eventKeyForEvent(event({ payload: { leadId: LEAD, messageId: 1100 } }))
    const b = eventKeyForEvent(event({ payload: { leadId: LEAD, messageId: 2200 } }))
    expect(a).not.toBe(b)
    expect(b).toBe(`message.unanswered:${AGENCY}:conversation:${CONV}:msg:2200`)
  })

  it('exact collapseKey conversation:{id}:unanswered', () => {
    const ctx: EventContext = {
      type: 'message.unanswered',
      agencyId: AGENCY,
      entityType: 'conversation',
      entityId: CONV,
      actorUserId: null,
      occurredAt: new Date(NOW_MS),
      payload: { leadId: LEAD, messageId: MSG },
      groupCount: 1,
    }
    expect(conversationUnansweredKey(ctx)).toBe(`conversation:${CONV}:unanswered`)
    expect(NOTIFICATION_REGISTRY['message.unanswered'].collapseKey(ctx)).toBe(
      `conversation:${CONV}:unanswered`,
    )
  })

  it('V1 channels are IN_APP_ONLY — no toast, no web_push', () => {
    const policy = NOTIFICATION_REGISTRY['message.unanswered'].channels
    expect(policy).toBe(IN_APP_ONLY)
    for (const presence of ['online', 'idle', 'offline'] as Presence[]) {
      expect(policy[presence]).toEqual(['in_app'])
      expect(
        resolveChannels({
          policy,
          presence,
          capabilities: { in_app: true, toast: true, web_push: true, email: true },
          priority: 'high',
        }),
      ).toEqual(['in_app'])
    }
  })
})

describe('tickUnansweredNotifications', () => {
  it('1 — age < 30m: finder empty → no notification', async () => {
    findUnansweredConversations.mockResolvedValue([])
    await tickUnansweredNotifications({ nowMs: NOW_MS })
    expect(notifyEvent).not.toHaveBeenCalled()
    const cutoff = findUnansweredConversations.mock.calls[0][0] as Date
    expect(cutoff.getTime()).toBe(NOW_MS - UNANSWERED_THRESHOLD_MS)
  })

  it('2 — age >= 30m → one notification with leadId + messageId', async () => {
    findUnansweredConversations.mockResolvedValue([candidate()])
    const summary = await tickUnansweredNotifications({ nowMs: NOW_MS })
    expect(notifyEvent).toHaveBeenCalledTimes(1)
    expect(notifyEvent.mock.calls[0][0]).toMatchObject({
      type: 'message.unanswered',
      agencyId: AGENCY,
      entityType: 'conversation',
      entityId: CONV,
      actorUserId: null,
      payload: { leadId: LEAD, messageId: MSG, leadName: 'דנה לוי' },
    })
    expect(summary.enqueued).toBe(1)
  })

  it('3 — repeated cron → no duplicate enqueue', async () => {
    findUnansweredConversations.mockResolvedValue([candidate()])
    notifyEvent
      .mockResolvedValueOnce({ enqueued: true, jobId: 1 })
      .mockResolvedValueOnce({ enqueued: false, reason: 'duplicate' })

    expect((await tickUnansweredNotifications({ nowMs: NOW_MS })).enqueued).toBe(1)
    expect((await tickUnansweredNotifications({ nowMs: NOW_MS })).enqueued).toBe(0)
    expect(notifyEvent.mock.calls[0][0].payload.messageId).toBe(MSG)
    expect(notifyEvent.mock.calls[1][0].payload.messageId).toBe(MSG)
  })

  it('4/5 — outbound before/after threshold: finder empty → no notification', async () => {
    // SQL excludes conversations with outbound after the inbound head (and
    // lastDirection would already be outbound). Tick never sees them.
    findUnansweredConversations.mockResolvedValue([])
    await tickUnansweredNotifications({ nowMs: NOW_MS })
    expect(notifyEvent).not.toHaveBeenCalled()
  })

  it('6 — new inbound after outbound → new eventKey / new episode', async () => {
    findUnansweredConversations
      .mockResolvedValueOnce([candidate({ messageId: 1100 })])
      .mockResolvedValueOnce([candidate({ messageId: 2200 })])

    await tickUnansweredNotifications({ nowMs: NOW_MS })
    await tickUnansweredNotifications({ nowMs: NOW_MS })

    const first = notifyEvent.mock.calls[0][0] as NotificationEvent
    const second = notifyEvent.mock.calls[1][0] as NotificationEvent
    expect(eventKeyForEvent(first)).toBe(
      `message.unanswered:${AGENCY}:conversation:${CONV}:msg:1100`,
    )
    expect(eventKeyForEvent(second)).toBe(
      `message.unanswered:${AGENCY}:conversation:${CONV}:msg:2200`,
    )
  })

  it('7 — closed/archived conversations excluded by SQL (state = open)', async () => {
    const { sql } = findUnansweredConversationsQuery(new Date(NOW_MS), 10).toSQL()
    expect(sql.toLowerCase()).toContain(`cv.state = 'open'`)
    expect(sql.toLowerCase()).not.toContain(`state = 'closed'`)
    expect(sql.toLowerCase()).not.toContain(`state = 'archived'`)
  })

  it('8 — closed/lost lead excluded by SQL', async () => {
    const { sql } = findUnansweredConversationsQuery(new Date(NOW_MS), 10).toSQL()
    const lower = sql.toLowerCase()
    expect(lower).toContain(`'closed'`)
    expect(lower).toContain(`'lost'`)
  })

  it('13 — bot/autoresponse outbound clears candidate via NOT EXISTS outbound', async () => {
    // Any outbound (sentByUserId null or not, status failed or not) is still
    // direction=outbound — SQL does not filter sentByUserId or status.
    const { sql } = findUnansweredConversationsQuery(new Date(NOW_MS), 10).toSQL()
    const lower = sql.toLowerCase()
    expect(lower).toContain(`o.direction = 'outbound'`)
    expect(lower).not.toContain('sentbyuserid')
    expect(lower).not.toContain(`status = 'failed'`)
  })

  it('14 — failed outbound follows existing outbound semantics (no status filter)', async () => {
    const { sql } = findUnansweredConversationsQuery(new Date(NOW_MS), 10).toSQL()
    expect(sql.toLowerCase()).not.toMatch(/o\.status/)
  })

  it('kill switch off → no finder / no emit', async () => {
    isNotificationsEnabled.mockReturnValue(false)
    await tickUnansweredNotifications({ nowMs: NOW_MS })
    expect(findUnansweredConversations).not.toHaveBeenCalled()
    expect(notifyEvent).not.toHaveBeenCalled()
  })
})

describe('recipients handler_or_admin', () => {
  const context = (handler: number | null): RecipientContext => ({
    handlerByLead: new Map([[leadKey(AGENCY, LEAD), handler]]),
    adminsByAgency: new Map([[AGENCY, [ADMIN]]]),
  })

  it('9 — assigned lead → handler recipient', () => {
    expect(
      resolveRecipients({
        rule: 'handler_or_admin',
        agencyId: AGENCY,
        leadId: LEAD,
        context: context(HANDLER),
      }),
    ).toEqual([HANDLER])
  })

  it('10 — unassigned → admin recipient', () => {
    expect(
      resolveRecipients({
        rule: 'handler_or_admin',
        agencyId: AGENCY,
        leadId: LEAD,
        context: context(null),
      }),
    ).toEqual([ADMIN])
  })

  it('plan uses leadId from payload for conversation entity', () => {
    const planned = planNotification({
      job: {
        agencyId: AGENCY,
        type: 'message.unanswered',
        actorUserId: null,
        entityType: 'conversation',
        entityId: CONV,
        payload: { leadId: LEAD, messageId: MSG, leadName: 'דנה' },
        createdAt: '2026-08-12T12:00:00.000Z',
      },
      context: context(HANDLER),
      presence: (): Presence => 'online',
      capabilities: IN_APP_ONLY_CAPABILITIES,
    } satisfies PlanInput)

    expect('plan' in planned).toBe(true)
    if (!('plan' in planned)) return
    expect(
      leadIdForJob({
        entityType: 'conversation',
        entityId: CONV,
        payload: { leadId: LEAD, messageId: MSG },
      }),
    ).toBe(LEAD)
    expect(planned.plan.recipients.map((r) => r.userId)).toEqual([HANDLER])
    expect(planned.plan.deepLink).toBe(`/inbox?conversation=${CONV}`)
    expect(planned.plan.recipients[0].channels).toEqual(['in_app'])
  })
})

describe('15 — no Awareness toast path', () => {
  it('messages category remains Awareness-owned; unanswered has no toastEligible channel', () => {
    expect([...AWARENESS_OWNED_CATEGORIES]).toEqual(['messages'])

    const item: NotificationFeedItem = {
      id: 1,
      type: 'message.unanswered',
      category: 'messages',
      priority: 'high',
      title: 'הודעה ממתינה למענה — דנה',
      body: null,
      entityType: 'conversation',
      entityId: CONV,
      deepLink: `/inbox?conversation=${CONV}`,
      groupCount: 1,
      createdAt: '2026-08-12T12:00:30.000Z',
      seenAt: null,
      readAt: null,
      toastEligible: true, // even if wrongly marked, category suppression blocks it
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

  it('ingest path is not the emit site — tick module only', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const ingest = fs.readFileSync(path.join(process.cwd(), 'lib/inbox/ingestWhatsappInbound.ts'), 'utf8')
    expect(ingest).not.toContain('message.unanswered')
    const tick = fs.readFileSync(path.join(process.cwd(), 'lib/notifications/unansweredTick.ts'), 'utf8')
    expect(tick).toContain("type: 'message.unanswered'")
  })
})
