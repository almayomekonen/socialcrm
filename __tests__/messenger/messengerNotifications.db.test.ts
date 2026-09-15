/**
 * Messenger message → notification, end to end against a real Postgres.
 *
 * The REAL signed webhook route, the REAL Messenger worker, the REAL
 * notifyEvent → notification_jobs, and the REAL notification worker → the
 * `notifications` rows the bell, toast and push read. Only the Graph name lookup
 * and the plan-entitlement read are stubbed.
 *
 * Run: npm run test:db -- __tests__/messenger/messengerNotifications.db.test.ts
 */
import { createHmac } from 'crypto'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

vi.hoisted(() => {
  process.env.META_APP_SECRET = 'test-app-secret'
  process.env.META_APP_ID = 'APP123'
  process.env.FACEBOOK_MESSENGER_ENABLED = '1'
  process.env.NOTIFICATIONS_ENABLED = '1'
  process.env.NOTIFICATIONS_AGENCY_ALLOWLIST = 'all'
})
vi.mock('next/server', async (importActual) => {
  const actual = await importActual<typeof import('next/server')>()
  return { ...actual, after: () => {} }
})
vi.mock('@/lib/access/productAccess', async (importActual) => {
  const actual = await importActual<typeof import('@/lib/access/productAccess')>()
  return { ...actual, getAgencyProductAccess: async () => ({ hasAccess: true }) }
})
const session = vi.hoisted(() => ({ user: null as { id: number; agencyId: number } | null }))
vi.mock('next/cache', () => ({ revalidatePath: () => {} }))
vi.mock('@/lib/requireUser', async (importActual) => {
  const actual = await importActual<typeof import('@/lib/requireUser')>()
  return { ...actual, requireAgencyUser: async () => session.user }
})
// The Graph profile lookup, simulated: it names the contact the way a successful lookup would.
vi.mock('@/lib/facebook/messenger/profile', async () => {
  const { db } = await import('@/config/db')
  return {
    fillMessengerCustomerName: async (input: { conversationId: number; agencyId: number }) => {
      await db('messenger_conversations')
        .where({ id: input.conversationId, agencyId: input.agencyId })
        .whereNull('customerName')
        .update({ customerName: 'Dana Tester' })
    },
  }
})

import { db } from '@/config/db'
import { POST } from '@/app/api/webhooks/facebook/route'
import { runMessengerEventWorker } from '@/lib/facebook/messenger/eventWorker'
import { runNotificationWorker } from '@/lib/notifications/worker'
import { ingestMessengerEvent } from '@/lib/facebook/messenger/ingestMessengerEvent'
import { markMessengerConversationRead } from '@/modules/messenger/actions'

const PAGE_A = '__msgr_notif_page_a__'
const PAGE_B = '__msgr_notif_page_b__'
const PSID = '__notif_psid__'
let agencyA = 0
let agencyB = 0
let adminA = 0
let agentA = 0
let adminB = 0

function signedRequest(body: unknown) {
  const raw = JSON.stringify(body)
  const sig = 'sha256=' + createHmac('sha256', 'test-app-secret').update(raw).digest('hex')
  return new Request('https://getsocialcrm.com/api/webhooks/facebook', {
    method: 'POST',
    body: raw,
    headers: { 'x-hub-signature-256': sig, 'content-type': 'application/json' },
  }) as never
}

const event = (page: string, message: Record<string, unknown>, fromPage = false) => ({
  object: 'page',
  entry: [
    {
      id: page,
      time: 1,
      messaging: [
        {
          sender: { id: fromPage ? page : PSID },
          recipient: { id: fromPage ? PSID : page },
          timestamp: Date.parse('2026-09-15T08:59:32Z'),
          message,
        },
      ],
    },
  ],
})
const inbound = (mid: string, page = PAGE_A) => event(page, { mid, text: 'היי, אפשר פרטים?' })

async function deliver(body: unknown) {
  const res = await POST(signedRequest(body))
  await runMessengerEventWorker({ workerId: 'test' })
  await runNotificationWorker({ limit: 20, workerId: 'test' })
  return res
}

const jobsFor = (agencyId: number) =>
  db('notification_jobs').where({ agencyId, type: 'message.messenger_inbound' }).orderBy('id')
const notificationsFor = (agencyId: number) =>
  db('notifications').where({ agencyId, type: 'message.messenger_inbound' }).orderBy('id')

beforeAll(async () => {
  const [a] = await db('agencies').insert({ name: '__test_msgr_notif_a__' }).returning('id')
  const [b] = await db('agencies').insert({ name: '__test_msgr_notif_b__' }).returning('id')
  agencyA = Number(a.id)
  agencyB = Number(b.id)
  const [ua] = await db('users').insert({ firstName: 'Admin', role: 'ADMIN', agencyId: agencyA }).returning('id')
  const [ug] = await db('users').insert({ firstName: 'Rep', role: 'AGNT', agencyId: agencyA }).returning('id')
  const [ub] = await db('users').insert({ firstName: 'Other', role: 'ADMIN', agencyId: agencyB }).returning('id')
  adminA = Number(ua.id)
  agentA = Number(ug.id)
  adminB = Number(ub.id)
  const scopes = JSON.stringify(['pages_show_list', 'pages_manage_metadata', 'pages_messaging'])
  await db('facebook_pages').insert([
    { user_id: adminA, agency_id: agencyA, page_id: PAGE_A, page_name: 'A', page_access_token: 'x', granted_scopes: scopes },
    { user_id: adminB, agency_id: agencyB, page_id: PAGE_B, page_name: 'B', page_access_token: 'x', granted_scopes: scopes },
  ])
})

async function cleanup() {
  await db('notifications').whereIn('agencyId', [agencyA, agencyB]).del()
  await db('notification_jobs').whereIn('agencyId', [agencyA, agencyB]).del()
  await db('messenger_webhook_events').whereIn('pageId', [PAGE_A, PAGE_B]).del()
  await db('messenger_messages').whereIn('pageId', [PAGE_A, PAGE_B]).del()
  await db('messenger_conversations').whereIn('pageId', [PAGE_A, PAGE_B]).del()
  await db('clients').whereIn('agencyId', [agencyA, agencyB]).del()
}

beforeEach(async () => {
  process.env.FACEBOOK_MESSENGER_AGENCY_ALLOWLIST = `${agencyA},${agencyB}`
  await cleanup()
})

afterAll(async () => {
  await cleanup()
  await db('facebook_pages').whereIn('page_id', [PAGE_A, PAGE_B]).del()
  await db('users').whereIn('agencyId', [agencyA, agencyB]).del()
  await db('agencies').whereIn('id', [agencyA, agencyB]).del()
  await db.destroy()
})

describe('a customer writes on Messenger', () => {
  it("N1: the agency admin gets one notification naming the sender and opening that conversation — another agency's admin gets nothing", async () => {
    await deliver(inbound('m_n1'))

    const [conversation] = await db('messenger_conversations').where({ pageId: PAGE_A })
    const [message] = await db('messenger_messages').where({ pageId: PAGE_A })
    const jobs = await jobsFor(agencyA)
    expect(jobs).toHaveLength(1)
    expect(jobs[0].eventKey).toBe(
      `message.messenger_inbound:${agencyA}:messenger_conversation:${conversation.id}:msg:${message.id}`,
    )

    const rows = await notificationsFor(agencyA)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      userId: adminA,
      category: 'messages',
      priority: 'high',
      title: 'הודעה חדשה ב-Messenger — Dana Tester',
      entityType: 'messenger_conversation',
      deepLink: `/inbox/messenger?c=${conversation.id}`,
      collapseKey: `messenger:${conversation.id}:inbound`,
    })
    expect(rows.map((r) => r.userId)).not.toContain(agentA)
    expect(await db('notifications').where({ userId: adminB })).toHaveLength(0)
  })

  it('N2: Meta redelivering the same message notifies once; a second message updates the same open row', async () => {
    await deliver(inbound('m_n2'))
    await deliver(inbound('m_n2'))
    expect(await jobsFor(agencyA)).toHaveLength(1)

    await deliver(inbound('m_n2b'))
    expect(await jobsFor(agencyA)).toHaveLength(2)
    const rows = await notificationsFor(agencyA)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ groupCount: 2, title: '2 הודעות חדשות ב-Messenger — Dana Tester' })
  })

  it("N3: a conversation linked to a ליד notifies that ליד's נציג, by the ליד's name", async () => {
    await deliver(inbound('m_n3a'))
    const [lead] = await db('clients')
      .insert({
        firstName: 'דנה',
        lastName: 'לוי',
        agencyId: agencyA,
        userId: agentA,
        handlerId: agentA,
        createdById: agentA,
        lead: true,
        status: 'new',
        createOrigin: 'manual',
      })
      .returning('id')
    await db('messenger_conversations').where({ pageId: PAGE_A }).update({ leadId: Number(lead.id) })
    await db('notifications').where({ agencyId: agencyA }).del()

    await deliver(inbound('m_n3b'))
    const rows = await notificationsFor(agencyA)
    expect(rows.map((r) => r.userId)).toEqual([agentA])
    expect(rows[0].title).toBe('הודעה חדשה ב-Messenger — דנה לוי')
  })

  it('N4: messages the Page sends (from SocialCRM or the Page inbox) never notify', async () => {
    await deliver(event(PAGE_A, { is_echo: true, app_id: 'APP123', mid: 'm_n4a', text: 'ours' }, true))
    await deliver(event(PAGE_A, { is_echo: true, app_id: 263902037430900, mid: 'm_n4b', text: 'inbox' }, true))
    expect(await db('messenger_messages').where({ pageId: PAGE_A })).toHaveLength(2)
    expect(await jobsFor(agencyA)).toHaveLength(0)
  })

  it('N3b: a ליד id that belongs to another agency never lends its name, and the admins are told', async () => {
    const [foreign] = await db('clients')
      .insert({ firstName: 'זר', lastName: 'אחר', agencyId: agencyB, userId: adminB, handlerId: adminB, createdById: adminB, lead: true, status: 'new', createOrigin: 'manual' })
      .returning('id')
    await deliver(inbound('m_n3c'))
    await db('messenger_conversations').where({ pageId: PAGE_A }).update({ leadId: Number(foreign.id) })
    await db('notifications').where({ agencyId: agencyA }).del()

    await deliver(inbound('m_n3d'))
    const rows = await notificationsFor(agencyA)
    expect(rows.map((r) => r.userId)).toEqual([adminA])
    expect(rows[0].title).toBe('הודעה חדשה ב-Messenger — Dana Tester')
    expect(await db('notifications').where({ userId: adminB })).toHaveLength(0)
  })

  it('N6: a message stored but never announced (worker died in between) is announced on the retry — once', async () => {
    const stored = await ingestMessengerEvent(PAGE_A, inbound('m_n6').entry[0].messaging[0])
    expect(stored.status).toBe('stored')
    expect(await jobsFor(agencyA)).toHaveLength(0)

    await deliver(inbound('m_n6'))
    await deliver(inbound('m_n6'))
    expect(await jobsFor(agencyA)).toHaveLength(1)
    expect(await notificationsFor(agencyA)).toHaveLength(1)
  })

  it('N7: reading the conversation closes its notification, so the next message alerts again instead of collapsing silently', async () => {
    await deliver(inbound('m_n7a'))
    const [conversation] = await db('messenger_conversations').where({ pageId: PAGE_A })
    session.user = { id: adminA, agencyId: agencyA }
    expect(await markMessengerConversationRead(Number(conversation.id))).toEqual({ ok: true })
    const [closed] = await notificationsFor(agencyA)
    expect(closed.readAt).not.toBeNull()

    await deliver(inbound('m_n7b'))
    const rows = await notificationsFor(agencyA)
    expect(rows).toHaveLength(2)
    expect(rows[1]).toMatchObject({ readAt: null, seenAt: null, groupCount: 1, title: 'הודעה חדשה ב-Messenger — Dana Tester' })
  })

  it('N5: an agency outside the Messenger rollout stores nothing and is told nothing', async () => {
    process.env.FACEBOOK_MESSENGER_AGENCY_ALLOWLIST = String(agencyA)
    await deliver(inbound('m_n5', PAGE_B))
    expect(await jobsFor(agencyB)).toHaveLength(0)
  })
})
