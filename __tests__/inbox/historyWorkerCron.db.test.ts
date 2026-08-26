import { readFileSync } from 'node:fs'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { db } from '@/config/db'
import { claimHistoryImports, recordHistoryDelivery } from '@/db/whatsappHistoryImports'
import { runHistoryImportWorker } from '@/lib/inbox/history/importWorker'
import { parseHistoryValue } from '@/lib/whatsapp/parseHistory'
import type { ParsedHistoryEvent } from '@/lib/whatsapp/historyEvent'
import { HISTORY_CHUNK_VALUE, CUSTOMER_A, CUSTOMER_B } from '../whatsapp/fixtures/historyPayloads'

/**
 * Wave 2A.2f — the production worker entrypoint.
 *
 * 2A.2e's blocker was that nothing ever invoked the importer. These tests cover
 * the entrypoint itself: that it is bounded, authorized, allowlist-respecting,
 * and safe under concurrency — and that turning the allowlist on does NOT
 * require the webhook to fire again.
 */

/** Source with comments stripped — a doc comment mentioning a name is not a use. */
const codeOf = (p: string) =>
  readFileSync(p, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

const PHONE_ID = '__wk_pn_1'
const OTHER_PHONE_ID = '__wk_pn_2'
const ENV_KEY = 'WHATSAPP_HISTORY_PHONE_ALLOWLIST'

let agencyId: number
let convA: number
let convB: number

function value(chunkOrder: number, phoneNumberId = PHONE_ID) {
  const v = JSON.parse(JSON.stringify(HISTORY_CHUNK_VALUE))
  v.metadata.phone_number_id = phoneNumberId
  v.history[0].metadata.chunk_order = chunkOrder
  for (const t of v.history[0].threads) {
    for (const m of t.messages) m.id = m.id.replace('wamid.SYNTHETIC', `wamid.WK${chunkOrder}`)
  }
  return v
}

async function record(v: unknown, phoneNumberId = PHONE_ID) {
  return recordHistoryDelivery({
    agencyId,
    phoneNumberId,
    event: parseHistoryValue(v) as ParsedHistoryEvent,
    rawValue: v,
  })
}

beforeAll(async () => {
  const [a] = await db('agencies').insert({ name: '__test_wk__' }).returning('id')
  agencyId = Number(a.id)
  const [u] = await db('users').insert({ firstName: 'W', role: 'AGNT', agencyId }).returning('id')
  await db('whatsapp_connections').insert([
    { user_id: u.id, agency_id: agencyId, phone_number_id: PHONE_ID, access_token: 'x' },
    { user_id: u.id, agency_id: agencyId, phone_number_id: OTHER_PHONE_ID, access_token: 'x' },
  ])
  const [c1] = await db('inbox_conversations')
    .insert({ agencyId, leadId: null, businessPhoneNumberId: PHONE_ID, customerWaId: CUSTOMER_A, unreadCount: 1 })
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
  await db('whatsapp_connections').whereIn('phone_number_id', [PHONE_ID, OTHER_PHONE_ID]).del()
  await db('users').where({ agencyId }).del()
  await db('agencies').where({ id: agencyId }).del()
  await db.destroy()
})

describe('allowlist gating at the worker', () => {
  it('empty allowlist: no processing, and no claim query is even issued', async () => {
    await record(value(7001))
    delete process.env[ENV_KEY]

    const s = await runHistoryImportWorker('w-empty')
    expect(s).toMatchObject({ claimed: 0, reclaimed: 0, completed: 0 })

    const row = await db('whatsapp_history_imports').where({ agencyId, importKey: 'chunk:0:7001' }).first()
    // Durable and untouched — never dropped for not being activated.
    expect(row.status).toBe('received')
    expect(row.attempts).toBe(0)
  })

  it('wrong phone_number_id allowlisted: still no processing', async () => {
    process.env[ENV_KEY] = '__some_other_number'
    const s = await runHistoryImportWorker('w-wrong')
    expect(s.claimed).toBe(0)
    const row = await db('whatsapp_history_imports').where({ agencyId, importKey: 'chunk:0:7001' }).first()
    expect(row.status).toBe('received')
  })

  it('the SAME delivery becomes claimable once allowlisted — no new webhook needed', async () => {
    const before = await db('whatsapp_history_imports').where({ agencyId, importKey: 'chunk:0:7001' }).first()
    process.env[ENV_KEY] = PHONE_ID

    const s = await runHistoryImportWorker('w-allowed')
    expect(s.claimed).toBe(1)
    expect(s.completed).toBe(1)

    const after = await db('whatsapp_history_imports').where({ agencyId, importKey: 'chunk:0:7001' }).first()
    // The payload and identity were never mutated while it waited.
    expect(after.payload).toEqual(before.payload)
    expect(after.importKey).toBe(before.importKey)
    expect(after.status).toBe('completed')
  })

  it('one number activated does not activate a sibling number on the same agency', async () => {
    await record(value(7002, OTHER_PHONE_ID), OTHER_PHONE_ID)
    process.env[ENV_KEY] = PHONE_ID

    const s = await runHistoryImportWorker('w-sibling')
    expect(s.claimed).toBe(0)
    const row = await db('whatsapp_history_imports').where({ agencyId, importKey: 'chunk:0:7002' }).first()
    expect(row.status).toBe('received')
  })

  it('HISTORY_SYNC_ENABLED is a separate key and the worker cannot influence it', () => {
    const coex = readFileSync('lib/whatsapp/coexistence.ts', 'utf8')
    expect(coex).toContain('export const HISTORY_SYNC_ENABLED = false')
    // Requesting an archive needs BOTH; processing needs the allowlist only.
    expect(coex).toContain('if (!HISTORY_SYNC_ENABLED || !isHistoryEnabledForPhoneNumber(phoneNumberId))')
    // Stripped: the route's header explains that it cannot influence the
    // constant, which is a mention, not a use.
    const route = codeOf('app/api/cron/history-import/route.ts')
    expect(route).not.toContain('HISTORY_SYNC_ENABLED')
    expect(route).not.toContain('syncSmbAppData')
  })
})

describe('bounded execution', () => {
  it('never claims more than the per-invocation limit', async () => {
    await db('whatsapp_history_imports').where({ agencyId }).update({ status: 'completed' })
    process.env[ENV_KEY] = PHONE_ID
    for (let i = 0; i < 6; i++) await record(value(7100 + i))

    const s = await runHistoryImportWorker('w-limit', { limit: 2, batchSize: 5 })
    expect(s.claimed).toBe(2)
    expect(await db('whatsapp_history_imports').where({ agencyId, status: 'received' }).count()).toEqual([{ count: '4' }])
  })

  it('stops on the time budget and reports it, leaving the rest for the next run', async () => {
    process.env[ENV_KEY] = PHONE_ID
    let t = 1_000_000
    const s = await runHistoryImportWorker('w-budget', {
      limit: 50,
      batchSize: 1,
      budgetMs: 10,
      now: () => (t += 8), // two ticks and the budget is spent
    })
    expect(s.budgetExhausted).toBe(true)
    expect(s.claimed).toBeLessThan(50)
    expect(s.durationMs).toBeGreaterThan(0)
    // Nothing is lost: the remainder is still claimable.
    expect(Number((await db('whatsapp_history_imports').where({ agencyId, status: 'received' }).count())[0].count)).toBeGreaterThan(0)
  })

  it('a run with nothing to do is a cheap no-op', async () => {
    await db('whatsapp_history_imports').where({ agencyId }).update({ status: 'completed' })
    process.env[ENV_KEY] = PHONE_ID
    expect(await runHistoryImportWorker('w-idle')).toMatchObject({ claimed: 0, completed: 0, budgetExhausted: false })
  })

  it('has no unbounded loop in the source', () => {
    const src = readFileSync('lib/inbox/history/importWorker.ts', 'utf8')
    expect(src).not.toMatch(/while\s*\(\s*true\s*\)/)
    expect(src).toContain('while (summary.claimed < limit)')
    expect(src).toContain('budgetExhausted = true')
  })
})

describe('concurrency', () => {
  it('two concurrent workers: exactly one claims, attempts == 1', async () => {
    await db('whatsapp_history_imports').where({ agencyId }).update({ status: 'completed' })
    process.env[ENV_KEY] = PHONE_ID
    const { id } = await record(value(7200))

    const [a, b] = await Promise.all([
      db.transaction((t) => claimHistoryImports('cc-a', 5, { allowPhoneNumberIds: PHONE_ID.split(',') }, t)),
      db.transaction((t) => claimHistoryImports('cc-b', 5, { allowPhoneNumberIds: PHONE_ID.split(',') }, t)),
    ])
    expect([...a, ...b].filter((j) => j.id === id)).toHaveLength(1)

    const row = await db('whatsapp_history_imports').where({ id }).first()
    expect(row.attempts).toBe(1)
    expect(row.status).toBe('processing')
  })

  it('a stale lease is reclaimed by the next run, attempts == 2, no refund', async () => {
    process.env[ENV_KEY] = PHONE_ID
    const row0 = await db('whatsapp_history_imports').where({ agencyId, importKey: 'chunk:0:7200' }).first()
    expect(row0.attempts).toBe(1)

    // The lease expires; the next tick reclaims and processes it.
    const s = await runHistoryImportWorker('w-reclaim', { leaseMs: 0 })
    expect(s.reclaimed).toBeGreaterThan(0)
    expect(s.claimed).toBe(1)
    expect(s.retried).toBe(1)

    const row = await db('whatsapp_history_imports').where({ id: row0.id }).first()
    // The first, dead attempt was NOT given back.
    expect(row.attempts).toBe(2)
    expect(['completed', 'partial']).toContain(row.status)
  })
})

describe('cron route', () => {
  const ROUTE = 'app/api/cron/history-import/route.ts'
  const load = () => import('@/app/api/cron/history-import/route')
  const request = (headers: Record<string, string> = {}) =>
    new Request('https://getsocialcrm.com/api/cron/history-import', { method: 'POST', headers }) as never

  it('rejects an unauthenticated request', async () => {
    process.env.AUTOMATION_API_KEY = 'cron-test-secret'
    const { POST } = await load()
    expect((await POST(request())).status).toBe(403)
    expect((await POST(request({ authorization: 'Bearer wrong' }))).status).toBe(403)
  })

  it('accepts a valid internal invocation and returns counts only', async () => {
    process.env.AUTOMATION_API_KEY = 'cron-test-secret'
    process.env[ENV_KEY] = PHONE_ID
    const { POST } = await load()
    const res = await POST(request({ authorization: 'Bearer cron-test-secret' }))
    expect(res.status).toBe(200)

    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(body).toHaveProperty('claimed')
    expect(body).toHaveProperty('completed')
    expect(body).toHaveProperty('partial')
    expect(body).toHaveProperty('deferred')
    expect(body).toHaveProperty('failed')
    expect(body).toHaveProperty('retried')
    expect(body.activation).toEqual({ mode: 'allowlist', count: 1 })

    // No customer content crosses the network boundary.
    const json = JSON.stringify(body)
    for (const banned of ['wamid', CUSTOMER_A, CUSTOMER_B, PHONE_ID, 'Synthetic', 'threadId', 'payload']) {
      expect(json).not.toContain(banned)
    }
  })

  it('refuses to run when the secret is not configured', async () => {
    delete process.env.AUTOMATION_API_KEY
    delete process.env.CRON_SECRET
    const { POST } = await load()
    expect((await POST(request({ authorization: 'Bearer anything' }))).status).toBe(500)
    process.env.AUTOMATION_API_KEY = 'cron-test-secret'
  })

  it('uses the shared cron auth helper — no new auth mechanism', () => {
    const src = codeOf(ROUTE)
    expect(src).toContain("from '@/lib/automation/apiAuth'")
    expect(src).toContain('isAutomationAuthorized(req, secret)')
    expect(src).toContain('export const maxDuration = 60')
    // No hand-rolled auth. (The header says "no session"; that is prose.)
    expect(src).not.toMatch(/createHmac|jwt|session|getUser/)
  })

  it('is registered on a bounded schedule', () => {
    const crons = JSON.parse(readFileSync('vercel.json', 'utf8')).crons
    const entry = crons.find((c: { path: string }) => c.path === '/api/cron/history-import')
    expect(entry).toBeTruthy()
    expect(entry.schedule).toBe('*/5 * * * *')
  })

  it('logs and responses carry no customer content', () => {
    const src = readFileSync(ROUTE, 'utf8') + readFileSync('lib/inbox/history/importWorker.ts', 'utf8')
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
    for (const banned of ['.text', '.body', '.customerWaId', '.threadId', '.externalId', '.phoneNumberId', '.accessToken', '.payload']) {
      expect(calls.join('\n')).not.toContain(banned)
    }
  })
})
