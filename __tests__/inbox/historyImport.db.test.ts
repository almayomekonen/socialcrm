import { readFileSync } from 'node:fs'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { db } from '@/config/db'
import {
  claimHistoryImports,
  failHistoryImport,
  historyImportKey,
  historyImportSummary,
  recordHistoryDelivery,
  reclaimStaleHistoryImports,
} from '@/db/whatsappHistoryImports'
import { processHistoryImport, runHistoryImportWorker } from '@/lib/inbox/history/importWorker'
import { receiveHistoryWebhook } from '@/lib/inbox/history/receiveHistory'
import { parseHistoryValue } from '@/lib/whatsapp/parseHistory'
import type { ParsedHistoryEvent } from '@/lib/whatsapp/historyEvent'
import {
  CUSTOMER_A,
  CUSTOMER_B,
  HISTORY_CHUNK_VALUE,
  HISTORY_ERROR_VALUE,
  HISTORY_MEDIA_FOLLOWUP_VALUE,
} from '../whatsapp/fixtures/historyPayloads'

/**
 * Wave 2A.2d — durable orchestration, against a real PostgreSQL.
 *
 * The invariants are about DURABILITY and CONCURRENCY: a delivery is on record
 * before anything is imported, a redelivery is a no-op, two workers cannot
 * claim the same row, and a crash mid-chunk loses nothing. None of that can be
 * proven against a mocked query builder.
 */

const ALLOW_ALL = { allowPhoneNumberIds: 'all' as const }
const PHONE_ID = '__hd_pn_1'
const OTHER_PHONE_ID = '__hd_pn_2'

let agencyId: number
let otherAgencyId: number
let convA: number
let convB: number
let convOther: number

/** The fixture, re-keyed so each test owns its own delivery identity. */
function chunkValue(over: { phase?: number; chunkOrder?: number; progress?: number } = {}) {
  const v = JSON.parse(JSON.stringify(HISTORY_CHUNK_VALUE))
  v.metadata.phone_number_id = PHONE_ID
  // Meta's field names are snake_case; writing camelCase here would silently
  // leave the fixture unchanged and make every delivery the same chunk.
  if (over.phase !== undefined) v.history[0].metadata.phase = over.phase
  if (over.chunkOrder !== undefined) v.history[0].metadata.chunk_order = over.chunkOrder
  if (over.progress !== undefined) v.history[0].metadata.progress = over.progress
  // `(channel, externalId)` is GLOBALLY unique, not per-agency, so a wamid this
  // file shares with another DB test file would collide across files. Namespace
  // them so this file is self-contained however the suite is scheduled.
  for (const t of v.history[0].threads) {
    for (const m of t.messages) m.id = m.id.replace('wamid.SYNTHETIC', 'wamid.HDSUITE')
  }
  return v
}

const parse = (v: unknown) => parseHistoryValue(v) as ParsedHistoryEvent

async function record(value: unknown) {
  return recordHistoryDelivery({ agencyId, phoneNumberId: PHONE_ID, event: parse(value), rawValue: value })
}

const CONV_STATE = ['unreadCount', 'messageCount', 'lastMessageAt', 'lastInboundAt', 'lastDirection', 'leadId'] as const
async function convState(id: number) {
  const cols = await db('inbox_conversations').columnInfo()
  return db('inbox_conversations')
    .where({ id })
    .first(...CONV_STATE.filter((c) => c in cols))
}

beforeAll(async () => {
  const [a] = await db('agencies').insert({ name: '__test_hd__' }).returning('id')
  agencyId = Number(a.id)
  const [b] = await db('agencies').insert({ name: '__test_hd_other__' }).returning('id')
  otherAgencyId = Number(b.id)

  const [u] = await db('users').insert({ firstName: 'D', role: 'AGNT', agencyId }).returning('id')
  const [u2] = await db('users').insert({ firstName: 'D2', role: 'AGNT', agencyId: otherAgencyId }).returning('id')

  await db('whatsapp_connections').insert([
    { user_id: u.id, agency_id: agencyId, phone_number_id: PHONE_ID, access_token: 'x' },
    { user_id: u2.id, agency_id: otherAgencyId, phone_number_id: OTHER_PHONE_ID, access_token: 'x' },
  ])

  const [c1] = await db('inbox_conversations')
    .insert({ agencyId, leadId: null, businessPhoneNumberId: PHONE_ID, customerWaId: CUSTOMER_A, unreadCount: 4 })
    .returning('id')
  convA = Number(c1.id)
  const [c2] = await db('inbox_conversations')
    .insert({ agencyId, leadId: null, businessPhoneNumberId: PHONE_ID, customerWaId: CUSTOMER_B })
    .returning('id')
  convB = Number(c2.id)
  // Same customer wa_id, different tenant.
  const [c3] = await db('inbox_conversations')
    .insert({ agencyId: otherAgencyId, leadId: null, businessPhoneNumberId: OTHER_PHONE_ID, customerWaId: CUSTOMER_A })
    .returning('id')
  convOther = Number(c3.id)
})

afterAll(async () => {
  await db('whatsapp_history_imports').whereIn('agencyId', [agencyId, otherAgencyId]).del()
  await db('inbox_messages').whereIn('conversationId', [convA, convB, convOther]).del()
  await db('inbox_conversations').whereIn('id', [convA, convB, convOther]).del()
  await db('whatsapp_connections').whereIn('phone_number_id', [PHONE_ID, OTHER_PHONE_ID]).del()
  await db('users').whereIn('agencyId', [agencyId, otherAgencyId]).del()
  await db('agencies').whereIn('id', [agencyId, otherAgencyId]).del()
  await db.destroy()
})

describe('durable receive', () => {
  it('T1/T2: a delivery is on record BEFORE any message exists', async () => {
    const value = chunkValue({ chunkOrder: 101 })
    const { id, inserted } = await record(value)
    expect(inserted).toBe(true)

    const row = await db('whatsapp_history_imports').where({ id }).first()
    expect(row.status).toBe('received')
    expect(row.kind).toBe('chunk')
    // The RAW value is what was stored — not our interpretation of it.
    expect(row.payload).toEqual(value)
    // Nothing has touched the inbox yet.
    expect(row.messagesSeen).toBe(0)
  })

  it('T5/T6/T7: phase, chunkOrder and progress are preserved as facts', async () => {
    const { id } = await record(chunkValue({ phase: 2, chunkOrder: 102, progress: 40 }))
    const row = await db('whatsapp_history_imports').where({ id }).first()
    expect([row.phase, row.chunkOrder, row.progress]).toEqual([2, 102, 40])
  })

  it('T3: the same chunk twice is one durable row', async () => {
    const value = chunkValue({ chunkOrder: 103 })
    const first = await record(value)
    // A redelivery whose progress advanced is still THE SAME CHUNK.
    const second = await record(chunkValue({ chunkOrder: 103, progress: 99 }))
    expect(second).toEqual({ id: first.id, inserted: false })
    expect(
      await db('whatsapp_history_imports').where({ agencyId, importKey: 'chunk:0:103' }).count(),
    ).toEqual([{ count: '1' }])
  })

  it('T4: chunk 7 before chunk 2 is valid and never rejected', async () => {
    const late = await record(chunkValue({ chunkOrder: 207 }))
    const early = await record(chunkValue({ chunkOrder: 202 }))
    expect(late.inserted).toBe(true)
    expect(early.inserted).toBe(true)
    // Arrival order is NOT chunk order, and nothing waits for the gap.
    expect(late.id).toBeLessThan(early.id)
  })

  it('the idempotency key is semantic for chunks, hashed for the shapes without one', () => {
    expect(historyImportKey(parse(chunkValue({ chunkOrder: 9 })), {})).toBe('chunk:0:9')
    expect(historyImportKey(parse(HISTORY_MEDIA_FOLLOWUP_VALUE), { a: 1 })).toMatch(/^media:[0-9a-f]{64}$/)
    expect(historyImportKey(parse(HISTORY_ERROR_VALUE), { a: 1 })).toMatch(/^error:[0-9a-f]{64}$/)
  })
})

describe('concurrency', () => {
  it('T8/T9: one worker claims, the second skips the same row', async () => {
    await db('whatsapp_history_imports').where({ agencyId }).update({ status: 'completed' })
    const { id } = await record(chunkValue({ chunkOrder: 301 }))

    // Two claims racing inside open transactions: FOR UPDATE SKIP LOCKED means
    // the second sees no eligible row rather than blocking on the first.
    const [a, b] = await Promise.all([
      db.transaction(async (t) => claimHistoryImports('worker-a', 5, ALLOW_ALL, t)),
      db.transaction(async (t) => claimHistoryImports('worker-b', 5, ALLOW_ALL, t)),
    ])
    const claimedIds = [...a, ...b].map((j) => j.id)
    expect(claimedIds.filter((x) => x === id)).toHaveLength(1)

    const row = await db('whatsapp_history_imports').where({ id }).first()
    expect(row.status).toBe('processing')
    expect(row.attempts).toBe(1)
    expect(['worker-a', 'worker-b']).toContain(row.lockedBy)
  })

  it('T10: a lease lost to a crashed worker is reclaimed, attempts not refunded', async () => {
    await db('whatsapp_history_imports').where({ agencyId }).update({ status: 'completed' })
    const { id } = await record(chunkValue({ chunkOrder: 302 }))
    await claimHistoryImports('worker-dead', 5, ALLOW_ALL)

    expect(await reclaimStaleHistoryImports(60_000, Date.now() + 120_000)).toBeGreaterThan(0)
    const row = await db('whatsapp_history_imports').where({ id }).first()
    expect(row.status).toBe('received')
    expect(row.attempts).toBe(1)
    expect(row.lastError).toBe('lease-expired-reclaimed')
  })
})

describe('chunk processing', () => {
  it('T11/T12/T13: messages import, malformed ones are counted, the chunk survives', async () => {
    await db('whatsapp_history_imports').where({ agencyId }).update({ status: 'completed' })
    const before = await convState(convA)
    await record(chunkValue({ chunkOrder: 401 }))
    const [job] = await claimHistoryImports('w1', 1, ALLOW_ALL)

    const r = await processHistoryImport(job)
    expect(r.status).toBe('completed')
    expect(r.messagesInserted).toBe(4)
    expect(r.messagesSkipped).toBe(0)

    // T23: the conversation is untouched.
    expect(await convState(convA)).toEqual(before)
  })

  it('T11b: reprocessing the same chunk turns every message into a duplicate', async () => {
    await db('whatsapp_history_imports').where({ agencyId }).update({ status: 'completed' })
    const rowCount = await db('inbox_messages').whereIn('conversationId', [convA, convB]).count()

    await record(chunkValue({ chunkOrder: 402 }))
    const [job] = await claimHistoryImports('w2', 1, ALLOW_ALL)
    const r = await processHistoryImport(job)

    expect(r.messagesDuplicate).toBe(4)
    expect(r.messagesInserted).toBe(0)
    // T12: no duplicate rows — the (channel, externalId) layer held.
    expect(await db('inbox_messages').whereIn('conversationId', [convA, convB]).count()).toEqual(rowCount)
  })

  it('T14 (F-3): a thread with no conversation now CREATES one and imports', async () => {
    await db('whatsapp_history_imports').where({ agencyId }).update({ status: 'completed' })
    const orphan = chunkValue({ chunkOrder: 403 })
    orphan.history[0].threads = [
      { id: '15557770000', messages: [{ from: '15557770000', id: 'wamid.ORPHAN_D1', timestamp: '1739230955', type: 'text', text: { body: 'x' } }] },
    ]
    await record(orphan)
    const [job] = await claimHistoryImports('w3', 1, ALLOW_ALL)

    const r = await processHistoryImport(job)
    expect(r.status).toBe('completed')
    expect(r.messagesInserted).toBe(1)
    expect(r.messagesSkipped).toBe(0)

    const row = await db('whatsapp_history_imports').where({ id: job.id }).first()
    expect(row.status).toBe('completed')
    expect(row.completedAt).not.toBeNull()

    // The conversation was established — leadless, and neutral in every
    // current-state column. This is the F-3 correction: refusing here meant a
    // fresh onboarding imported nothing.
    const conv = await db('inbox_conversations').where({ agencyId, customerWaId: '15557770000' }).first()
    expect(conv).toBeTruthy()
    expect(conv.leadId).toBeNull()
    expect(conv.unreadCount).toBe(0)
    expect(conv.messageCount).toBe(0)
    expect(conv.lastMessageAt).toBeNull()
    expect(conv.lastDirection).toBeNull()
  })

  it('T14b: a delivery whose agency no longer owns its number is terminal, not retried', async () => {
    await db('whatsapp_history_imports').where({ agencyId }).update({ status: 'completed' })
    const v = chunkValue({ chunkOrder: 450 })
    const { id } = await recordHistoryDelivery({
      agencyId: otherAgencyId, // deliberately NOT the owner of PHONE_ID
      phoneNumberId: PHONE_ID,
      event: parse(v),
      rawValue: v,
    })
    const [job] = await claimHistoryImports('w-mismatch', 1, ALLOW_ALL)
    expect(job.id).toBe(id)

    const r = await processHistoryImport(job)
    expect(r.status).toBe('error')
    const row = await db('whatsapp_history_imports').where({ id }).first()
    expect(row.lastError).toBe('tenant_mismatch')
    // Nothing was created under the wrong tenant.
    expect(await db('inbox_conversations').where({ agencyId: otherAgencyId, customerWaId: CUSTOMER_A }).count()).toEqual([
      { count: '1' },
    ])
    await db('whatsapp_history_imports').where({ id }).del()
  })

  it('T13b: parser-level skips are counted, and one bad message never kills the chunk', async () => {
    await db('whatsapp_history_imports').where({ agencyId }).update({ status: 'completed' })
    const mixed = chunkValue({ chunkOrder: 404 })
    mixed.history[0].threads = [
      {
        id: CUSTOMER_A,
        messages: [
          { from: CUSTOMER_A, timestamp: '1739230955', type: 'text', text: { body: 'no wamid' } },
          { from: CUSTOMER_A, id: 'wamid.MIXED_OK_1', timestamp: '1739230999', type: 'text', text: { body: 'ok' } },
        ],
      },
    ]
    await record(mixed)
    const [job] = await claimHistoryImports('w4', 1, ALLOW_ALL)

    const r = await processHistoryImport(job)
    expect(r.messagesInserted).toBe(1)
    expect(r.messagesSkipped).toBe(1)
    expect(r.status).toBe('partial')
  })
})

describe('media follow-up and errors', () => {
  it('T17/T18: a media follow-up is DURABLE but deferred, and nothing is downloaded', async () => {
    await db('whatsapp_history_imports').where({ agencyId }).update({ status: 'completed' })
    const value = JSON.parse(JSON.stringify(HISTORY_MEDIA_FOLLOWUP_VALUE))
    value.metadata.phone_number_id = PHONE_ID
    value.messages[0].id = value.messages[0].id.replace('wamid.SYNTHETIC', 'wamid.HDSUITE')
    const { id } = await record(value)
    const [job] = await claimHistoryImports('w5', 1, ALLOW_ALL)

    const r = await processHistoryImport(job)
    expect(r.status).toBe('deferred')

    const row = await db('whatsapp_history_imports').where({ id }).first()
    expect(row.status).toBe('deferred')
    expect(row.kind).toBe('media_followup')
    expect(row.lastError).toBe('media_followup_deferred')
    // The raw payload survives as 2A.2e's source.
    expect(row.payload).toEqual(value)
    // Not merged into the original message: that wamid holds one row, unchanged.
    const original = await db('inbox_messages').where({ externalId: value.messages[0].id }).first()
    expect(original?.type).not.toBe('image')
  })

  it('T15/T16: 2593109 is an explicit durable error, never "completed"', async () => {
    await db('whatsapp_history_imports').where({ agencyId }).update({ status: 'completed' })
    const value = JSON.parse(JSON.stringify(HISTORY_ERROR_VALUE))
    value.metadata.phone_number_id = PHONE_ID
    const { id } = await record(value)
    const [job] = await claimHistoryImports('w6', 1, ALLOW_ALL)

    const r = await processHistoryImport(job)
    expect(r.status).toBe('error')

    const row = await db('whatsapp_history_imports').where({ id }).first()
    expect(row.status).toBe('error')
    expect(row.lastError).toBe('history_sync_disabled_by_business')
    expect(row.status).not.toBe('completed')
  })
})

describe('retry policy', () => {
  it('T28: retries are bounded and back off, then go terminal', async () => {
    await db('whatsapp_history_imports').where({ agencyId }).update({ status: 'completed' })
    const { id } = await record(chunkValue({ chunkOrder: 501 }))

    await claimHistoryImports('w7', 1, ALLOW_ALL)
    await failHistoryImport(id, 'transient')
    let row = await db('whatsapp_history_imports').where({ id }).first()
    expect(row.status).toBe('received')
    // Backed off, not immediately eligible again.
    expect(new Date(row.nextAttemptAt).getTime()).toBeGreaterThan(Date.now())

    // Burn the budget.
    await db('whatsapp_history_imports').where({ id }).update({ attempts: 5, maxAttempts: 5 })
    await failHistoryImport(id, 'transient')
    row = await db('whatsapp_history_imports').where({ id }).first()
    expect(row.status).toBe('failed')
    expect(row.completedAt).not.toBeNull()
  })
})

describe('tenant isolation', () => {
  it('T24/T25: the same customer under two agencies never crosses over', async () => {
    await db('whatsapp_history_imports').where({ agencyId: otherAgencyId }).del()
    const beforeOther = await db('inbox_messages').where({ conversationId: convOther }).count()

    // Agency B receives a delivery whose payload names agency A's phone id.
    // The tenant is resolved from phone_number_id, so this lands under A.
    const value = chunkValue({ chunkOrder: 601 })
    const res = await receiveHistoryWebhook(value)
    expect(res.outcome).toBe('recorded')
    const row = await db('whatsapp_history_imports').where({ id: (res as { importId: number }).importId }).first()
    expect(Number(row.agencyId)).toBe(agencyId)
    expect(Number(row.agencyId)).not.toBe(otherAgencyId)

    // And agency B's identical-customer conversation gained nothing.
    expect(await db('inbox_messages').where({ conversationId: convOther }).count()).toEqual(beforeOther)
  })

  it('T24b: an unknown phone_number_id is refused before anything durable is written', async () => {
    const value = JSON.parse(JSON.stringify(HISTORY_CHUNK_VALUE))
    value.metadata.phone_number_id = '__no_such_connection__'
    expect(await receiveHistoryWebhook(value)).toEqual({ outcome: 'unknown_tenant' })
    expect(await db('whatsapp_history_imports').where({ phoneNumberId: '__no_such_connection__' }).first()).toBeUndefined()
  })

  it('an unparseable value is refused, not recorded', async () => {
    expect(await receiveHistoryWebhook({ nonsense: true })).toEqual({ outcome: 'unparseable' })
  })
})

describe('completion semantics', () => {
  it('T30: we report what META claimed, never that we verified the archive', async () => {
    const s = await historyImportSummary(agencyId, PHONE_ID)
    expect(s).toHaveProperty('metaReportedComplete')
    // The honest claim is "Meta said progress 100", not "every chunk arrived".
    expect(s).not.toHaveProperty('complete')
    expect(s).not.toHaveProperty('archiveComplete')
    expect(Array.isArray(s.phasesSeen)).toBe(true)

    const src = readFileSync('db/whatsappHistoryImports.ts', 'utf8')
    expect(src).toContain('metaReportedComplete')
    // No rule anywhere turns progress into a completeness guarantee.
    expect(src).not.toMatch(/progress\s*===\s*100\s*\)\s*return true/)
  })
})

describe('scope and reachability', () => {
  const code = (p: string) =>
    readFileSync(p, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

  it('T19/T20/T21/T22: the worker imports nothing that acts on the business', () => {
    const src = code('lib/inbox/history/importWorker.ts') + code('lib/inbox/history/receiveHistory.ts')
    for (const forbidden of [
      'enqueueInboundAutoResponse',
      'notifyEvent',
      'emitAutomationEvent',
      'enqueueSignal',
      'investigation',
      'enqueueConversationAnalysis',
      'createLead',
      'findOrCreateConversation',
      'bumpConversationOn',
      'downloadMedia',
      'fetch(',
    ]) {
      expect(src).not.toContain(forbidden)
    }
  })

  it('T26/T27: the webhook is gated, and never imports synchronously', () => {
    const src = code('lib/whatsapp/coexistence.ts')
    expect(src).toContain('export const HISTORY_SYNC_ENABLED = false')
    expect(src).toContain('if (HISTORY_SYNC_ENABLED) {')
    // The gate strictly precedes the only call into the receive path.
    expect(src.indexOf('if (HISTORY_SYNC_ENABLED)')).toBeLessThan(src.indexOf('receiveHistoryWebhook(value)'))
    // The webhook path records; it never processes.
    expect(code('lib/inbox/history/receiveHistory.ts')).not.toContain('processHistoryImport')
    expect(code('lib/inbox/history/receiveHistory.ts')).not.toContain('runHistoryImportWorker')
  })

  it('T29: log lines carry ids and counts, never payload content', () => {
    const src = readFileSync('lib/inbox/history/importWorker.ts', 'utf8')
    // Extract each console.*(...) call by balancing parens, so only ARGUMENTS
    // are inspected — not type declarations that happen to share a word.
    const calls: string[] = []
    for (const m of src.matchAll(/console\.\w+\(/g)) {
      let depth = 0
      let i = m.index! + m[0].length - 1
      const start = i
      for (; i < src.length; i++) {
        if (src[i] === '(') depth++
        else if (src[i] === ')' && --depth === 0) break
      }
      calls.push(src.slice(start, i + 1))
    }
    expect(calls.length).toBeGreaterThan(3)
    for (const banned of ['.text', '.body', 'customerWaId', 'threadId', 'externalId', 'phoneNumberId', 'accessToken', 'payload']) {
      expect(calls.join('\n')).not.toContain(banned)
    }
  })

  it('the scheduled worker exists (Wave 2A.2f) and cannot bypass the allowlist', () => {
    // 2A.2d deliberately shipped without a schedule, and asserted its absence.
    // 2A.2f added one; the invariant that replaces "nothing runs" is "what runs
    // is authorized, bounded, and still deny-by-default".
    const route = code('app/api/cron/history-import/route.ts')
    expect(route).toContain('isAutomationAuthorized(req, secret)')
    expect(route).toContain('runHistoryImportWorker')
    // The route never widens the gate: it passes no allowlist of its own.
    expect(route).not.toContain('allowPhoneNumberIds')
    expect(route).not.toContain('HISTORY_SYNC_ENABLED')
    // The worker resolves the allowlist itself, and an empty one claims nothing.
    expect(code('lib/inbox/history/importWorker.ts')).toContain('historyAllowlist()')
  })
})
