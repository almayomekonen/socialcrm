import { vi } from 'vitest'

// ─── Hoisted fake cache state (must exist before vi.mock factories run) ─────
const fake = vi.hoisted(() => {
  const store = new Map<string, unknown>()
  const tagsByKey = new Map<string, string[]>()
  return {
    store,
    tagsByKey,
    reset: () => {
      store.clear()
      tagsByKey.clear()
    },
  }
})

// ─── next/* mocks (mirroring lead-isolation.test.ts patterns) ────────────────
vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
  cacheTag: vi.fn(),
  revalidateTag: vi.fn((tag: string, _profile?: string) => {
    for (const [k, tags] of fake.tagsByKey.entries()) {
      if (tags.includes(tag)) {
        fake.store.delete(k)
        fake.tagsByKey.delete(k)
      }
    }
  }),

  unstable_cache: (fn: any, keyParts: string[], opts?: { tags?: string[] }) => {
    const base = keyParts.join('|')
    return async (...args: any[]) => {
      const key = base + '::' + JSON.stringify(args)
      if (fake.store.has(key)) return fake.store.get(key)
      const result = await fn(...args)
      fake.store.set(key, result)
      fake.tagsByKey.set(key, opts?.tags ?? [])
      return result
    }
  },
}))

vi.mock('next/navigation', () => ({ redirect: vi.fn(), notFound: vi.fn() }))
vi.mock('next/headers', () => ({
  cookies: vi.fn(() => ({ get: vi.fn(() => null), set: vi.fn(), delete: vi.fn() })),
  headers: vi.fn(() => ({ get: vi.fn(() => null) })),
}))

// Auth: swap "current user" per test
vi.mock('@/lib/requireUser', () => { const __ru = vi.fn(); return { requireUser: __ru, requireProductAccess: __ru } })
vi.mock('@/db/auth', () => ({
  getUser: vi.fn(),
  getCachedUser: vi.fn(),
  createCookie: vi.fn(),
  getUserByEmail: vi.fn(),
  decrypt: vi.fn(),
  encrypt: vi.fn(),
}))

// AI router: control returns & count invocations
vi.mock('@/lib/ai/router', () => ({ runStructured: vi.fn() }))

// ─── Imports (after mocks) ──────────────────────────────────────────────────
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest'
import { requireUser } from '@/lib/requireUser'
import { getUser } from '@/db/auth'
import { runStructured } from '@/lib/ai/router'
import { db } from '@/config/db'
import { getLeadIntelligence, leadIntelTag } from '@/actions/ai/leadIntelligence'
import { revalidateTag } from 'next/cache'

// ─── Helpers ─────────────────────────────────────────────────────────────────
async function syncSequence(seqName: string, table: string, idCol = 'id') {
  await db.raw(`SELECT setval(?, (SELECT COALESCE(MAX(??) + 1, 1) FROM ??), false)`, [seqName, db.raw(`"${idCol}"`), table])
}

type TestUser = {
  id: number
  agencyId: number
  role: string
  suspended: boolean
  name: string | null
  email: string | null
  picture: string | null
}

function setCurrentUser(user: TestUser) {
  vi.mocked(requireUser).mockResolvedValue(user as any)
  vi.mocked(getUser).mockResolvedValue(user as any)
}

function okSummary() {
  return {
    ok: true as const,
    data: {
      summary: 'ליד פעיל. הקשר עוד לא הותנע.',
      keyInsights: [],
      suggestedNextAction: { title: 'פתיחת שיחת מעקב', reason: 'אין תיעוד קשר.' },
      sources: ['סטטוס הליד'] as const,
      confidence: 'medium' as const,
    },
    provider: 'anthropic' as const,
    model: 'claude-sonnet-test',
    inputTokens: 100,
    outputTokens: 50,
    costUsd: 0.001,
    latencyMs: 50,
  }
}

const TEST_AGENCY_A = '__test_agency_AI_A__'
const TEST_AGENCY_B = '__test_agency_AI_B__'

let agencyA: number
let agencyB: number
let userA: TestUser
let userB: TestUser
let leadAId: number
let leadA2Id: number

async function purgeTestAgencies(ids: number[]) {
  if (!ids.length) return
  await db('clients').whereIn('agencyId', ids).delete()
  await db('users').whereIn('agencyId', ids).delete()
  await db('agencies').whereIn('id', ids).delete()
}

// ─── Suite ───────────────────────────────────────────────────────────────────
// This file is an integration suite (real DB writes via knex). The unit-only
// runner sets VITEST_NO_DB=1, which short-circuits the global schema setup
// in __tests__/setup.ts; without the schema, the per-file beforeAll seeding
// here can't run. Skip the whole describe in that mode.
describe.skipIf(process.env.VITEST_NO_DB === '1')('Lead intelligence — cache & tenant isolation', () => {
  beforeAll(async () => {
    await syncSequence('agencies_id_seq', 'agencies')
    await syncSequence('users_seq', 'users')
    await syncSequence('"Client_id_seq"', 'clients')

    const stale = await db('agencies').whereIn('name', [TEST_AGENCY_A, TEST_AGENCY_B]).select('id')
    await purgeTestAgencies(stale.map((a: { id: number }) => a.id))

    const [a] = await db('agencies').insert({ name: TEST_AGENCY_A }).returning('id')
    const [b] = await db('agencies').insert({ name: TEST_AGENCY_B }).returning('id')
    agencyA = a.id
    agencyB = b.id

    const [uA] = await db('users')
      .insert({ firstName: '__test__', lastName: 'AIuserA', role: 'ADMIN', agencyId: agencyA })
      .returning('*')
    const [uB] = await db('users')
      .insert({ firstName: '__test__', lastName: 'AIuserB', role: 'ADMIN', agencyId: agencyB })
      .returning('*')
    userA = uA
    userB = uB
  })

  afterAll(async () => {
    try {
      await purgeTestAgencies([agencyA, agencyB].filter((id) => id != null))
    } finally {
      await db.destroy()
    }
  })

  beforeEach(async () => {
    fake.reset()
    vi.mocked(runStructured).mockReset()

    const [l1] = await db('clients')
      .insert({
        firstName: '__test__',
        lastName: 'LeadAI1',
        agencyId: agencyA,
        userId: userA.id,
        createdById: userA.id,
        lead: true,
        status: 'בטיפול',
        statusChangedAt: new Date('2025-01-01'),
        lastActivityAt: new Date('2025-04-01'),
      })
      .returning('id')
    const [l2] = await db('clients')
      .insert({
        firstName: '__test__',
        lastName: 'LeadAI2',
        agencyId: agencyA,
        userId: userA.id,
        createdById: userA.id,
        lead: true,
        status: 'חדש',
      })
      .returning('id')
    leadAId = l1.id
    leadA2Id = l2.id
  })

  afterEach(async () => {
    await db('clients').whereIn('agencyId', [agencyA, agencyB]).delete()
    vi.clearAllMocks()
    fake.reset()
  })

  // ── 1. Cross-agency block — invalid-input without calling AI ──────────────
  it('blocks cross-agency: returns invalid-input and never calls the AI router', async () => {
    setCurrentUser(userB)
    vi.mocked(runStructured).mockResolvedValue(okSummary())

    const res = await getLeadIntelligence(leadAId)

    expect(res).toEqual({ ok: false, reason: 'invalid-input' })
    expect(runStructured).not.toHaveBeenCalled()
  })

  it('blocks invalid leadId (zero, negative, NaN) before any DB or AI call', async () => {
    setCurrentUser(userA)
    vi.mocked(runStructured).mockResolvedValue(okSummary())

    expect(await getLeadIntelligence(0)).toEqual({ ok: false, reason: 'invalid-input' })
    expect(await getLeadIntelligence(-1)).toEqual({ ok: false, reason: 'invalid-input' })
    expect(await getLeadIntelligence('not-a-number')).toEqual({ ok: false, reason: 'invalid-input' })

    expect(runStructured).not.toHaveBeenCalled()
  })

  // ── 2. Cache hit — second call uses cache, no second AI call ──────────────
  it('caches successful results: second identical call does not re-invoke AI', async () => {
    setCurrentUser(userA)
    vi.mocked(runStructured).mockResolvedValue(okSummary())

    const r1 = await getLeadIntelligence(leadAId)
    const r2 = await getLeadIntelligence(leadAId)

    expect(r1.ok).toBe(true)
    expect(r2.ok).toBe(true)
    if (r1.ok && r2.ok) expect(r2.data).toEqual(r1.data)
    expect(runStructured).toHaveBeenCalledTimes(1)
  })

  // ── 3. No poisoning on failure — failures are NOT cached ──────────────────
  it('does not cache provider failures: next call re-attempts the AI router', async () => {
    setCurrentUser(userA)
    vi.mocked(runStructured).mockResolvedValue({
      ok: false,
      reason: 'all-providers-failed',
      message: 'simulated outage',
    })

    const r1 = await getLeadIntelligence(leadAId)
    expect(r1).toEqual(expect.objectContaining({ ok: false, reason: 'all-providers-failed' }))

    // Now provider recovers — second call MUST re-run, not return the stale failure.
    vi.mocked(runStructured).mockResolvedValueOnce(okSummary())
    const r2 = await getLeadIntelligence(leadAId)

    expect(r2.ok).toBe(true)
    expect(runStructured).toHaveBeenCalledTimes(2)
  })

  it.each([['disabled' as const], ['forbidden' as const], ['no-providers' as const], ['over-quota' as const]])(
    'does not cache reason="%s" failures',
    async (reason) => {
      setCurrentUser(userA)
      vi.mocked(runStructured).mockResolvedValue({ ok: false, reason })

      await getLeadIntelligence(leadAId)
      await getLeadIntelligence(leadAId)

      // Both calls must hit the router — no failure ever poisons the cache.
      expect(runStructured).toHaveBeenCalledTimes(2)
    },
  )

  // ── 4. Per-lead independence ──────────────────────────────────────────────
  it('uses isolated cache entries per leadId', async () => {
    setCurrentUser(userA)
    vi.mocked(runStructured).mockResolvedValue(okSummary())

    await getLeadIntelligence(leadAId)
    await getLeadIntelligence(leadA2Id)
    // Two distinct leads → two distinct cache keys → two AI calls.
    expect(runStructured).toHaveBeenCalledTimes(2)

    // Re-fetching either lead now hits its own warm cache.
    await getLeadIntelligence(leadAId)
    await getLeadIntelligence(leadA2Id)
    expect(runStructured).toHaveBeenCalledTimes(2)
  })

  // ── 5. Input-driven invalidation ──────────────────────────────────────────
  it('re-runs the AI when input signals change (lead activity updated)', async () => {
    setCurrentUser(userA)
    vi.mocked(runStructured).mockResolvedValue(okSummary())

    await getLeadIntelligence(leadAId)
    expect(runStructured).toHaveBeenCalledTimes(1)

    // Mutate a behavioural signal: a fresher interaction shifts
    // daysSinceLastInteraction → args change → cache key changes → re-run.
    await db('clients').where({ id: leadAId }).update({ lastActivityAt: new Date(), updatedAt: new Date() })

    await getLeadIntelligence(leadAId)
    expect(runStructured).toHaveBeenCalledTimes(2)
  })

  // ── 6. Tag-based invalidation (powers the "refresh insights" button) ──────
  it('revalidateTag(leadIntelTag(leadId)) clears that lead — and only that lead', async () => {
    setCurrentUser(userA)
    vi.mocked(runStructured).mockResolvedValue(okSummary())

    // Warm both caches.
    await getLeadIntelligence(leadAId)
    await getLeadIntelligence(leadA2Id)
    expect(runStructured).toHaveBeenCalledTimes(2)

    // Invalidate ONLY leadAId.
    revalidateTag(leadIntelTag(leadAId), 'default')

    // leadAId re-runs.
    await getLeadIntelligence(leadAId)
    expect(runStructured).toHaveBeenCalledTimes(3)

    // leadA2Id stays warm.
    await getLeadIntelligence(leadA2Id)
    expect(runStructured).toHaveBeenCalledTimes(3)
  })

  // ── 7. The action surfaces the sanitized output, not the raw AI output ───
  it('returns sanitized data: pollution in AI output is scrubbed before reaching the caller', async () => {
    setCurrentUser(userA)
    vi.mocked(runStructured).mockResolvedValue({
      ok: true,
      data: {
        summary: 'הליד מאותת. pipelineStagnation=stale.',
        keyInsights: ['hasHandler=true'],
        suggestedNextAction: { title: 'פנייה', reason: 'inactivityRisk=high' },
        sources: ['סטטוס הליד'],
        confidence: 'high',
      },
      provider: 'anthropic',
      model: 'claude-sonnet-test',
      inputTokens: 100,
      outputTokens: 50,
      costUsd: 0.001,
      latencyMs: 50,
    })

    const res = await getLeadIntelligence(leadAId)
    expect(res.ok).toBe(true)
    if (!res.ok) return

    // Sanitizer must drop confidence to 'low' on any pollution
    expect(res.data.confidence).toBe('low')
    // Polluted free-text must be replaced with the placeholder
    expect(res.data.summary).not.toMatch(/pipelineStagnation/)
    expect(res.data.suggestedNextAction.reason).not.toMatch(/inactivityRisk/)
    // Polluted insight must be filtered out (not surfaced to the caller)
    expect(res.data.keyInsights.every((i) => !/hasHandler/.test(i))).toBe(true)
  })
})
