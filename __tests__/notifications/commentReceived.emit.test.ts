/**
 * Task 6 — comment.received emitter boundary.
 *
 * Drives the REAL `ingestFacebookComment` with DB + `notifyEvent` mocked.
 * Proves insert-only emit, verb silence, keys, registry contract, and that
 * conversion / message.inbound / conversation are never used.
 *
 * Runs without a database: `npm run test:notifications`.
 */

import fs from 'fs'
import path from 'path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { eventKeyForEvent } from '@/lib/notifications/eventKey'
import { commentPostKey } from '@/lib/notifications/collapseKeys'
import { leadIdForJob, planNotification, type PlanInput } from '@/lib/notifications/plan'
import { IN_APP_ONLY_CAPABILITIES } from '@/lib/notifications/policy'
import { NOTIFICATION_REGISTRY } from '@/lib/notifications/registry'
import type { EventContext, NotificationEvent, Presence } from '@/lib/notifications/types'
import { resolveRecipients, type RecipientContext } from '@/db/notifications/recipients'

const notifyEvent = vi.fn()

const h = vi.hoisted(() => {
  const state = {
    connection: null as Record<string, unknown> | null,
    insertSignals: [] as boolean[],
    nextCommentId: 42,
    inserts: [] as Record<string, unknown>[],
    merges: [] as Record<string, unknown>[],
    conflictTargets: [] as unknown[],
    updates: [] as unknown[],
  }

  function qb(table: string) {
    let lastWhere: unknown = null
    const b: Record<string, unknown> = {}
    b.where = (w: unknown) => {
      lastWhere = w
      return b
    }
    b.first = async () => (table === 'facebook_pages' ? state.connection : undefined)
    b.insert = (row: Record<string, unknown>) => {
      state.inserts.push(row)
      return b
    }
    b.onConflict = (target: unknown) => {
      state.conflictTargets.push(target)
      return b
    }
    b.merge = (row: Record<string, unknown>) => {
      state.merges.push(row)
      return b
    }
    b.returning = async () => {
      const inserted = state.insertSignals.length > 0 ? state.insertSignals.shift()! : true
      const id = state.nextCommentId++
      return [{ id, inserted }]
    }
    b.update = async () => {
      state.updates.push({ where: lastWhere })
      return 1
    }
    return b
  }

  const db = Object.assign((t: string) => qb(t), { raw: (sql: string) => sql })
  return { state, db }
})

vi.mock('@/config/db', () => ({ db: h.db }))
vi.mock('@/lib/notifications/emit', () => ({
  notifyEvent: (...args: unknown[]) => notifyEvent(...args),
}))

const { ingestFacebookComment } = await import('@/lib/system/ingestFacebookComment')

const PAGE = '1175908668934802'
const POST = `${PAGE}_122113311069337165`
const COMMENT = '122113311069337165_987654321'
const AGENCY = 103
const ADMIN = 1
const HANDLER = 55

const comment = (over: Record<string, unknown> = {}) => ({
  item: 'comment',
  verb: 'add',
  comment_id: COMMENT,
  post_id: POST,
  parent_id: POST,
  from: { id: 'U1', name: 'דוד כהן' },
  created_time: 1786364410,
  ...over,
})

beforeEach(() => {
  process.env.FACEBOOK_COMMENTS_ENABLED = '1'
  process.env.FACEBOOK_COMMENTS_AGENCY_ALLOWLIST = String(AGENCY)
  h.state.connection = { page_id: PAGE, agency_id: AGENCY, user_id: 332 }
  h.state.insertSignals = []
  h.state.nextCommentId = 42
  h.state.inserts = []
  h.state.merges = []
  h.state.conflictTargets = []
  h.state.updates = []
  notifyEvent.mockReset()
  notifyEvent.mockResolvedValue({ enqueued: true, jobId: 1 })
})

describe('ingestFacebookComment → notifyEvent(comment.received)', () => {
  it('first add → one notification', async () => {
    h.state.insertSignals = [true]

    await ingestFacebookComment(PAGE, comment())

    expect(notifyEvent).toHaveBeenCalledTimes(1)
    expect(notifyEvent.mock.calls[0][0]).toMatchObject({
      type: 'comment.received',
      agencyId: AGENCY,
      entityType: 'comment',
      entityId: 42,
      actorUserId: null,
      payload: {
        leadName: 'דוד כהן',
        pageId: PAGE,
        postId: POST,
        provider: 'facebook',
      },
    })
  })

  it('duplicate webhook/upsert → no second notification', async () => {
    h.state.insertSignals = [true, false]

    await ingestFacebookComment(PAGE, comment())
    await ingestFacebookComment(PAGE, comment())

    expect(notifyEvent).toHaveBeenCalledTimes(1)
    expect(h.state.conflictTargets).toEqual([
      ['pageId', 'commentId'],
      ['pageId', 'commentId'],
    ])
  })

  it('existing edited → silent', async () => {
    h.state.insertSignals = [false]

    await ingestFacebookComment(PAGE, comment({ verb: 'edited', message: 'עודכן' }))

    expect(notifyEvent).not.toHaveBeenCalled()
    expect(h.state.merges[0]).toMatchObject({ message: 'עודכן', verb: 'edited' })
  })

  it('first-seen edited → one notification', async () => {
    h.state.insertSignals = [true]

    await ingestFacebookComment(PAGE, comment({ verb: 'edited', message: 'ראשון' }))

    expect(notifyEvent).toHaveBeenCalledTimes(1)
    expect(notifyEvent.mock.calls[0][0]).toMatchObject({
      type: 'comment.received',
      entityType: 'comment',
      entityId: 42,
    })
  })

  it('remove → silent', async () => {
    await ingestFacebookComment(PAGE, comment({ verb: 'remove' }))

    expect(notifyEvent).not.toHaveBeenCalled()
    expect(h.state.updates).toHaveLength(1)
  })

  it('disabled agency → silent', async () => {
    h.state.connection = { page_id: PAGE, agency_id: 999, user_id: 1 }

    await ingestFacebookComment(PAGE, comment())

    expect(notifyEvent).not.toHaveBeenCalled()
    expect(h.state.inserts).toHaveLength(0)
  })

  it('hide/unhide → silent', async () => {
    await ingestFacebookComment(PAGE, comment({ verb: 'hide' }))
    await ingestFacebookComment(PAGE, comment({ verb: 'unhide' }))

    expect(notifyEvent).not.toHaveBeenCalled()
  })
})

describe('comment.received identity + registry', () => {
  const event = (over: Partial<NotificationEvent> = {}): NotificationEvent => ({
    type: 'comment.received',
    agencyId: AGENCY,
    entityType: 'comment',
    entityId: 42,
    actorUserId: null,
    occurredAt: new Date('2026-08-12T10:00:00Z'),
    payload: { pageId: PAGE, postId: POST, leadName: 'דוד כהן', provider: 'facebook' },
    ...over,
  })

  const ctx = (over: Partial<EventContext> = {}): EventContext => ({
    type: 'comment.received',
    agencyId: AGENCY,
    entityType: 'comment',
    entityId: 42,
    actorUserId: null,
    occurredAt: new Date('2026-08-12T10:00:00Z'),
    payload: { pageId: PAGE, postId: POST, leadName: 'דוד כהן', provider: 'facebook' },
    groupCount: 1,
    ...over,
  })

  it('stable eventKey from durable PK', () => {
    const a = eventKeyForEvent(event())
    const b = eventKeyForEvent(event())
    expect(a).toBe(`comment.received:${AGENCY}:comment:42`)
    expect(a).toBe(b)
  })

  it('post-level collapseKey', () => {
    expect(commentPostKey(ctx())).toBe(`comment:${PAGE}:post:${POST}`)
    expect(NOTIFICATION_REGISTRY['comment.received'].collapseKey(ctx())).toBe(
      `comment:${PAGE}:post:${POST}`,
    )
  })

  it('missing postId falls back per comment — does not invent a shared post', () => {
    expect(commentPostKey(ctx({ payload: { pageId: PAGE, postId: null } }))).toBe(
      `comment:${PAGE}:id:42`,
    )
  })

  it('entityType comment + deepLink /inbox/comments', () => {
    const def = NOTIFICATION_REGISTRY['comment.received']
    expect(def.entity(ctx())).toEqual({ type: 'comment', id: 42 })
    expect(def.deepLink(ctx())).toBe('/inbox/comments')
    expect(def.recipients).toBe('admin_only')
    expect(def.category).toBe('messages')
  })

  it('admin_only recipients — handler ignored, admins only', () => {
    const recipientCtx: RecipientContext = {
      handlerByLead: new Map([[`${AGENCY}:999`, HANDLER]]),
      adminsByAgency: new Map([[AGENCY, [ADMIN]]]),
    }

    expect(
      resolveRecipients({
        rule: 'admin_only',
        agencyId: AGENCY,
        leadId: 999,
        context: recipientCtx,
      }),
    ).toEqual([ADMIN])

    const planned = planNotification({
      job: {
        agencyId: AGENCY,
        type: 'comment.received',
        actorUserId: null,
        entityType: 'comment',
        entityId: 42,
        payload: { pageId: PAGE, postId: POST },
        createdAt: '2026-08-12T10:00:00Z',
      },
      context: recipientCtx,
      presence: (): Presence => 'online',
      capabilities: IN_APP_ONLY_CAPABILITIES,
    } satisfies PlanInput)

    expect('plan' in planned).toBe(true)
    if (!('plan' in planned)) return
    expect(planned.plan.recipients.map((r) => r.userId)).toEqual([ADMIN])
    expect(planned.plan.deepLink).toBe('/inbox/comments')
    expect(planned.plan.entityType).toBe('comment')
    expect(leadIdForJob({ entityType: 'comment', entityId: 42, payload: {} })).toBeNull()
  })

  it('never uses message.inbound or conversation entity', async () => {
    h.state.insertSignals = [true]
    await ingestFacebookComment(PAGE, comment())
    const call = notifyEvent.mock.calls[0]?.[0] as NotificationEvent | undefined
    expect(call?.type).toBe('comment.received')
    expect(call?.entityType).toBe('comment')
    expect(call?.type).not.toBe('message.inbound')
    expect(call?.entityType).not.toBe('conversation')

    const ingestSrc = fs.readFileSync(
      path.join(process.cwd(), 'lib/system/ingestFacebookComment.ts'),
      'utf8',
    )
    expect(ingestSrc).toContain("type: 'comment.received'")
    expect(ingestSrc).not.toContain('message.inbound')
    expect(ingestSrc).not.toMatch(/entityType:\s*'conversation'/)
  })

  it('conversion does not emit comment.received', () => {
    const convertSrc = fs.readFileSync(
      path.join(process.cwd(), 'modules/facebookComments/actions.ts'),
      'utf8',
    )
    expect(convertSrc).not.toContain('comment.received')
    expect(convertSrc).not.toContain('notifyEvent')
  })
})
