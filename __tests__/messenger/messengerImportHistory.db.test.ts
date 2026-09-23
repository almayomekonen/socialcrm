/**
 * Importing a Page's existing Messenger conversations, against a real Postgres.
 *
 * The properties that matter: it is idempotent against the webhook, it never
 * stores a thread under a PSID it had to guess, it does not announce old
 * messages as news, and it is honest that Meta caps what it returns.
 *
 * Run: npm run test:db -- __tests__/messenger/messengerImportHistory.db.test.ts
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

vi.hoisted(() => {
  process.env.FACEBOOK_MESSENGER_ENABLED = '1'
})

import { db } from '@/config/db'
import { importMessengerHistory } from '@/lib/facebook/messenger/importHistory'
import { insertMessengerMessage, findOrCreateMessengerConversation } from '@/db/messenger'

const PAGE = '__import_page__'
const PSID = '__import_psid__'
let agencyId = 0

/** One Graph response, served to every request the importer makes. */
function graph(body: unknown, status = 200) {
  return vi.fn(async () => ({
    ok: status < 400,
    status,
    json: async () => body,
  })) as unknown as typeof fetch
}

const conversationsPayload = (over: Record<string, unknown> = {}) => ({
  data: [
    {
      id: 't_1',
      updated_time: '2026-09-20T10:00:00+0000',
      participants: { data: [{ id: PAGE, name: 'העסק שלי' }, { id: PSID, name: 'דנה לוי' }] },
      messages: {
        data: [
          {
            id: 'm_new',
            message: 'עדיין רלוונטי?',
            created_time: '2026-09-20T10:00:00+0000',
            from: { id: PSID, name: 'דנה לוי' },
          },
          {
            id: 'm_old',
            message: 'שלום, מעוניינת',
            created_time: '2026-09-20T09:00:00+0000',
            from: { id: PSID, name: 'דנה לוי' },
          },
        ],
      },
      ...over,
    },
  ],
})

beforeAll(async () => {
  const [a] = await db('agencies').insert({ name: '__test_import__' }).returning('id')
  agencyId = Number(a.id)
  const [u] = await db('users').insert({ firstName: 'I', role: 'ADMIN', agencyId }).returning('id')
  await db('facebook_pages').insert({
    user_id: Number(u.id),
    agency_id: agencyId,
    page_id: PAGE,
    page_name: 'P',
    page_access_token: 'x',
    granted_scopes: JSON.stringify(['pages_messaging']),
  })
})

beforeEach(async () => {
  await db('messenger_messages').where({ agencyId }).delete()
  await db('messenger_conversations').where({ agencyId }).delete()
})

afterAll(async () => {
  await db('messenger_messages').where({ agencyId }).delete()
  await db('messenger_conversations').where({ agencyId }).delete()
  await db('facebook_pages').where({ agency_id: agencyId }).delete()
  await db('users').where({ agencyId }).delete()
  await db('agencies').where({ id: agencyId }).delete()
})

const run = (fetchImpl: typeof fetch) =>
  importMessengerHistory({ agencyId, pageId: PAGE, pageAccessToken: 'tok', fetchImpl })

describe('importing history', () => {
  it('creates the conversation under the right agency, keyed by the CUSTOMER psid', async () => {
    const result = await run(graph(conversationsPayload()))
    expect(result).toMatchObject({ conversations: 1, messages: 2, failure: null })

    const [conv] = await db('messenger_conversations').where({ agencyId })
    // The Page is a participant too; it must never be mistaken for the contact.
    expect(conv.psid).toBe(PSID)
    expect(conv.agencyId).toBe(agencyId)
    expect(conv.customerName).toBe('דנה לוי')
    expect(conv.historyImportedAt).toBeInstanceOf(Date)
  })

  it('the conversation summary reflects the NEWEST imported message, not the last one processed', async () => {
    await run(graph(conversationsPayload()))
    const [conv] = await db('messenger_conversations').where({ agencyId })
    expect(conv.lastMessageText).toBe('עדיין רלוונטי?')
    expect(new Date(conv.lastInboundAt).toISOString()).toBe('2026-09-20T10:00:00.000Z')
  })

  it('a message the webhook already stored is not duplicated', async () => {
    const row = await findOrCreateMessengerConversation(db, { agencyId, pageId: PAGE, psid: PSID })
    await insertMessengerMessage(db, {
      conversationId: row.id,
      agencyId,
      pageId: PAGE,
      mid: 'm_new',
      direction: 'inbound',
      source: 'customer',
      text: 'עדיין רלוונטי?',
      attachments: [],
      channelTimestamp: new Date('2026-09-20T10:00:00Z'),
    })

    const result = await run(graph(conversationsPayload()))
    // Only the one it did not already have.
    expect(result.messages).toBe(1)
    expect(await db('messenger_messages').where({ agencyId })).toHaveLength(2)
  })

  it('running twice changes nothing the second time', async () => {
    await run(graph(conversationsPayload()))
    const second = await run(graph(conversationsPayload()))
    expect(second.messages).toBe(0)
    expect(await db('messenger_messages').where({ agencyId })).toHaveLength(2)
  })

  it('labels business-sent messages as page_inbox — the import cannot tell which tool sent them', async () => {
    await run(
      graph({
        data: [
          {
            id: 't_1',
            participants: { data: [{ id: PAGE }, { id: PSID }] },
            messages: {
              data: [
                { id: 'm_out', message: 'ענינו', created_time: '2026-09-20T11:00:00+0000', from: { id: PAGE } },
              ],
            },
          },
        ],
      }),
    )
    const [msg] = await db('messenger_messages').where({ agencyId })
    expect(msg.direction).toBe('outbound')
    expect(msg.source).toBe('page_inbox')
  })

  it('an outbound-only thread does not open the reply window', async () => {
    await run(
      graph({
        data: [
          {
            id: 't_1',
            participants: { data: [{ id: PAGE }, { id: PSID }] },
            messages: {
              data: [{ id: 'm_out', message: 'ענינו', created_time: '2026-09-20T11:00:00+0000', from: { id: PAGE } }],
            },
          },
        ],
      }),
    )
    const [conv] = await db('messenger_conversations').where({ agencyId })
    // The 24-hour window is measured from the CUSTOMER's last message.
    expect(conv.lastInboundAt).toBeNull()
  })

  it('skips a thread whose customer participant cannot be identified rather than guessing', async () => {
    const result = await run(
      graph({
        data: [
          {
            id: 't_1',
            participants: { data: [{ id: PAGE }] },
            messages: { data: [{ id: 'm_x', message: 'x', created_time: '2026-09-20T10:00:00+0000' }] },
          },
        ],
      }),
    )
    expect(result.conversations).toBe(0)
    expect(await db('messenger_conversations').where({ agencyId })).toHaveLength(0)
  })

  it('maps Conversations-API attachments into the shape the thread renders', async () => {
    await run(
      graph({
        data: [
          {
            id: 't_1',
            participants: { data: [{ id: PAGE }, { id: PSID }] },
            messages: {
              data: [
                {
                  id: 'm_img',
                  message: '',
                  created_time: '2026-09-20T10:00:00+0000',
                  from: { id: PSID },
                  attachments: {
                    data: [{ mime_type: 'image/jpeg', image_data: { url: 'https://cdn.example/p.jpg' } }],
                  },
                },
              ],
            },
          },
        ],
      }),
    )
    const [msg] = await db('messenger_messages').where({ agencyId })
    const attachments = typeof msg.attachments === 'string' ? JSON.parse(msg.attachments) : msg.attachments
    expect(attachments).toEqual([{ type: 'image', url: 'https://cdn.example/p.jpg' }])
  })

  it('a refusal is reported as a typed failure and stores nothing', async () => {
    const result = await run(graph({ error: { code: 10, message: 'no permission' } }, 400))
    expect(result).toMatchObject({ failure: 'permission', conversations: 0, messages: 0 })
    expect(await db('messenger_conversations').where({ agencyId })).toHaveLength(0)
  })

  it('a rate limit is distinguished from a permission problem', async () => {
    const result = await run(graph({ error: { code: 4 } }, 400))
    expect(result.failure).toBe('rate_limited')
  })

  it('never writes into another agency, even for the same Page id', async () => {
    const [other] = await db('agencies').insert({ name: '__test_import_other__' }).returning('id')
    await run(graph(conversationsPayload()))
    expect(await db('messenger_conversations').where({ agencyId: Number(other.id) })).toHaveLength(0)
    await db('agencies').where({ id: Number(other.id) }).delete()
  })
})
