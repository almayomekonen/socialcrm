import { createHmac } from 'node:crypto'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { db } from '@/config/db'
import { claimHistoryImports, historyImportSummary } from '@/db/whatsappHistoryImports'
import { processHistoryImport, runHistoryImportWorker } from '@/lib/inbox/history/importWorker'
import { receiveHistoryWebhook } from '@/lib/inbox/history/receiveHistory'
import { historyActivationState, historyAllowlist, isHistoryEnabledForPhoneNumber } from '@/lib/whatsapp/historyFlags'
import { messageTimelineOrderSql } from '@/lib/inbox/messageTimeline'
import { HISTORY_CHUNK_VALUE, CUSTOMER_A, CUSTOMER_B } from '../whatsapp/fixtures/historyPayloads'

/**
 * Wave 2A.2e — end-to-end replay and the activation gate.
 *
 * Two questions this file answers that no earlier phase did:
 *   1. does the WHOLE pipeline work, receive → durable → worker → inbox, with a
 *      second identical delivery changing nothing?
 *   2. can history be turned on by any single action, in any single place?
 *
 * The payload is Meta's DOCUMENTED example, sanitized — not a real archive. No
 * real Coexistence history has been obtained (see the phase report), so this
 * proves the pipeline against the published contract, not against live data.
 */

const PHONE_ID = '__act_pn_1'
const ENV_KEY = 'WHATSAPP_HISTORY_PHONE_ALLOWLIST'

let agencyId: number
let convA: number
let convB: number

function value(chunkOrder: number) {
  const v = JSON.parse(JSON.stringify(HISTORY_CHUNK_VALUE))
  v.metadata.phone_number_id = PHONE_ID
  v.history[0].metadata.chunk_order = chunkOrder
  for (const t of v.history[0].threads) {
    for (const m of t.messages) m.id = m.id.replace('wamid.SYNTHETIC', 'wamid.ACTSUITE')
  }
  return v
}

const CONV_STATE = ['unreadCount', 'messageCount', 'lastMessageAt', 'lastInboundAt', 'lastDirection', 'leadId'] as const
async function convState(id: number) {
  const cols = await db('inbox_conversations').columnInfo()
  return db('inbox_conversations').where({ id }).first(...CONV_STATE.filter((c) => c in cols))
}

beforeAll(async () => {
  const [a] = await db('agencies').insert({ name: '__test_act__' }).returning('id')
  agencyId = Number(a.id)
  const [u] = await db('users').insert({ firstName: 'A', role: 'AGNT', agencyId }).returning('id')
  await db('whatsapp_connections').insert({ user_id: u.id, agency_id: agencyId, phone_number_id: PHONE_ID, access_token: 'x' })

  const [c1] = await db('inbox_conversations')
    .insert({ agencyId, leadId: null, businessPhoneNumberId: PHONE_ID, customerWaId: CUSTOMER_A, unreadCount: 2 })
    .returning('id')
  convA = Number(c1.id)
  const [c2] = await db('inbox_conversations')
    .insert({ agencyId, leadId: null, businessPhoneNumberId: PHONE_ID, customerWaId: CUSTOMER_B })
    .returning('id')
  convB = Number(c2.id)
})

afterEach(() => {
  delete process.env[ENV_KEY]
})

afterAll(async () => {
  await db('whatsapp_history_imports').where({ agencyId }).del()
  await db('inbox_messages').whereIn('conversationId', [convA, convB]).del()
  await db('inbox_conversations').whereIn('id', [convA, convB]).del()
  await db('whatsapp_connections').where({ phone_number_id: PHONE_ID }).del()
  await db('users').where({ agencyId }).del()
  await db('agencies').where({ id: agencyId }).del()
  await db.destroy()
})

describe('activation gate — default deny', () => {
  it('unset allowlist denies every number', () => {
    delete process.env[ENV_KEY]
    expect(isHistoryEnabledForPhoneNumber(PHONE_ID)).toBe(false)
    expect(historyAllowlist()).toEqual([])
    expect(historyActivationState()).toEqual({ mode: 'off', count: 0 })
  })

  it('empty and whitespace-only allowlists deny — never "on for everyone"', () => {
    for (const raw of ['', '   ', ',', ' , ']) {
      process.env[ENV_KEY] = raw
      expect(isHistoryEnabledForPhoneNumber(PHONE_ID)).toBe(false)
    }
  })

  it('an allowlist enables ONLY the named number', () => {
    process.env[ENV_KEY] = `${PHONE_ID}, other_pn`
    expect(isHistoryEnabledForPhoneNumber(PHONE_ID)).toBe(true)
    expect(isHistoryEnabledForPhoneNumber('other_pn')).toBe(true)
    expect(isHistoryEnabledForPhoneNumber('__not_listed')).toBe(false)
    expect(isHistoryEnabledForPhoneNumber(null)).toBe(false)
    expect(historyActivationState()).toEqual({ mode: 'allowlist', count: 2 })
  })

  it('BOTH keys are required — neither alone can request an archive', async () => {
    const src = await import('node:fs').then((fs) => fs.readFileSync('lib/whatsapp/coexistence.ts', 'utf8'))
    // The request site demands the code constant AND the allowlist.
    expect(src).toContain('if (!HISTORY_SYNC_ENABLED || !isHistoryEnabledForPhoneNumber(phoneNumberId))')
    // And the code constant is still false, so the allowlist alone does nothing.
    expect(src).toContain('export const HISTORY_SYNC_ENABLED = false')
  })

  it('the worker claims NOTHING while the allowlist is empty', async () => {
    delete process.env[ENV_KEY]
    process.env[ENV_KEY] = `${PHONE_ID}`
    await receiveHistoryWebhook(value(9001))
    delete process.env[ENV_KEY]

    // The delivery is durable, but unprocessable until the number is activated.
    expect(await runHistoryImportWorker('w-denied', { limit: 10 })).toMatchObject({ claimed: 0 })
    const row = await db('whatsapp_history_imports').where({ agencyId, importKey: 'chunk:0:9001' }).first()
    expect(row.status).toBe('received')
    // Not dropped: an archive that cannot be re-requested is never discarded
    // just because processing is not activated yet.
    expect(row.payload).toBeTruthy()
  })

  it('the same delivery becomes claimable the moment the number is allowlisted', async () => {
    process.env[ENV_KEY] = PHONE_ID
    const claimed = await claimHistoryImports('w-allowed', 10, { allowPhoneNumberIds: historyAllowlist() })
    expect(claimed.map((j) => j.importKey)).toContain('chunk:0:9001')
    await db('whatsapp_history_imports').where({ agencyId }).update({ status: 'completed' })
  })
})

describe('end-to-end replay (documented payload)', () => {
  let before: Record<string, unknown> | undefined

  it('receive → durable row → worker → inbox_messages', async () => {
    process.env[ENV_KEY] = PHONE_ID
    before = await convState(convA)

    const received = await receiveHistoryWebhook(value(9100))
    expect(received.outcome).toBe('recorded')

    const summary = await runHistoryImportWorker('w-e2e', { limit: 10 })
    expect(summary).toMatchObject({ claimed: 1, completed: 1 })

    const row = await db('whatsapp_history_imports').where({ agencyId, importKey: 'chunk:0:9100' }).first()
    expect(row.status).toBe('completed')
    expect(row.messagesInserted).toBe(4)
    expect(Number(row.agencyId)).toBe(agencyId)
  })

  it('messages landed with the right tenant, conversation, direction and timestamps', async () => {
    const rows = await db('inbox_messages')
      .whereIn('conversationId', [convA, convB])
      .orderBy('id', 'asc')
      .select('conversationId', 'agencyId', 'leadId', 'direction', 'channelTimestamp', 'createdAt', 'metadata', 'channel')

    expect(rows).toHaveLength(4)
    for (const r of rows) {
      expect(Number(r.agencyId)).toBe(agencyId)
      expect(r.channel).toBe('whatsapp')
      expect(r.leadId).toBeNull()
      expect(r.metadata.source).toBe('whatsapp_history')
      expect(r.metadata.history.chunkOrder).toBe(9100)
      // Meta's moment, and our ingest moment, kept distinct.
      expect(new Date(r.createdAt).getTime()).toBeGreaterThan(new Date(r.channelTimestamp).getTime())
    }
    expect(rows.filter((r) => r.direction === 'outbound')).toHaveLength(3)
    expect(rows.filter((r) => r.direction === 'inbound')).toHaveLength(1)
  })

  it('the conversation live state is untouched', async () => {
    expect(await convState(convA)).toEqual(before)
  })

  it('live and historical messages interleave by TIMESTAMP, not by insertion', async () => {
    // A live message inserted now, but dated BEFORE the archived ones.
    const [live] = await db('inbox_messages')
      .insert({
        conversationId: convA,
        agencyId,
        channel: 'whatsapp',
        direction: 'inbound',
        externalId: 'wamid.ACT_LIVE_1',
        type: 'text',
        text: 'live',
        status: 'received',
        sequence: 9999,
        channelTimestamp: new Date('2020-01-01T00:00:00Z'),
        payload: JSON.stringify({}),
        rawPayload: JSON.stringify(null),
        metadata: JSON.stringify({}),
      })
      .returning('id')

    const ordered = await db('inbox_messages as m')
      .where('m.conversationId', convA)
      .orderByRaw(messageTimelineOrderSql('m'))
      .select('m.id', 'm.channelTimestamp')

    // Highest id, oldest timestamp → sorts FIRST. Insertion order is irrelevant.
    expect(Number(ordered[0].id)).toBe(Number(live.id))
    const times = ordered.map((r) => new Date(r.channelTimestamp).getTime())
    expect([...times].sort((a, b) => a - b)).toEqual(times)

    await db('inbox_messages').where({ id: live.id }).del()
  })

  it('replaying the identical delivery changes nothing at either layer', async () => {
    process.env[ENV_KEY] = PHONE_ID
    const importRows = await db('whatsapp_history_imports').where({ agencyId }).count()
    const messageRows = await db('inbox_messages').whereIn('conversationId', [convA, convB]).count()
    const stateBefore = await convState(convA)

    const again = await receiveHistoryWebhook(value(9100))
    expect(again.outcome).toBe('duplicate')

    // Chunk idempotency: no second durable row, and nothing to claim.
    expect(await db('whatsapp_history_imports').where({ agencyId }).count()).toEqual(importRows)
    expect(await runHistoryImportWorker('w-replay', { limit: 10 })).toMatchObject({ claimed: 0 })

    // The cursor alone already makes a forced re-claim a no-op: it sits at the
    // end of the delivery, so there is nothing left to walk.
    await db('whatsapp_history_imports').where({ agencyId, importKey: 'chunk:0:9100' }).update({ status: 'received' })
    expect(await runHistoryImportWorker('w-replay2', { limit: 10 })).toMatchObject({ claimed: 1, completed: 1 })
    let row = await db('whatsapp_history_imports').where({ agencyId, importKey: 'chunk:0:9100' }).first()
    expect(row.messagesInserted).toBe(4) // accumulated lifetime total, not the last run
    expect(row.messagesDuplicate).toBe(0)

    // Rewind the cursor to force every message through persistence again: the
    // (channel, externalId) layer underneath must turn all four into duplicates.
    await db('whatsapp_history_imports')
      .where({ agencyId, importKey: 'chunk:0:9100' })
      .update({ status: 'received', cursor: 0 })
    expect(await runHistoryImportWorker('w-replay3', { limit: 10 })).toMatchObject({ claimed: 1 })
    row = await db('whatsapp_history_imports').where({ agencyId, importKey: 'chunk:0:9100' }).first()
    expect(row.messagesDuplicate).toBe(4)
    expect(row.messagesInserted).toBe(4) // unchanged: nothing new was inserted

    expect(await db('inbox_messages').whereIn('conversationId', [convA, convB]).count()).toEqual(messageRows)
    expect(await convState(convA)).toEqual(stateBefore)
  })

  it('no automation, AI, signal, notification or lead resulted', async () => {
    expect(await db('clients').where({ agencyId }).count()).toEqual([{ count: '0' }])
    for (const t of ['signal_jobs', 'auto_response_jobs', 'notification_jobs', 'ai_insights']) {
      const exists = await db.raw(`select to_regclass('public.${t}') as t`)
      if (!exists.rows[0].t) continue
      expect(await db(t).where({ agencyId }).count()).toEqual([{ count: '0' }])
    }
  })

  it('the summary reports what META claimed, not what we verified', async () => {
    const s = await historyImportSummary(agencyId, PHONE_ID)
    // Counters now ACCUMULATE across runs (required by F-1's resumability), so
    // they are a lifetime total rather than the last attempt's slice: 4 inserted
    // once, plus 4 duplicates from the deliberate rewind above.
    expect(s.counts.messagesInserted).toBe(4)
    expect(s.counts.messagesDuplicate).toBe(4)
    expect(await db('inbox_messages').whereIn('conversationId', [convA, convB]).count()).toEqual([{ count: '4' }])
    // The fixture's progress is 55, so Meta never claimed completion.
    expect(s.metaReportedComplete).toBe(false)
    expect(s.phasesSeen).toEqual([0])
  })
})

describe('production reachability', () => {
  it('a signed history webhook returns 200 and imports NOTHING while gated', async () => {
    process.env.META_APP_SECRET = process.env.META_APP_SECRET || 'test-app-secret'
    process.env[ENV_KEY] = PHONE_ID // even fully allowlisted
    const before = await db('whatsapp_history_imports').where({ agencyId }).count()

    const body = JSON.stringify({
      object: 'whatsapp_business_account',
      entry: [{ id: 'WABA', changes: [{ field: 'history', value: value(9200) }] }],
    })
    const sig = 'sha256=' + createHmac('sha256', process.env.META_APP_SECRET).update(body).digest('hex')
    const { POST } = await import('@/app/api/webhooks/whatsapp/route')
    const res = await POST(
      new Request('https://getsocialcrm.com/api/webhooks/whatsapp', {
        method: 'POST',
        headers: { 'x-hub-signature-256': sig, 'content-type': 'application/json' },
        body,
      }) as never,
    )

    expect(res.status).toBe(200)
    // HISTORY_SYNC_ENABLED is false, so the branch was reached and refused.
    // The allowlist being satisfied is not enough — that is the two-key property.
    expect(await db('whatsapp_history_imports').where({ agencyId }).count()).toEqual(before)
  })
})
