import { createHmac } from 'node:crypto'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { db } from '@/config/db'
import { claimHistoryImports, recordHistoryDelivery } from '@/db/whatsappHistoryImports'
import { processHistoryImport, runHistoryImportWorker } from '@/lib/inbox/history/importWorker'
import { receiveHistoryWebhook } from '@/lib/inbox/history/receiveHistory'
import { parseHistoryValue } from '@/lib/whatsapp/parseHistory'
import type { ParsedHistoryEvent } from '@/lib/whatsapp/historyEvent'
import { HISTORY_CHUNK_VALUE, CUSTOMER_A } from '../whatsapp/fixtures/historyPayloads'

/**
 * Wave 2A.2g.1 — the three activation blockers.
 *
 * F-2: a history webhook is acknowledged only after a durable write.
 * F-1: a large delivery makes real forward progress across runs.
 * F-3: an archive may establish the conversation, never the Lead.
 */

const PHONE_ID = '__rs_pn_1'
const OTHER_PHONE_ID = '__rs_pn_2'
const ENV_KEY = 'WHATSAPP_HISTORY_PHONE_ALLOWLIST'
const ALLOW = { allowPhoneNumberIds: [PHONE_ID] }

let agencyId: number
let otherAgencyId: number
let leadId: number
let convLead: number
let convOther: number

/** A synthetic chunk of `n` messages in one thread, deterministic per key. */
function bigChunk(key: number, n: number, customer = '15558880001') {
  return {
    messaging_product: 'whatsapp',
    metadata: { display_phone_number: '15550001111', phone_number_id: PHONE_ID },
    history: [
      {
        metadata: { phase: 0, chunk_order: key, progress: 10 },
        threads: [
          {
            id: customer,
            messages: Array.from({ length: n }, (_, i) => ({
              from: i % 2 === 0 ? customer : '15550001111',
              id: `wamid.RS${key}_${i}`,
              timestamp: String(1739230000 + i),
              type: 'text',
              text: { body: `m${i}` },
              history_context: { status: 'READ' },
            })),
          },
        ],
      },
    ],
  }
}

const parse = (v: unknown) => parseHistoryValue(v) as ParsedHistoryEvent
const record = (v: unknown, agency = agencyId) =>
  recordHistoryDelivery({ agencyId: agency, phoneNumberId: PHONE_ID, event: parse(v), rawValue: v })

/**
 * Record a delivery and claim THAT one.
 *
 * The claim takes the oldest eligible row, so without retiring earlier
 * deliveries a test would silently process its predecessor's payload — which is
 * exactly what the first run of this file did.
 */
async function recordAndClaim(v: unknown, worker: string) {
  await db('whatsapp_history_imports').where({ agencyId }).whereIn('status', ['received', 'processing']).update({ status: 'completed' })
  const rec = await record(v)
  const [job] = await claimHistoryImports(worker, 1, ALLOW)
  expect(job.id).toBe(rec.id)
  return job
}

const CONV_STATE = ['unreadCount', 'messageCount', 'lastMessageAt', 'lastInboundAt', 'lastDirection', 'leadId'] as const
async function convState(id: number) {
  const cols = await db('inbox_conversations').columnInfo()
  return db('inbox_conversations').where({ id }).first(...CONV_STATE.filter((c) => c in cols))
}

beforeAll(async () => {
  const [a] = await db('agencies').insert({ name: '__test_rs__' }).returning('id')
  agencyId = Number(a.id)
  const [b] = await db('agencies').insert({ name: '__test_rs_other__' }).returning('id')
  otherAgencyId = Number(b.id)
  const [u] = await db('users').insert({ firstName: 'R', role: 'AGNT', agencyId }).returning('id')
  const [u2] = await db('users').insert({ firstName: 'R2', role: 'AGNT', agencyId: otherAgencyId }).returning('id')
  await db('whatsapp_connections').insert([
    { user_id: u.id, agency_id: agencyId, phone_number_id: PHONE_ID, access_token: 'x' },
    { user_id: u2.id, agency_id: otherAgencyId, phone_number_id: OTHER_PHONE_ID, access_token: 'x' },
  ])
  const [l] = await db('clients')
    .insert({ firstName: '__rs__', lastName: 'Lead', agencyId, userId: u.id, createdById: u.id, lead: true, status: 'new' })
    .returning('id')
  leadId = Number(l.id)
  // A lead-linked conversation for the inheritance case.
  const [c1] = await db('inbox_conversations')
    .insert({ agencyId, leadId, businessPhoneNumberId: PHONE_ID, customerWaId: '15558880099', unreadCount: 5 })
    .returning('id')
  convLead = Number(c1.id)
  // Agency B holds the SAME customer wa_id — the isolation case.
  const [c2] = await db('inbox_conversations')
    .insert({ agencyId: otherAgencyId, leadId: null, businessPhoneNumberId: OTHER_PHONE_ID, customerWaId: CUSTOMER_A })
    .returning('id')
  convOther = Number(c2.id)
})

afterEach(() => {
  delete process.env[ENV_KEY]
  vi.restoreAllMocks()
})

afterAll(async () => {
  const convs = (await db('inbox_conversations').whereIn('agencyId', [agencyId, otherAgencyId]).pluck('id')).map(Number)
  await db('whatsapp_history_imports').whereIn('agencyId', [agencyId, otherAgencyId]).del()
  if (convs.length) await db('inbox_messages').whereIn('conversationId', convs).del()
  await db('inbox_conversations').whereIn('agencyId', [agencyId, otherAgencyId]).del()
  await db('whatsapp_connections').whereIn('phone_number_id', [PHONE_ID, OTHER_PHONE_ID]).del()
  await db('clients').where({ id: leadId }).del()
  await db('users').whereIn('agencyId', [agencyId, otherAgencyId]).del()
  await db('agencies').whereIn('id', [agencyId, otherAgencyId]).del()
  await db.destroy()
})

// ─────────────────────────────── F-2 ───────────────────────────────

describe('F-2 · durable receipt before acknowledgement', () => {
  const secret = 'rs-secret'

  it('F2-1: a new delivery is durably persisted, then acknowledged', async () => {
    const v = bigChunk(1001, 2)
    const res = await receiveHistoryWebhook(v)
    expect(res.outcome).toBe('recorded')
    const row = await db('whatsapp_history_imports').where({ agencyId, importKey: 'chunk:0:1001' }).first()
    expect(row).toBeTruthy()
    expect(row.payload).toEqual(v)
  })

  it('F2-2: a duplicate is acknowledged as an already-persisted delivery', async () => {
    const res = await receiveHistoryWebhook(bigChunk(1001, 2))
    expect(res.outcome).toBe('duplicate')
    expect(await db('whatsapp_history_imports').where({ agencyId, importKey: 'chunk:0:1001' }).count()).toEqual([
      { count: '1' },
    ])
  })

  it('F2-3/F2-4: a durable-write failure is NEVER acknowledged', async () => {
    const boom = new Error('connection terminated unexpectedly')
    const failing = vi.spyOn(await import('@/db/whatsappHistoryImports'), 'recordHistoryDelivery')
    failing.mockRejectedValueOnce(boom)

    const res = await receiveHistoryWebhook(bigChunk(1002, 1))
    // Previously this returned a swallowed outcome the route ignored, and the
    // webhook answered 200 — losing that piece of a one-shot archive forever.
    expect(res.outcome).toBe('failed')
    expect((res as { error: string }).error).toContain('connection terminated')

    // Nothing was recorded, so nothing may be acknowledged.
    expect(await db('whatsapp_history_imports').where({ agencyId, importKey: 'chunk:0:1002' }).first()).toBeUndefined()
  })

  it('F2-3b: a tenant-lookup failure is a failure, not "unknown tenant"', async () => {
    const { resolveHistoryTenant } = await import('@/lib/inbox/persistHistoryMessage')
    void resolveHistoryTenant
    const src = (await import('node:fs')).readFileSync('lib/inbox/persistHistoryMessage.ts', 'utf8')
    const fn = src.slice(src.indexOf('export async function resolveHistoryTenant'))
    // The `.catch(() => null)` that made an outage look like "not our number"
    // — and so produced a 200 — is gone.
    expect(fn.slice(0, fn.indexOf('\n}'))).not.toContain('.catch(')
  })

  it('F2-5: no raw delivery means no acknowledgement — the route returns 503', async () => {
    // The gate is closed, so the enabled path is asserted structurally: the
    // failure outcome is the only one that refuses, and the route turns that
    // refusal into a non-2xx rather than an acknowledgement.
    const coex = (await import('node:fs')).readFileSync('lib/whatsapp/coexistence.ts', 'utf8')
    expect(coex).toContain("received.outcome === 'failed'")
    expect(coex).toContain("reason: 'history_durable_write_failed'")
    const receive = (await import('node:fs')).readFileSync('lib/whatsapp/webhook/receive.ts', 'utf8')
    expect(receive).toContain("if (!(await handleInline(change.field, change.entryId, change.value))) result.status = 503")
    const route = (await import('node:fs')).readFileSync('app/api/webhooks/whatsapp/route.ts', 'utf8')
    expect(route).toContain('status: 503')
  })

  it('F2-6: a duplicate acknowledgement does not reprocess', async () => {
    process.env[ENV_KEY] = PHONE_ID
    const before = await db('whatsapp_history_imports').where({ agencyId, importKey: 'chunk:0:1001' }).first()
    await receiveHistoryWebhook(bigChunk(1001, 2))
    const after = await db('whatsapp_history_imports').where({ agencyId, importKey: 'chunk:0:1001' }).first()
    expect(after.status).toBe(before.status)
    expect(after.cursor).toBe(before.cursor)
    expect(after.attempts).toBe(before.attempts)
  })

  it('F2-7: echo and state_sync behaviour is unchanged — still acknowledged 200', async () => {
    process.env.META_APP_SECRET = secret
    for (const field of ['smb_app_state_sync', 'smb_message_echoes']) {
      const body = JSON.stringify({
        object: 'whatsapp_business_account',
        entry: [{ id: 'WABA', changes: [{ field, value: { metadata: { phone_number_id: PHONE_ID } } }] }],
      })
      const sig = 'sha256=' + createHmac('sha256', secret).update(body).digest('hex')
      const { POST } = await import('@/app/api/webhooks/whatsapp/route')
      const res = await POST(
        new Request('https://getsocialcrm.com/api/webhooks/whatsapp', {
          method: 'POST',
          headers: { 'x-hub-signature-256': sig, 'content-type': 'application/json' },
          body,
        }) as never,
      )
      expect(res.status).toBe(200)
    }
  })

  it('F2-8: HMAC verification still precedes everything', async () => {
    process.env.META_APP_SECRET = secret
    const { POST } = await import('@/app/api/webhooks/whatsapp/route')
    const res = await POST(
      new Request('https://getsocialcrm.com/api/webhooks/whatsapp', {
        method: 'POST',
        headers: { 'x-hub-signature-256': 'sha256=deadbeef', 'content-type': 'application/json' },
        body: JSON.stringify({ object: 'whatsapp_business_account', entry: [] }),
      }) as never,
    )
    expect(res.status).toBe(403)
  })
})

// ─────────────────────────────── F-1 ───────────────────────────────

describe('F-1 · bounded, resumable delivery processing', () => {
  it('F1-1: a one-message delivery completes in one run', async () => {
    process.env[ENV_KEY] = PHONE_ID
    const job = await recordAndClaim(bigChunk(2001, 1), 'f1a')
    const r = await processHistoryImport(job)
    expect(r.status).toBe('completed')
    expect(r.messagesInserted).toBe(1)
  })

  it('F1-2/F1-3: a large delivery yields at its message budget instead of running unbounded', async () => {
    process.env[ENV_KEY] = PHONE_ID
    const job = await recordAndClaim(bigChunk(2002, 12), 'f1b')
    const id = job.id

    const r = await processHistoryImport(job, { messageBudget: 5 })
    expect(r.status).toBe('checkpointed')
    expect(r.messagesInserted).toBe(5)

    const row = await db('whatsapp_history_imports').where({ id }).first()
    expect(row.cursor).toBe(5)
    // A checkpoint is not a failure: released, immediately claimable, attempts reset,
    // and NOT marked complete.
    expect(row.status).toBe('received')
    expect(row.attempts).toBe(0)
    expect(row.completedAt).toBeNull()
    expect(row.lockedBy).toBeNull()
  })

  it('F1-4: the next run RESUMES — real forward progress, no re-walking', async () => {
    process.env[ENV_KEY] = PHONE_ID
    const [job] = await claimHistoryImports('f1c', 1, ALLOW)
    expect(job.cursor).toBe(5) // picked up where the last run stopped

    const r = await processHistoryImport(job, { messageBudget: 5 })
    expect(r.status).toBe('checkpointed')
    expect(r.messagesInserted).toBe(5)
    // Crucially ZERO duplicates: it did not redo the first five.
    expect(r.messagesDuplicate).toBe(0)

    const row = await db('whatsapp_history_imports').where({ importKey: 'chunk:0:2002', agencyId }).first()
    expect(row.cursor).toBe(10)
  })

  it('F1-5: the final run completes the delivery, every message present exactly once', async () => {
    process.env[ENV_KEY] = PHONE_ID
    const [job] = await claimHistoryImports('f1d', 1, ALLOW)
    const r = await processHistoryImport(job, { messageBudget: 5 })
    expect(r.status).toBe('completed')

    const row = await db('whatsapp_history_imports').where({ importKey: 'chunk:0:2002', agencyId }).first()
    expect(row.cursor).toBe(12)
    expect(row.status).toBe('completed')
    expect(row.messagesInserted).toBe(12) // accumulated across three runs
    expect(row.messagesDuplicate).toBe(0)

    // No skipped messages, no duplicate rows.
    const ids = await db('inbox_messages').where('externalId', 'like', 'wamid.RS2002%').pluck('externalId')
    expect(ids).toHaveLength(12)
    expect(new Set(ids).size).toBe(12)
  })

  it('F1-6: a worker death mid-delivery loses nothing — reclaim resumes from the cursor', async () => {
    process.env[ENV_KEY] = PHONE_ID
    const job = await recordAndClaim(bigChunk(2003, 8), 'f1-dead')
    const id = job.id
    await processHistoryImport(job, { messageBudget: 3 }) // cursor → 3

    // The worker "dies" holding the lease.
    await db('whatsapp_history_imports').where({ id }).update({ status: 'processing', lockedBy: 'dead', lockedAt: new Date(0) })

    const s = await runHistoryImportWorker('f1-recover', { leaseMs: 0, limit: 5 })
    expect(s.reclaimed).toBeGreaterThan(0)

    const row = await db('whatsapp_history_imports').where({ id }).first()
    expect(row.status).toBe('completed')
    expect(row.cursor).toBe(8)
    const ids = await db('inbox_messages').where('externalId', 'like', 'wamid.RS2003%').pluck('externalId')
    expect(new Set(ids).size).toBe(8) // messages 4..8 continued; 1..3 not duplicated
  })

  it('F1-7: a permanently malformed message does not block the ones behind it', async () => {
    process.env[ENV_KEY] = PHONE_ID
    const v = bigChunk(2004, 3)
    // Message 2 has no wamid at all — the parser drops it before persistence.
    delete (v.history[0].threads[0].messages[1] as { id?: string }).id
    const job = await recordAndClaim(v, 'f1e')
    const id = job.id

    const r = await processHistoryImport(job)
    expect(r.status).toBe('partial')
    expect(r.messagesInserted).toBe(2) // the two valid ones still landed
    expect(r.messagesSkipped).toBe(1)

    const row = await db('whatsapp_history_imports').where({ id }).first()
    expect(row.completedAt).not.toBeNull() // terminal, not an infinite retry
  })

  it('F1-8: maxAttempts still bounds genuine failures', async () => {
    const { id } = await record(bigChunk(2005, 1))
    await db('whatsapp_history_imports').where({ id }).update({ attempts: 5, maxAttempts: 5, status: 'processing' })
    const { failHistoryImport } = await import('@/db/whatsappHistoryImports')
    await failHistoryImport(id, 'infra')
    const row = await db('whatsapp_history_imports').where({ id }).first()
    expect(row.status).toBe('failed')
  })

  it('F1-9: concurrent workers never process the same delivery', async () => {
    process.env[ENV_KEY] = PHONE_ID
    await db('whatsapp_history_imports').where({ agencyId }).update({ status: 'completed' })
    const { id } = await record(bigChunk(2006, 4))
    const [a, b] = await Promise.all([
      db.transaction((t) => claimHistoryImports('cc1', 5, ALLOW, t)),
      db.transaction((t) => claimHistoryImports('cc2', 5, ALLOW, t)),
    ])
    expect([...a, ...b].filter((j) => j.id === id)).toHaveLength(1)
  })

  it('F1-10: the worker respects the run deadline inside a delivery', async () => {
    process.env[ENV_KEY] = PHONE_ID
    await db('whatsapp_history_imports').where({ agencyId }).update({ status: 'completed' })
    const job = await recordAndClaim(bigChunk(2007, 20), 'f1f')
    const id = job.id

    let t = 1_000_000
    const r = await processHistoryImport(job, { deadline: t + 10, now: () => (t += 4), messageBudget: 9999 })
    expect(r.status).toBe('checkpointed')
    const row = await db('whatsapp_history_imports').where({ id }).first()
    expect(row.cursor).toBeGreaterThan(0)
    expect(row.cursor).toBeLessThan(20)
  })
})

// ─────────────────────────────── F-3 ───────────────────────────────

describe('F-3 · history establishes the conversation, never the Lead', () => {
  it('F3-A: a fresh onboarding with ZERO conversations imports successfully', async () => {
    process.env[ENV_KEY] = PHONE_ID
    const customer = '15558881111'
    expect(await db('inbox_conversations').where({ agencyId, customerWaId: customer }).first()).toBeUndefined()

    const job = await recordAndClaim(bigChunk(3001, 4, customer), 'f3a')
    const r = await processHistoryImport(job)
    expect(r.status).toBe('completed')
    expect(r.messagesInserted).toBe(4)

    const conv = await db('inbox_conversations').where({ agencyId, customerWaId: customer }).first()
    expect(conv).toBeTruthy()
    expect(conv.leadId).toBeNull()
    expect(Number(conv.agencyId)).toBe(agencyId)
    expect(conv.businessPhoneNumberId).toBe(PHONE_ID)
  })

  it('F3: the created conversation is NEUTRAL in every current-state column', async () => {
    const conv = await db('inbox_conversations').where({ agencyId, customerWaId: '15558881111' }).first()
    expect(conv.unreadCount).toBe(0)
    expect(conv.messageCount).toBe(0)
    expect(conv.lastMessageAt).toBeNull()
    expect(conv.lastInboundAt).toBeNull()
    expect(conv.lastDirection).toBeNull()
    expect(conv.lastMessageText).toBeNull()
  })

  it('F3-F: both directions preserved, and history stays out of current-state facts', async () => {
    const conv = await db('inbox_conversations').where({ agencyId, customerWaId: '15558881111' }).first()
    const rows = await db('inbox_messages').where({ conversationId: conv.id }).select('direction', 'metadata')
    expect(rows.filter((r) => r.direction === 'inbound')).toHaveLength(2)
    expect(rows.filter((r) => r.direction === 'outbound')).toHaveLength(2)
    // Every row carries the marker, so lastHumanOutboundAt / waiting-reply
    // cannot read a historical outbound as a current human reply.
    for (const r of rows) expect(r.metadata.source).toBe('whatsapp_history')
  })

  it('F3-B: an existing LEADLESS conversation is reused, not duplicated', async () => {
    process.env[ENV_KEY] = PHONE_ID
    const customer = '15558881111'
    const before = await db('inbox_conversations').where({ agencyId, customerWaId: customer }).first()
    const job = await recordAndClaim(bigChunk(3002, 2, customer), 'f3b')
    await processHistoryImport(job)

    expect(await db('inbox_conversations').where({ agencyId, customerWaId: customer }).count()).toEqual([{ count: '1' }])
    expect(await convState(Number(before.id))).toEqual(await convState(Number(before.id)))
    const after = await db('inbox_conversations').where({ id: before.id }).first()
    expect(after.leadId).toBeNull()
    expect(after.unreadCount).toBe(0)
  })

  it('F3-C: an existing LEAD-LINKED conversation is reused and its lead inherited', async () => {
    process.env[ENV_KEY] = PHONE_ID
    const before = await convState(convLead)
    const job = await recordAndClaim(bigChunk(3003, 3, '15558880099'), 'f3c')
    expect((await processHistoryImport(job)).status).toBe('completed')

    const rows = await db('inbox_messages').where({ conversationId: convLead }).select('leadId')
    expect(rows).toHaveLength(3)
    for (const r of rows) expect(Number(r.leadId)).toBe(leadId)
    // The lead-linked conversation's live state is untouched (unreadCount 5).
    expect(await convState(convLead)).toEqual(before)
  })

  it('F3-D: the same customer under another agency is never crossed', async () => {
    process.env[ENV_KEY] = PHONE_ID
    const beforeOther = await db('inbox_messages').where({ conversationId: convOther }).count()
    const job = await recordAndClaim(bigChunk(3004, 2, CUSTOMER_A), 'f3d')
    await processHistoryImport(job)

    // Agency A got its own conversation for that customer…
    const mine = await db('inbox_conversations').where({ agencyId, customerWaId: CUSTOMER_A }).first()
    expect(mine).toBeTruthy()
    expect(Number(mine.agencyId)).toBe(agencyId)
    // …and agency B's identical-customer thread gained nothing.
    expect(await db('inbox_messages').where({ conversationId: convOther }).count()).toEqual(beforeOther)
    expect(await convState(convOther)).toEqual(await convState(convOther))
  })

  it('F3-E: a redelivered history message creates no second conversation or message', async () => {
    process.env[ENV_KEY] = PHONE_ID
    const customer = '15558881111'
    const convs = await db('inbox_conversations').where({ agencyId, customerWaId: customer }).count()
    const msgs = await db('inbox_messages').where('externalId', 'like', 'wamid.RS3002%').count()

    await db('whatsapp_history_imports').where({ agencyId, importKey: 'chunk:0:3002' }).update({ status: 'received', cursor: 0 })
    const [job] = await claimHistoryImports('f3e', 1, ALLOW)
    const r = await processHistoryImport(job)
    expect(r.messagesDuplicate).toBe(2)
    expect(r.messagesInserted).toBe(0)

    expect(await db('inbox_conversations').where({ agencyId, customerWaId: customer }).count()).toEqual(convs)
    expect(await db('inbox_messages').where('externalId', 'like', 'wamid.RS3002%').count()).toEqual(msgs)
  })

  it('F3: no Lead was created by any of it, and no automation/AI/signal fired', async () => {
    expect(await db('clients').where({ agencyId }).count()).toEqual([{ count: '1' }]) // only the seeded one
    for (const t of ['signal_jobs', 'auto_response_jobs', 'notification_jobs', 'ai_insights']) {
      const exists = await db.raw(`select to_regclass('public.${t}') as t`)
      if (!exists.rows[0].t) continue
      expect(await db(t).where({ agencyId }).count()).toEqual([{ count: '0' }])
    }
  })

  it('F3: the creation primitive never touches an existing conversation row', () => {
    const src = require('node:fs').readFileSync('db/inboxConversations.ts', 'utf8')
    const fn = src.slice(src.indexOf('export async function ensureHistoryConversation'))
    const body = fn.slice(0, fn.indexOf('\n}'))
    expect(body).toContain('.onConflict')
    expect(body).toContain('.ignore()')
    expect(body).not.toContain('.merge(')
    // And no bump helper anywhere in the history path.
    const persist = require('node:fs').readFileSync('lib/inbox/persistHistoryMessage.ts', 'utf8')
    expect(persist).not.toContain('bumpConversationOn')
    expect(persist).not.toContain('findOrCreateConversation(')
  })
})
