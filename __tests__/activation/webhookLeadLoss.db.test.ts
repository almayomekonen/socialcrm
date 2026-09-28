/**
 * The 18 lost Meta leads — verified against the REAL constraints.
 *
 * `webhookLeadLoss.test.ts` mocks `@/config/db` and asserts the SHAPE of the
 * dedup queries (agency-scoped, source-agnostic, email included). That proves
 * the code asks the right questions, but not that those questions correspond to
 * the indexes Postgres actually enforces — and the whole failure mode was a
 * mismatch between the two:
 *
 *   clients_agency_phone_unique  UNIQUE ("agencyId", phone) WHERE phone IS NOT NULL
 *   clients_agency_email_unique  UNIQUE ("agencyId", email) WHERE email IS NOT NULL
 *
 * Dedup was un-scoped by agency, filtered to `facebook:%`/`instagram:%`, and
 * never looked at email — so an existing WhatsApp/manual/imported lead was
 * invisible to dedup but still fatal to the insert. The insert raised 23505,
 * `insertLeadSystem` swallowed it, and the lead was destroyed.
 *
 * These tests drive the real function against the real schema. Only Next.js
 * infrastructure and the side-effect emitters are mocked; `@/config/db` is NOT.
 *
 * DB-backed: run serialized (`--no-file-parallelism`). No network, no Meta
 * traffic, no production data — fixtures are created and removed here.
 */

import { vi } from 'vitest'

vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }))
vi.mock('next/server', () => ({ after: (fn: () => unknown) => fn() }))
vi.mock('@/lib/system/createSystemTask', () => ({ createSystemTask: vi.fn() }))
vi.mock('@/lib/quota', () => ({
  getQuotaStatus: vi.fn(async () => ({ plan: 'pro', limit: null, used: 0, overQuotaCount: 0 })),
}))
vi.mock('@/lib/analytics/track', () => ({ trackFirstRealLeadOnce: vi.fn(), track: vi.fn(), trackOncePerAgency: vi.fn() }))
vi.mock('@/lib/automations/emit', () => ({ emitAutomationEvent: vi.fn() }))
vi.mock('@/lib/notifications/emitLeadCreated', () => ({ emitLeadCreated: vi.fn() }))
vi.mock('@/db/leadAttribution', () => ({ recordLeadAttribution: vi.fn() }))

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { db } from '@/config/db'
import { createLeadFromWebhook } from '@/lib/system/createClientFromWebhook'
import { parseFacebookLead } from '@/lib/adapters/facebookLead'

let agencyA = 0
let agencyB = 0
let userA = 0
let userB = 0
let seq = 0

/** A fresh Meta leadgen id per call, so leadId dedup never masks the case under test. */
const nextLeadId = () => `99${Date.now()}${seq++}`

async function mkAgency(name: string) {
  const [a] = await db('agencies').insert({ name }).returning('id')
  const agencyId = Number(a.id ?? a)
  const [u] = await db('users')
    .insert({ firstName: 'WH', lastName: 'Test', email: `wh-${agencyId}-${Date.now()}@example.test`, agencyId, role: 'ADMIN' })
    .returning('id')
  return { agencyId, userId: Number(u.id ?? u) }
}

beforeAll(async () => {
  const a = await mkAgency('WH Test A')
  const b = await mkAgency('WH Test B')
  agencyA = a.agencyId
  userA = a.userId
  agencyB = b.agencyId
  userB = b.userId
})

afterAll(async () => {
  for (const id of [agencyA, agencyB]) {
    await db('lead_attribution').whereIn('clientId', db('clients').select('id').where({ agencyId: id })).del().catch(() => {})
    await db('clients').where({ agencyId: id }).del()
    await db('users').where({ agencyId: id }).del()
    await db('agencies').where({ id: id }).del()
  }
  await db.destroy()
})

beforeEach(async () => {
  await db('clients').whereIn('agencyId', [agencyA, agencyB]).del()
})

describe('webhook dedup against the real unique indexes', () => {
  it('PHONE: an existing MANUAL lead is found, not destroyed by a unique violation', async () => {
    // The exact pre-fix blind spot: same phone, a source the old filter ignored.
    const phone = '972521110001'
    const [existing] = await db('clients')
      .insert({
        firstName: 'קיים', lastName: 'ידני', phone,
        agencyId: agencyA, userId: userA, handlerId: userA, createdById: userA,
        lead: true, status: 'new', createOrigin: 'manual',
      })
      .returning('*')

    let insertError: string | null = null
    const res = await createLeadFromWebhook({
      firstName: 'מטא', lastName: 'ליד', phone: '0521110001', email: null,
      leadId: nextLeadId(), agencyId: agencyA, userId: userA,
      onInsertError: (d) => { insertError = d },
    })

    expect(insertError, 'the insert must never be attempted, so no error').toBeNull()
    expect(res, 'the lead must be recovered, not lost').toBeTruthy()
    expect(Number(res.id)).toBe(Number(existing.id))
    const [{ count }] = await db('clients').where({ agencyId: agencyA }).count({ count: '*' })
    expect(Number(count), 'no duplicate row').toBe(1)
  })

  it('EMAIL: the check that did not exist — an email collision is deduped, not dropped', async () => {
    const email = 'collide@example.test'
    const [existing] = await db('clients')
      .insert({
        firstName: 'קיים', lastName: 'מייל', email,
        agencyId: agencyA, userId: userA, handlerId: userA, createdById: userA,
        lead: true, status: 'new', createOrigin: 'import',
      })
      .returning('*')

    let insertError: string | null = null
    const res = await createLeadFromWebhook({
      firstName: 'מטא', lastName: 'ליד', phone: null, email,
      leadId: nextLeadId(), agencyId: agencyA, userId: userA,
      onInsertError: (d) => { insertError = d },
    })

    expect(insertError).toBeNull()
    expect(res).toBeTruthy()
    expect(Number(res.id)).toBe(Number(existing.id))
    const [{ count }] = await db('clients').where({ agencyId: agencyA }).count({ count: '*' })
    expect(Number(count)).toBe(1)
  })

  it('TENANCY: the same phone in ANOTHER agency does NOT dedup — a real lead is created', async () => {
    // The other half of the bug: an un-scoped match used to swallow this lead
    // and hand back a different tenant's row.
    const phone = '972521110002'
    await db('clients').insert({
      firstName: 'אחר', lastName: 'טננט', phone,
      agencyId: agencyB, userId: userB, handlerId: userB, createdById: userB,
      lead: true, status: 'new', createOrigin: 'manual',
    })

    let insertError: string | null = null
    const res = await createLeadFromWebhook({
      firstName: 'מטא', lastName: 'ליד', phone: '0521110002', email: null,
      leadId: nextLeadId(), agencyId: agencyA, userId: userA,
      onInsertError: (d) => { insertError = d },
    })

    expect(insertError).toBeNull()
    expect(res).toBeTruthy()
    expect(Number(res.agencyId), 'never another tenant’s row').toBe(agencyA)
    const [{ count }] = await db('clients').where({ agencyId: agencyA }).count({ count: '*' })
    expect(Number(count), 'a genuinely new lead').toBe(1)
  })

  // Production 2026-07-31 → 09-27: 29 Lead Ads leads dead in webhook_failures
  // (22 of them agency 108), 11 with "sqlstate=23502 column=lastName". A one-word
  // name gave lastName null and `clients.lastName` is NOT NULL, so the lead was
  // never saved. Driven through the parser and the insert, as the webhook does.
  it('a ONE-WORD name is saved, not lost to the NOT NULL lastName column', async () => {
    const parsed = parseFacebookLead([
      { name: 'full_name', values: ['נועה'] },
      { name: 'phone_number', values: ['0521112233'] },
    ])
    const res = await createLeadFromWebhook({ ...parsed, leadId: nextLeadId(), agencyId: agencyA, userId: userA })
    expect(res).toBeTruthy()
    expect(res.firstName).toBe('נועה')
    expect(res.lastName).toBe('')
  })

  it('a form with first_name / last_name fields keeps both names', async () => {
    const parsed = parseFacebookLead([
      { name: 'first_name', values: ['דנה'] },
      { name: 'last_name', values: ['לוי'] },
      { name: 'email', values: ['dana@example.test'] },
    ])
    const res = await createLeadFromWebhook({ ...parsed, leadId: nextLeadId(), agencyId: agencyA, userId: userA })
    expect(res).toBeTruthy()
    expect([res.firstName, res.lastName]).toEqual(['דנה', 'לוי'])
  })

  it('a clean lead still inserts, so dedup has not become over-eager', async () => {
    const res = await createLeadFromWebhook({
      firstName: 'חדש', lastName: 'לגמרי', phone: '0521119999', email: 'fresh@example.test',
      leadId: nextLeadId(), agencyId: agencyA, userId: userA,
    })
    expect(res).toBeTruthy()
    expect(res.phone).toBe('972521119999')
    const [{ count }] = await db('clients').where({ agencyId: agencyA }).count({ count: '*' })
    expect(Number(count)).toBe(1)
  })
})
