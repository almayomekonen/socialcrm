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
const findPendingHandoffs = vi.fn()
const quietHoursByAgency = vi.fn()

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
    findPendingHandoffs: (...args: unknown[]) => findPendingHandoffs(...args),
    quietHoursByAgency: (...args: unknown[]) => quietHoursByAgency(...args),
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
  findPendingHandoffs.mockReset()
  findPendingHandoffs.mockResolvedValue([])
  quietHoursByAgency.mockReset()
  quietHoursByAgency.mockResolvedValue(new Map())
})

describe('threshold constant', () => {
  it('is locked at 30 minutes', () => {
    expect(UNANSWERED_THRESHOLD_MS).toBe(30 * 60 * 1000)
  })
})

describe('candidate SQL shape', () => {
  it('requires open + aged lastInboundAt within a day + non-terminal lead + no later HUMAN reply', () => {
    const cutoff = new Date(NOW_MS - UNANSWERED_THRESHOLD_MS)
    const { sql, bindings } = findUnansweredConversationsQuery(cutoff, 200).toSQL()
    const lower = sql.toLowerCase()
    expect(lower).toContain('inbox_conversations')
    expect(lower).toContain(`cv.state = 'open'`)
    // No `lastDirection = 'inbound'` filter any more: after an AI handoff the
    // last message is the AI's, and that conversation is exactly the one to remind.
    expect(lower).not.toContain(`cv."lastdirection" = 'inbound'`)
    expect(lower).toContain('cv."lastinboundat" <=')
    expect(lower).toContain('cv."lastinboundat" >=')
    expect(lower).toContain(`status is distinct from 'closed'`)
    expect(lower).toContain(`status is distinct from 'lost'`)
    expect(lower).toContain(`direction = 'inbound'`)
    expect(lower).toContain(`direction = 'outbound'`)
    expect(lower).toContain('not exists')
    expect(lower).toContain('limit')
    expect(lower).not.toContain('lastreadat')
    expect(lower).not.toContain('quiet')
    expect(bindings).toEqual([cutoff, new Date(NOW_MS - 24 * 60 * 60 * 1000), 200])
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

  // 13/14 CHANGED 2026-09-28 (deliberately). They pinned "any outbound — bot,
  // automation or failed — is an answer". That rule silenced the reminder for
  // every conversation the AI handed to a person. Only a human reply counts
  // now; behaviour is proven against Postgres in unanswered.db.test.ts.
  it('13 — only a HUMAN reply (SocialCRM or the WhatsApp Business app) clears a handed-off chat', async () => {
    const { sql } = findUnansweredConversationsQuery(new Date(NOW_MS), 10).toSQL()
    const lower = sql.toLowerCase()
    expect(lower).toContain(`'smb_message_echo'`)
    expect(lower).toContain('"sentbyuserid" is not null')
    expect(lower).toContain(`'escalated', 'human_active'`)
  })

  it('14 — a failed reply is not an answer', async () => {
    const { sql } = findUnansweredConversationsQuery(new Date(NOW_MS), 10).toSQL()
    expect(sql.toLowerCase()).toContain(`h.status is distinct from 'failed'`)
  })

  it('15 — a pending handoff emits lead.handoff, keyed by when it happened', async () => {
    const escalatedAt = new Date(NOW_MS - 60_000)
    findPendingHandoffs.mockResolvedValue([
      { conversationId: CONV, agencyId: AGENCY, leadId: LEAD, escalatedAt, firstName: 'דנה', lastName: 'לוי' },
    ])
    await tickUnansweredNotifications({ nowMs: NOW_MS })
    const event = notifyEvent.mock.calls[0][0] as NotificationEvent
    expect(event).toMatchObject({
      type: 'lead.handoff',
      entityType: 'conversation',
      entityId: CONV,
      payload: { leadId: LEAD, leadName: 'דנה לוי', escalatedAt: escalatedAt.toISOString() },
    })
    expect(eventKeyForEvent(event)).toBe(
      `lead.handoff:${AGENCY}:conversation:${CONV}:at:${escalatedAt.toISOString()}`,
    )
  })

  it('16 — a handoff with no ליד is still emitted, with no name', async () => {
    findPendingHandoffs.mockResolvedValue([
      { conversationId: CONV, agencyId: AGENCY, leadId: null, escalatedAt: new Date(NOW_MS), firstName: null, lastName: null },
    ])
    await tickUnansweredNotifications({ nowMs: NOW_MS })
    expect(notifyEvent.mock.calls[0][0].payload).toMatchObject({ leadId: null, leadName: null })
  })

  it('17 — inside the agency’s quiet hours nothing is sent; it is sent once they end', async () => {
    // NOW_MS is 12:00 UTC = 15:00 Asia/Jerusalem.
    findUnansweredConversations.mockResolvedValue([candidate()])
    quietHoursByAgency.mockResolvedValue(new Map([[AGENCY, { tz: 'Asia/Jerusalem', startHour: 14, endHour: 16 }]]))
    const quiet = await tickUnansweredNotifications({ nowMs: NOW_MS })
    expect(quiet.deferred).toBe(1)
    expect(notifyEvent).not.toHaveBeenCalled()

    const later = await tickUnansweredNotifications({ nowMs: NOW_MS + 60 * 60 * 1000 })
    expect(later.enqueued).toBe(1)
  })

  it('19 — a failing handoff finder does not cost the reminders', async () => {
    findPendingHandoffs.mockRejectedValue(new Error('relation does not exist'))
    findUnansweredConversations.mockResolvedValue([candidate()])
    expect((await tickUnansweredNotifications({ nowMs: NOW_MS })).enqueued).toBe(1)
  })

  it('18 — another agency’s quiet hours do not hold this one back', async () => {
    findUnansweredConversations.mockResolvedValue([candidate()])
    quietHoursByAgency.mockResolvedValue(new Map([[AGENCY + 1, { tz: 'Asia/Jerusalem', startHour: 0, endHour: 23 }]]))
    expect((await tickUnansweredNotifications({ nowMs: NOW_MS })).enqueued).toBe(1)
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
