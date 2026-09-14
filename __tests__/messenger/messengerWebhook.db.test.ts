/**
 * Messenger webhook → storage, against a real Postgres (baseline + migrations).
 *
 * Drives the REAL signed webhook route and the real ingest. Proves the
 * properties App Review and production both depend on: tenancy from the signed
 * entry id, dedup of redeliveries and of echoes of our own sends, Page-inbox
 * echoes kept, ordering by Meta's timestamp, and the rollout gate.
 *
 * Run: npm run test:db -- __tests__/messenger/messengerWebhook.db.test.ts
 */
import { createHmac } from 'crypto'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

vi.hoisted(() => {
  process.env.META_APP_SECRET = 'test-app-secret'
  process.env.META_APP_ID = 'APP123'
  process.env.FACEBOOK_MESSENGER_ENABLED = '1'
})
vi.mock('next/server', async (importActual) => {
  const actual = await importActual<typeof import('next/server')>()
  return { ...actual, after: () => {} }
})

import { db } from '@/config/db'
import { POST } from '@/app/api/webhooks/facebook/route'
import { insertMessengerMessage, recordSentMessengerMessage } from '@/db/messenger'
import { listMessengerConversations, listMessengerMessages } from '@/modules/messenger/queries'
import { runMessengerEventWorker } from '@/lib/facebook/messenger/eventWorker'

const PAGE_A = '__msgr_page_a__'
const PAGE_B = '__msgr_page_b__'
const PSID = '__psid_1__'
let agencyA = 0
let agencyB = 0
let userA = 0

function signedRequest(body: unknown) {
  const raw = JSON.stringify(body)
  const sig = 'sha256=' + createHmac('sha256', 'test-app-secret').update(raw).digest('hex')
  return new Request('https://getsocialcrm.com/api/webhooks/facebook', {
    method: 'POST',
    body: raw,
    headers: { 'x-hub-signature-256': sig, 'content-type': 'application/json' },
  }) as never
}

const inbound = (over: { page?: string; mid?: string; text?: string; ts?: number; recipient?: string; attachments?: unknown } = {}) => ({
  object: 'page',
  entry: [
    {
      id: over.page ?? PAGE_A,
      time: 1,
      messaging: [
        {
          sender: { id: PSID },
          recipient: { id: over.recipient ?? over.page ?? PAGE_A },
          timestamp: over.ts ?? Date.parse('2026-09-14T10:00:00Z'),
          message: { mid: over.mid ?? 'm_1', text: over.text ?? 'שלום, כמה עולה?', ...(over.attachments ? { attachments: over.attachments } : {}) },
        },
      ],
    },
  ],
})

const echo = (appId: string, mid: string, text = 'תשובה') => ({
  object: 'page',
  entry: [
    {
      id: PAGE_A,
      time: 1,
      messaging: [
        {
          sender: { id: PAGE_A },
          recipient: { id: PSID },
          timestamp: Date.parse('2026-09-14T10:05:00Z'),
          message: { is_echo: true, app_id: Number(appId) || appId, mid, text },
        },
      ],
    },
  ],
})

/** A signed delivery, then the durable receipts drained by the real worker (the route's after() kick is a no-op here). */
async function deliver(body: unknown) {
  const res = await POST(signedRequest(body))
  await runMessengerEventWorker({ workerId: 'test' })
  return res
}

async function conversationsFor(page: string) {
  return db('messenger_conversations').where({ pageId: page })
}
async function messagesFor(page: string) {
  return db('messenger_messages').where({ pageId: page }).orderBy('id')
}

beforeAll(async () => {
  const [a] = await db('agencies').insert({ name: '__test_msgr_a__' }).returning('id')
  const [b] = await db('agencies').insert({ name: '__test_msgr_b__' }).returning('id')
  agencyA = Number(a.id)
  agencyB = Number(b.id)
  const [u] = await db('users').insert({ firstName: 'M', role: 'ADMIN', agencyId: agencyA }).returning('id')
  const [u2] = await db('users').insert({ firstName: 'M2', role: 'ADMIN', agencyId: agencyB }).returning('id')
  userA = Number(u.id)
  const scopes = JSON.stringify(['pages_show_list', 'pages_manage_metadata', 'pages_messaging'])
  await db('facebook_pages').insert([
    { user_id: userA, agency_id: agencyA, page_id: PAGE_A, page_name: 'A', page_access_token: 'x', granted_scopes: scopes },
    { user_id: Number(u2.id), agency_id: agencyB, page_id: PAGE_B, page_name: 'B', page_access_token: 'x', granted_scopes: scopes },
  ])
})

beforeEach(async () => {
  process.env.FACEBOOK_MESSENGER_AGENCY_ALLOWLIST = `${agencyA},${agencyB}`
  await db('messenger_messages').whereIn('pageId', [PAGE_A, PAGE_B]).del()
  await db('messenger_conversation_reads').whereIn('agencyId', [agencyA, agencyB]).del()
  await db('messenger_conversations').whereIn('pageId', [PAGE_A, PAGE_B]).del()
  await db('messenger_webhook_events').whereIn('pageId', [PAGE_A, PAGE_B]).del()
})

afterAll(async () => {
  await db('messenger_webhook_events').whereIn('pageId', [PAGE_A, PAGE_B]).del()
  await db('messenger_messages').whereIn('pageId', [PAGE_A, PAGE_B]).del()
  await db('messenger_conversation_reads').whereIn('agencyId', [agencyA, agencyB]).del()
  await db('messenger_conversations').whereIn('pageId', [PAGE_A, PAGE_B]).del()
  await db('facebook_pages').whereIn('page_id', [PAGE_A, PAGE_B]).del()
  await db('users').whereIn('agencyId', [agencyA, agencyB]).del()
  await db('agencies').whereIn('id', [agencyA, agencyB]).del()
  await db.destroy()
})

describe('inbound messages', () => {
  it('M1: a signed inbound message is stored under the Page\'s agency, keyed by (Page, PSID)', async () => {
    const res = await deliver(inbound())
    expect(res.status).toBe(200)

    const [conv] = await conversationsFor(PAGE_A)
    expect(conv).toMatchObject({ agencyId: agencyA, psid: PSID, lastDirection: 'inbound', lastMessageText: 'שלום, כמה עולה?' })
    expect(new Date(conv.lastInboundAt).toISOString()).toBe('2026-09-14T10:00:00.000Z')

    const msgs = await messagesFor(PAGE_A)
    expect(msgs).toHaveLength(1)
    expect(msgs[0]).toMatchObject({ direction: 'inbound', source: 'customer', mid: 'm_1', agencyId: agencyA })
  })

  it('M2: Meta redelivering the same event stores nothing new', async () => {
    await deliver(inbound())
    await deliver(inbound())
    await deliver(inbound())
    expect(await messagesFor(PAGE_A)).toHaveLength(1)
    expect(await conversationsFor(PAGE_A)).toHaveLength(1)
  })

  it('M3: an older message arriving late never becomes the conversation\'s last message', async () => {
    await deliver(inbound({ mid: 'm_new', text: 'חדש', ts: Date.parse('2026-09-14T12:00:00Z') }))
    await deliver(inbound({ mid: 'm_old', text: 'ישן', ts: Date.parse('2026-09-14T09:00:00Z') }))
    const [conv] = await conversationsFor(PAGE_A)
    expect(conv.lastMessageText).toBe('חדש')
    expect(new Date(conv.lastInboundAt).toISOString()).toBe('2026-09-14T12:00:00.000Z')
    expect(await messagesFor(PAGE_A)).toHaveLength(2)
  })

  it('M4: an unsupported attachment is kept with a marker, never dropped', async () => {
    await deliver(inbound({ mid: 'm_tpl', text: '', attachments: [{ type: 'template', payload: {} }] }))
    const [msg] = await messagesFor(PAGE_A)
    const attachments = typeof msg.attachments === 'string' ? JSON.parse(msg.attachments) : msg.attachments
    expect(attachments).toEqual([{ type: 'unsupported', url: null }])
    const [conv] = await conversationsFor(PAGE_A)
    expect(conv.lastMessageText).toBe('[קובץ מצורף]')
  })
})

describe('echoes', () => {
  it('M5: the echo of a message SocialCRM already recorded from the Send API response is a no-op', async () => {
    await deliver(inbound())
    const [conv] = await conversationsFor(PAGE_A)
    await insertMessengerMessage(db, {
      conversationId: Number(conv.id),
      agencyId: agencyA,
      pageId: PAGE_A,
      mid: 'm_sent_by_app',
      direction: 'outbound',
      source: 'socialcrm',
      text: 'תשובה',
      attachments: [],
      sentByUserId: userA,
      channelTimestamp: new Date(),
    })
    await deliver(echo('APP123', 'm_sent_by_app'))
    const outbound = (await messagesFor(PAGE_A)).filter((m) => m.direction === 'outbound')
    expect(outbound).toHaveLength(1)
    expect(outbound[0]).toMatchObject({ source: 'socialcrm', sentByUserId: userA })
  })

  it('M5b: the echo arrives BEFORE the Send API response → still one row, and the sender is attributed', async () => {
    await deliver(inbound())
    await deliver(echo('APP123', 'm_raced', 'תשובה'))
    const [conv] = await conversationsFor(PAGE_A)
    const before = await conversationsFor(PAGE_A)

    const { created } = await db.transaction((trx) =>
      recordSentMessengerMessage(trx, {
        conversationId: Number(conv.id),
        agencyId: agencyA,
        pageId: PAGE_A,
        mid: 'm_raced',
        text: 'תשובה',
        sentByUserId: userA,
        at: new Date(),
      }),
    )
    expect(created).toBe(false) // the caller must not bump the conversation a second time
    const outbound = (await messagesFor(PAGE_A)).filter((m) => m.direction === 'outbound')
    expect(outbound).toHaveLength(1)
    expect(outbound[0]).toMatchObject({ source: 'socialcrm', sentByUserId: userA })
    expect((await conversationsFor(PAGE_A))[0].lastMessageAt).toEqual(before[0].lastMessageAt)
  })

  it('M6: a reply a person sent from the Page inbox is kept as an outbound Page message', async () => {
    await deliver(inbound())
    await deliver(echo('263902037430900', 'm_from_inbox', 'ענינו מהתיבה'))
    const outbound = (await messagesFor(PAGE_A)).filter((m) => m.direction === 'outbound')
    expect(outbound).toHaveLength(1)
    expect(outbound[0]).toMatchObject({ source: 'page_inbox', text: 'ענינו מהתיבה' })
    const [conv] = await conversationsFor(PAGE_A)
    expect(conv.lastDirection).toBe('outbound')
    // An echo is not the customer writing: it must not reopen the reply window.
    expect(new Date(conv.lastInboundAt).toISOString()).toBe('2026-09-14T10:00:00.000Z')
  })
})

describe('tenancy and gating', () => {
  it('M7: the same PSID on another agency\'s Page is a different conversation, invisible to agency A', async () => {
    await deliver(inbound())
    await deliver(inbound({ page: PAGE_B, mid: 'm_b' }))
    const listA = await listMessengerConversations(agencyA, userA)
    expect(listA.map((c) => c.pageId)).toEqual([PAGE_A])
    const [convB] = await conversationsFor(PAGE_B)
    expect(convB.agencyId).toBe(agencyB)
    expect(await listMessengerMessages(agencyA, Number(convB.id))).toEqual([])
  })

  it('M8: an event whose recipient is not the signed entry Page is ignored', async () => {
    await deliver(inbound({ recipient: PAGE_B }))
    expect(await conversationsFor(PAGE_A)).toHaveLength(0)
    expect(await conversationsFor(PAGE_B)).toHaveLength(0)
  })

  it('M9: an agency outside the Messenger rollout stores nothing', async () => {
    process.env.FACEBOOK_MESSENGER_AGENCY_ALLOWLIST = String(agencyB)
    const res = await deliver(inbound())
    expect(res.status).toBe(200)
    expect(await conversationsFor(PAGE_A)).toHaveLength(0)
  })

  it('M10: a bad signature is rejected before anything is stored', async () => {
    const raw = JSON.stringify(inbound())
    const res = await POST(
      new Request('https://getsocialcrm.com/api/webhooks/facebook', {
        method: 'POST',
        body: raw,
        headers: { 'x-hub-signature-256': 'sha256=' + '0'.repeat(64) },
      }) as never,
    )
    expect(res.status).toBe(403)
    expect(await conversationsFor(PAGE_A)).toHaveLength(0)
  })

  it('M12: a Page reconnected by another agency starts that agency\'s own conversation — messages are never refused', async () => {
    await deliver(inbound({ mid: 'm_before_move' }))
    // The Page moves: agency A disconnects, agency B connects the same Page.
    await db('facebook_pages').where({ page_id: PAGE_A }).update({ agency_id: agencyB })
    try {
      await deliver(inbound({ mid: 'm_after_move', text: 'אחרי המעבר' }))
      const convs = await conversationsFor(PAGE_A)
      expect(convs.map((c) => c.agencyId).sort()).toEqual([agencyA, agencyB].sort())
      expect((await listMessengerConversations(agencyB, userA)).map((c) => c.lastMessageText)).toEqual(['אחרי המעבר'])
      // Agency A keeps its history and never sees B's new message.
      expect((await listMessengerConversations(agencyA, userA)).map((c) => c.lastMessageText)).toEqual(['שלום, כמה עולה?'])
    } finally {
      await db('facebook_pages').where({ page_id: PAGE_A }).update({ agency_id: agencyA })
    }
  })

  it('M11: unread is per user and clears when that user reads', async () => {
    await deliver(inbound())
    let [item] = await listMessengerConversations(agencyA, userA)
    expect(item.unread).toBe(true)
    await db('messenger_conversation_reads').insert({ conversationId: item.id, userId: userA, agencyId: agencyA, lastReadAt: new Date('2026-09-14T11:00:00Z') })
    ;[item] = await listMessengerConversations(agencyA, userA)
    expect(item.unread).toBe(false)
  })
})
