import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The 18 production leads that `createLeadFromWebhook` destroyed.
 *
 * Root cause: the dedup predicates did not match the unique indexes the insert
 * is judged against —
 *   clients_agency_phone_unique  UNIQUE ("agencyId", phone) WHERE phone IS NOT NULL
 *   clients_agency_email_unique  UNIQUE ("agencyId", email) WHERE email IS NOT NULL
 * Dedup was un-scoped by agency (too broad, cross-tenant) AND filtered to
 * `facebook:%`/`instagram:%` (too narrow), and email was never checked at all.
 * A colliding row was therefore invisible to dedup but fatal to the insert;
 * insertLeadSystem swallowed the violation and returned null, and the lead was
 * gone with `error_detail` empty — deterministically, so every retry re-failed.
 *
 * These tests pin all four properties that failure needed.
 */

const insertLeadSystem = vi.hoisted(() => vi.fn())
const first = vi.hoisted(() => vi.fn())
/** Every query built against `clients`, in order, for scope assertions. */
const queries = vi.hoisted(() => [] as { wheres: unknown[]; whereIns: unknown[][] }[])

vi.mock('@/lib/system/insertLeadSystem', () => ({ insertLeadSystem }))
vi.mock('@/lib/system/createSystemTask', () => ({ createSystemTask: vi.fn() }))
vi.mock('@/lib/quota', () => ({
  getQuotaStatus: vi.fn(async () => ({ plan: 'pro', limit: null, used: 0 })),
}))
vi.mock('@/lib/analytics/track', () => ({ trackFirstRealLeadOnce: vi.fn() }))
vi.mock('@/lib/automations/emit', () => ({ emitAutomationEvent: vi.fn() }))
vi.mock('@/lib/notifications/emitLeadCreated', () => ({ emitLeadCreated: vi.fn() }))
vi.mock('@/db/leadAttribution', () => ({ recordLeadAttribution: vi.fn() }))
vi.mock('@/config/db', () => ({
  db: (table: string) => {
    if (table !== 'clients') throw new Error(`unexpected table ${table}`)
    const q: { wheres: unknown[]; whereIns: unknown[][] } = { wheres: [], whereIns: [] }
    queries.push(q)
    const chain: Record<string, unknown> = {
      where: (arg: unknown) => {
        q.wheres.push(arg)
        return chain
      },
      whereIn: (col: string, vals: unknown[]) => {
        q.whereIns.push([col, vals])
        return chain
      },
      first: () => first(q),
    }
    return chain
  },
}))

const { createLeadFromWebhook } = await import('@/lib/system/createClientFromWebhook')

const LEAD = {
  firstName: 'Dana',
  lastName: 'Cohen',
  phone: '0521234567',
  email: 'dana@example.com',
  leadId: '1658206241915404',
  agencyId: 108,
  userId: 337,
}

/** Every `.where({...})` object merged, so scope can be asserted per query. */
function mergedWhere(q: { wheres: unknown[] }): Record<string, unknown> {
  return Object.assign({}, ...q.wheres.filter((w) => w && typeof w === 'object'))
}

beforeEach(() => {
  queries.length = 0
  first.mockReset()
  first.mockResolvedValue(undefined)
  insertLeadSystem.mockReset()
  insertLeadSystem.mockResolvedValue({ id: 501, leadSource: `facebook:${LEAD.leadId}` })
})

describe('createLeadFromWebhook dedup mirrors the unique indexes', () => {
  it('dedups on phone against a lead from ANY source, not just facebook:/instagram:', async () => {
    // The WhatsApp-sourced lead that agency 64's first Facebook lead collided with.
    first.mockImplementation(async (q) => {
      const w = mergedWhere(q)
      return w.phone ? { id: 77, leadSource: 'whatsapp:wamid.X' } : undefined
    })

    const lead = await createLeadFromWebhook({ ...LEAD })

    expect(lead).toEqual({ id: 77, leadSource: 'whatsapp:wamid.X' })
    // Returned the existing lead instead of attempting a doomed insert.
    expect(insertLeadSystem).not.toHaveBeenCalled()
  })

  it('dedups on email — the check that did not exist', async () => {
    first.mockImplementation(async (q) => {
      const w = mergedWhere(q)
      return w.email ? { id: 88, leadSource: 'facebook:OTHER' } : undefined
    })

    const lead = await createLeadFromWebhook({ ...LEAD })

    expect(lead).toEqual({ id: 88, leadSource: 'facebook:OTHER' })
    expect(insertLeadSystem).not.toHaveBeenCalled()
  })

  it('scopes every dedup query by agencyId, so a match can never be cross-tenant', async () => {
    await createLeadFromWebhook({ ...LEAD })

    // leadSource, phone and email lookups all ran, and each carried the agency.
    expect(queries.length).toBeGreaterThanOrEqual(3)
    for (const q of queries) {
      expect(mergedWhere(q).agencyId).toBe(108)
    }
  })

  it('still dedups by leadId first, across both channel prefixes', async () => {
    first.mockImplementation(async (q) => (q.whereIns.length ? { id: 9, leadSource: 'instagram:X' } : undefined))

    const lead = await createLeadFromWebhook({ ...LEAD })

    expect(lead).toEqual({ id: 9, leadSource: 'instagram:X' })
    expect(queries[0].whereIns[0][0]).toBe('leadSource')
    expect(mergedWhere(queries[0]).agencyId).toBe(108)
  })
})

describe('createLeadFromWebhook surfaces WHY a lead was dropped', () => {
  it('reports the SQLSTATE and constraint to onInsertError when the insert fails', async () => {
    // insertLeadSystem returns null AND reports the driver error through its sink.
    insertLeadSystem.mockImplementation(async (_input, options) => {
      options?.onError?.({
        code: '23505',
        constraint: 'clients_agency_email_unique',
        table: 'clients',
        column: null,
        summary: 'sqlstate=23505 constraint=clients_agency_email_unique table=clients',
      })
      return null
    })

    const onInsertError = vi.fn()
    const lead = await createLeadFromWebhook({ ...LEAD, onInsertError })

    expect(lead).toBeNull()
    expect(onInsertError).toHaveBeenCalledTimes(1)
    const detail = onInsertError.mock.calls[0][0] as string
    expect(detail).toContain('23505')
    expect(detail).toContain('clients_agency_email_unique')
    // The customer's address must never reach the diagnostics row.
    expect(detail).not.toContain('dana@example.com')
  })

  it('returns the concurrent row rather than an error when a racing writer won', async () => {
    insertLeadSystem.mockResolvedValue(null)
    // Nothing matches during dedup; the post-insert recheck finds the racer.
    let seen = 0
    first.mockImplementation(async () => {
      seen += 1
      return seen > 3 ? { id: 999, leadSource: `facebook:${LEAD.leadId}` } : undefined
    })

    const onInsertError = vi.fn()
    const lead = await createLeadFromWebhook({ ...LEAD, onInsertError })

    expect(lead).toEqual({ id: 999, leadSource: `facebook:${LEAD.leadId}` })
    // A race that resolved is not a dropped lead, so nothing is reported.
    expect(onInsertError).not.toHaveBeenCalled()
  })
})
