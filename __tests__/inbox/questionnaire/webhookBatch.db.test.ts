import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { db } from '@/config/db'

/**
 * A WEBHOOK MAY CARRY MORE THAN ONE MESSAGE.
 *
 * The route used to read `value.messages[0]` and drop everything after it. For
 * the AI agent that lost a sentence the next turn usually recovered from the
 * transcript. For a questionnaire it loses an ANSWER: one question was asked,
 * the reply arrived batched behind another message, and nothing ever re-reads
 * it. The customer answered and the conversation stops.
 *
 * This exercises the real route handler, signature and all, against a real
 * database. The only thing stubbed is the post-response drain, because a test
 * must not run the worker as a side effect of delivering a webhook.
 */

vi.mock('@/lib/inbox/autoresponse/kickWorker', () => ({
  runAutoResponseKick: vi.fn(async () => ({ claimed: 0, sent: 0, skipped: 0, failed: 0 })),
}))

vi.mock('next/server', async () => {
  const actual = await vi.importActual<typeof import('next/server')>('next/server')
  return { ...actual, after: (fn: () => unknown) => void fn }
})

const APP_SECRET = 'test-app-secret'
const PHONE_ID = 'q_batch_pn'
const CUSTOMER = '972529999001'

let agencyId: number
let userId: number

async function post(messages: Array<Record<string, unknown>>, contacts = true) {
  const { POST } = await import('@/app/api/webhooks/whatsapp/route')
  const { createHmac } = await import('node:crypto')
  const body = JSON.stringify({
    object: 'whatsapp_business_account',
    entry: [
      {
        id: 'waba-1',
        changes: [
          {
            field: 'messages',
            value: {
              messaging_product: 'whatsapp',
              metadata: { phone_number_id: PHONE_ID },
              ...(contacts ? { contacts: [{ profile: { name: 'פונה חדש' }, wa_id: CUSTOMER }] } : {}),
              messages,
            },
          },
        ],
      },
    ],
  })
  const signature = 'sha256=' + createHmac('sha256', APP_SECRET).update(body).digest('hex')
  const req = new Request('https://example.test/api/webhooks/whatsapp', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-hub-signature-256': signature },
    body,
  })
  return POST(req as never)
}

const message = (id: string, body: string) => ({
  id,
  from: CUSTOMER,
  timestamp: String(Math.floor(Date.now() / 1000)),
  type: 'text',
  text: { body },
})

beforeAll(async () => {
  process.env.META_APP_SECRET = APP_SECRET
  const [a] = await db('agencies').insert({ name: 'q-batch', autoResponseEnabled: false }).returning('id')
  agencyId = Number(a.id)
  const [u] = await db('users').insert({ firstName: 'ב', role: 'AGNT', agencyId }).returning('id')
  userId = Number(u.id)
  await db('whatsapp_connections').insert({
    user_id: userId,
    agency_id: agencyId,
    phone_number_id: PHONE_ID,
    access_token: 'token',
  })
})

afterAll(async () => {
  const convIds = (await db('inbox_conversations').where({ agencyId }).select('id')).map((r) => Number(r.id))
  await db('analytics_events').where({ agencyId }).del()
  await db('notification_jobs').where({ agencyId }).del()
  await db('conversation_analysis_jobs').whereIn('conversationId', convIds).del()
  await db('auto_response_jobs').where({ agencyId }).del()
  await db('inbox_messages').where({ agencyId }).del()
  await db('inbox_participants').where({ agencyId }).del()
  await db('inbox_conversations').where({ agencyId }).del()
  await db('tasks').whereIn('clientId', db('clients').select('id').where({ agencyId })).del()
  await db('clients').where({ agencyId }).del()
  await db('whatsapp_connections').where({ agency_id: agencyId }).del()
  await db('users').where({ agencyId }).del()
  await db('agencies').where({ id: agencyId }).del()
})

describe('a payload carrying several messages', () => {
  it('persists every one of them, in order', async () => {
    const res = await post([
      message('wamid.batch.1', 'היי'),
      message('wamid.batch.2', '1'),
      message('wamid.batch.3', 'ותודה'),
    ])
    expect(res.status).toBe(200)

    const rows = await db('inbox_messages')
      .where({ agencyId, direction: 'inbound' })
      .orderBy('sequence', 'asc')
      .select('externalId', 'text', 'sequence')
    expect(rows.map((r) => r.text)).toEqual(['היי', '1', 'ותודה'])
    expect(rows.map((r) => Number(r.sequence))).toEqual([1, 2, 3])
  })

  it('absorbs a redelivery of the same payload without duplicating anything', async () => {
    const before = await db('inbox_messages').where({ agencyId }).count<{ count: string }[]>('id as count')
    await post([
      message('wamid.batch.1', 'היי'),
      message('wamid.batch.2', '1'),
      message('wamid.batch.3', 'ותודה'),
    ])
    const after = await db('inbox_messages').where({ agencyId }).count<{ count: string }[]>('id as count')
    expect(after[0].count).toBe(before[0].count)
  })

  it('keeps going when one message in the batch is unusable', async () => {
    await post([
      { id: 'wamid.batch.bad', type: 'text', text: { body: 'no from field' } },
      message('wamid.batch.4', 'עדיין כאן'),
    ])
    const row = await db('inbox_messages').where({ agencyId, externalId: 'wamid.batch.4' }).first('text')
    expect(row?.text).toBe('עדיין כאן')
  })

  it('creates exactly one ליד for a batch from one new customer', async () => {
    const leads = await db('clients').where({ agencyId }).count<{ count: string }[]>('id as count')
    expect(Number(leads[0].count)).toBe(1)
  })

  it('answers 200 to a payload with no messages at all', async () => {
    const res = await post([])
    expect(res.status).toBe(200)
  })
})
