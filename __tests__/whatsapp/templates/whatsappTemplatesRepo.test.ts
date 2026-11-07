import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * The repository is exercised two ways: the pure row mapper directly, and the
 * query builders through a recording mock of `@/config/db` (the integration
 * harness is blocked, so query SHAPE — agency scope, archived exclusion, the
 * onConflict identity, the merge field set — is asserted, not executed).
 */

type Recorded = {
  table: string | null
  where: unknown[]
  whereNull: unknown[]
  groupBy: unknown[]
  orderBy: unknown[][]
  select: unknown[]
  first: unknown[]
  firstRow: unknown
  insert: Record<string, unknown> | null
  onConflict: unknown
  merge: Record<string, unknown> | null
  rows: unknown[]
}

const rec: Recorded = {
  table: null,
  where: [],
  whereNull: [],
  groupBy: [],
  orderBy: [],
  select: [],
  first: [],
  firstRow: undefined,
  insert: null,
  onConflict: null,
  merge: null,
  rows: [],
}

function resetRec() {
  Object.assign(rec, { table: null, where: [], whereNull: [], groupBy: [], orderBy: [], select: [], first: [], firstRow: undefined, insert: null, onConflict: null, merge: null, rows: [] })
}

vi.mock('@/config/db', () => {
  const builder = () => {
    const b: Record<string, unknown> = {}
    Object.assign(b, {
      where: (arg: unknown) => (rec.where.push(arg), b),
      whereNull: (arg: unknown) => (rec.whereNull.push(arg), b),
      groupBy: (arg: unknown) => (rec.groupBy.push(arg), b),
      orderBy: (...args: unknown[]) => (rec.orderBy.push(args), b),
      count: () => b,
      insert: (arg: Record<string, unknown>) => ((rec.insert = arg), b),
      onConflict: (arg: unknown) => ((rec.onConflict = arg), b),
      merge: (arg: Record<string, unknown>) => ((rec.merge = arg), b),
      select: (...cols: unknown[]) => (rec.select = cols, b),
      first: async (...cols: unknown[]) => ((rec.first = cols), rec.firstRow),
      // the builder is thenable, so awaiting any chain (list / count / upsert)
      // resolves to the configured rows
      then: (resolve: (v: unknown) => unknown) => resolve(rec.rows),
    })
    return b
  }
  const db = Object.assign((table: string) => ((rec.table = table), builder()), {
    fn: { now: () => 'NOW()' },
  })
  return { db }
})

const { mapTemplateRow, listTemplates, countByStatus, upsertFromMeta, loadTemplateForSend } = await import('@/db/whatsappTemplates')
const { failureTextForRejectionKey } = await import('@/lib/whatsapp/templates/statusCopy')

beforeEach(resetRec)

describe('mapTemplateRow (pure)', () => {
  const base = {
    id: '7',
    status: 'approved',
    displayTitle: 'תזכורת פולואפ',
    bodyText: 'היי {{1}}',
    variables: JSON.stringify([{ token: 'שם הליד', sample: 'דוד' }]),
    rejectionReason: null,
    archivedAt: null,
    createdAt: new Date('2026-07-23T10:00:00.000Z'),
  }

  it('coerces id, passes status, parses variables from JSON string', () => {
    const t = mapTemplateRow(base)
    expect(t.id).toBe(7)
    expect(t.status).toBe('approved')
    expect(t.variables).toEqual([{ token: 'שם הליד', sample: 'דוד' }])
    expect(t.createdAt).toBe('2026-07-23T10:00:00.000Z')
  })

  it('accepts variables that are already an array (jsonb parsed by the driver)', () => {
    const t = mapTemplateRow({ ...base, variables: [{ token: 'שם העסק', sample: 'העסק' }] })
    expect(t.variables).toEqual([{ token: 'שם העסק', sample: 'העסק' }])
  })

  it('failureText is null for non-rejected rows', () => {
    expect(mapTemplateRow({ ...base, status: 'approved' }).failureText).toBeNull()
    expect(mapTemplateRow({ ...base, status: 'pending' }).failureText).toBeNull()
  })

  it('failureText resolves the stored key for rejected rows (never a raw reason)', () => {
    const t = mapTemplateRow({ ...base, status: 'rejected', rejectionReason: 'policy' })
    expect(t.failureText).toBe(failureTextForRejectionKey('policy'))
    expect(t.failureText).not.toMatch(/[A-Z]{4,}/)
  })

  it('a rejected row with no stored key still gets generic copy', () => {
    const t = mapTemplateRow({ ...base, status: 'rejected', rejectionReason: null })
    expect(t.failureText).toBe(failureTextForRejectionKey('generic'))
  })

  it('archived reflects archivedAt presence', () => {
    expect(mapTemplateRow(base).archived).toBe(false)
    expect(mapTemplateRow({ ...base, archivedAt: new Date() }).archived).toBe(true)
  })

  it('malformed variables JSON degrades to []', () => {
    expect(mapTemplateRow({ ...base, variables: '{not json' }).variables).toEqual([])
  })

  it('hydrates a Meta-synced positional body to chips using stored bindings', () => {
    const t = mapTemplateRow({
      ...base,
      bodyText: 'היי {{1}}, מ־{{2}}',
      variables: '[]',
      metadata: JSON.stringify({ parameterBindings: [{ position: 1, source: 'leadFirstName' }, { position: 2, source: 'businessName' }] }),
    })
    expect(t.bodyText).toBe('היי שם הליד, מ־שם העסק') // no raw {{n}} reaches the client
    expect(t.variables).toEqual([{ token: 'שם הליד', sample: 'דוד' }, { token: 'שם העסק', sample: 'העסק שלי' }])
  })

  it('leaves an unmapped positional body raw (never guesses)', () => {
    const t = mapTemplateRow({ ...base, bodyText: 'היי {{1}}', variables: '[]', metadata: '{}' })
    expect(t.bodyText).toBe('היי {{1}}')
    expect(t.variables).toEqual([])
  })

  it('an in-app chip body passes through unchanged', () => {
    const t = mapTemplateRow({
      ...base,
      bodyText: 'היי שם הליד',
      variables: JSON.stringify([{ token: 'שם הליד', sample: 'דוד' }]),
      metadata: '{}',
    })
    expect(t.bodyText).toBe('היי שם הליד')
    expect(t.variables).toEqual([{ token: 'שם הליד', sample: 'דוד' }])
  })
})

describe('listTemplates — agency scope', () => {
  it('scopes to the agency, excludes archived by default, newest first', async () => {
    rec.rows = []
    await listTemplates(103)
    expect(rec.table).toBe('whatsapp_templates')
    expect(rec.where).toContainEqual({ agencyId: 103 })
    expect(rec.whereNull).toContain('archivedAt')
    expect(rec.orderBy).toContainEqual(['createdAt', 'desc'])
  })

  it('includeArchived skips the archived filter', async () => {
    rec.rows = []
    await listTemplates(103, { includeArchived: true })
    expect(rec.where).toContainEqual({ agencyId: 103 })
    expect(rec.whereNull).not.toContain('archivedAt')
  })

  it('maps returned rows through mapTemplateRow', async () => {
    rec.rows = [{ id: 1, status: 'rejected', displayTitle: 'x', bodyText: 'b', variables: '[]', rejectionReason: 'policy', archivedAt: null, createdAt: new Date('2026-07-23T00:00:00Z') }]
    const out = await listTemplates(103)
    expect(out[0].id).toBe(1)
    expect(out[0].failureText).toBe(failureTextForRejectionKey('policy'))
  })
})

describe('countByStatus — agency scope', () => {
  it('groups by status within the agency, excluding archived', async () => {
    rec.rows = [{ status: 'approved', count: '3' }, { status: 'pending', count: '1' }]
    const out = await countByStatus(103)
    expect(rec.where).toContainEqual({ agencyId: 103 })
    expect(rec.whereNull).toContain('archivedAt')
    expect(rec.groupBy).toContain('status')
    expect(out).toEqual({ approved: 3, pending: 1 })
  })
})

describe('loadTemplateForSend — agency scope + send fields', () => {
  it('scopes to (id, agency) and returns the send-shaped row', async () => {
    rec.firstRow = {
      id: '9',
      status: 'approved',
      name: 'follow_up',
      language: 'he',
      category: 'UTILITY',
      bodyText: 'היי שם הליד',
      variables: JSON.stringify([{ token: 'שם הליד', sample: 'דוד' }]),
      metadata: JSON.stringify({ parameterBindings: [{ position: 1, source: 'leadFirstName' }] }),
    }
    const out = await loadTemplateForSend(9, 103)
    expect(rec.table).toBe('whatsapp_templates')
    expect(rec.where).toContainEqual({ id: 9, agencyId: 103 })
    expect(rec.first).toEqual(['id', 'status', 'name', 'language', 'category', 'bodyText', 'variables', 'metadata'])
    expect(out).toEqual({
      id: 9,
      status: 'approved',
      name: 'follow_up',
      language: 'he',
      category: 'UTILITY',
      bodyText: 'היי שם הליד',
      variables: [{ token: 'שם הליד', sample: 'דוד' }],
      bindings: [{ position: 1, source: 'leadFirstName' }],
    })
  })

  it('returns null when the id is not this agency’s row', async () => {
    rec.firstRow = undefined
    expect(await loadTemplateForSend(9, 999)).toBeNull()
  })
})

describe('upsertFromMeta — idempotent by Meta identity', () => {
  it('conflicts on (wabaId, name, language) and merges only the volatile Meta fields', async () => {
    await upsertFromMeta({
      agencyId: 103,
      wabaId: 'WABA_1',
      name: 'follow_up',
      language: 'he',
      category: 'UTILITY',
      status: 'approved',
      metaTemplateId: 'MT_1',
      rejectionReason: null,
      qualityRating: 'GREEN',
      displayTitle: 'תזכורת',
      variables: [{ token: 'שם הליד', sample: 'דוד' }],
    })

    expect(rec.table).toBe('whatsapp_templates')
    expect(rec.onConflict).toEqual(['wabaId', 'name', 'language'])
    // insert carries owner-authored fields...
    expect(rec.insert).toMatchObject({ agencyId: 103, wabaId: 'WABA_1', name: 'follow_up', displayTitle: 'תזכורת', status: 'approved' })
    // ...but the merge (conflict path) touches ONLY the volatile Meta-owned fields
    expect(Object.keys(rec.merge ?? {}).sort()).toEqual(
      ['metaTemplateId', 'qualityRating', 'rejectionReason', 'status', 'updatedAt'].sort(),
    )
    expect(rec.merge).not.toHaveProperty('displayTitle')
    expect(rec.merge).not.toHaveProperty('variables')
  })

  it('defaults language to he and serializes json fields', async () => {
    await upsertFromMeta({ agencyId: 1, wabaId: 'W', name: 'n', category: 'MARKETING', status: 'pending' })
    expect(rec.insert?.language).toBe('he')
    expect(typeof rec.insert?.variables).toBe('string')
    expect(typeof rec.insert?.components).toBe('string')
  })
})
