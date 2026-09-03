/**
 * Bulk lead assignment — the invariants the production bug exposed.
 *
 * The flow that looked broken ("העברת לידים לנציג" in user management) never
 * moved lead ownership: it wrote `clients.createdById`, while every permission
 * filter reads `clients.userId`. This action is the selected-leads flow that
 * actually assigns, so the tests below pin the two columns that decide
 * visibility, the one that must NOT move, and the notification recipient.
 *
 * Identity collision is asserted directly: source and recipient share the
 * display name "אבי Mekonen", because that is the production case and because
 * nothing in this path may resolve a user by name.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'

type Row = { id: number; userId: number; handlerId: number; createdById: number; agencyId: number }

const h = vi.hoisted(() => ({
  user: null as Record<string, unknown> | null,
  rows: [] as Row[],
  users: [] as { id: number; agencyId: number }[],
  updates: [] as { ids: number[]; patch: Record<string, unknown> }[],
  events: [] as any[],
  transactions: 0,
}))

vi.mock('next/cache', () => ({ revalidatePath: () => {}, revalidateTag: () => {} }))
vi.mock('@/lib/requireUser', async (orig) => {
  const actual = (await orig()) as Record<string, unknown>
  return { ...actual, requireProductAccess: async () => h.user, requireBasicCrmAccess: async () => h.user }
})
vi.mock('@/lib/notifications/emit', () => ({
  notifyEvent: async (evt: any) => {
    h.events.push(evt)
  },
}))
vi.mock('@/db/filter', () => ({ getPerms: async () => ({ gotPermIds: [] }) }))

vi.mock('@/config/db', () => {
  function table(name: string) {
    const filters: Record<string, unknown>[] = []
    let inIds: number[] | null = null
    const qb: Record<string, unknown> = {}
    const matchRows = () =>
      h.rows.filter(
        (r) =>
          (inIds === null || inIds.includes(r.id)) &&
          filters.every((f) => Object.entries(f).every(([k, v]) => (r as any)[k] === v)),
      )
    qb.where = (f: any) => {
      if (f && typeof f === 'object') filters.push(f)
      return qb
    }
    qb.andWhere = qb.where
    qb.whereIn = (_col: string, ids: number[]) => {
      inIds = ids.map(Number)
      return qb
    }
    qb.forUpdate = () => qb
    qb.select = async () => matchRows().map((r) => ({ ...r }))
    qb.first = async () => {
      if (name === 'users') {
        const f = Object.assign({}, ...filters) as any
        return h.users.find((u) => u.id === f.id && u.agencyId === f.agencyId)
      }
      return matchRows()[0]
    }
    qb.update = async (patch: Record<string, unknown>) => {
      const hit = matchRows()
      h.updates.push({ ids: hit.map((r) => r.id), patch })
      for (const r of hit) Object.assign(r, patch)
      return hit.length
    }
    return qb
  }
  const db = Object.assign((n: string) => table(n), {
    transaction: async (fn: (t: any) => Promise<unknown>) => {
      h.transactions += 1
      return fn((n: string) => table(n))
    },
    raw: () => ({}),
  })
  return { db }
})

const AGENCY = 10
const ADMIN = { id: 1, role: 'ADMIN', agencyId: AGENCY }
const AGNT = { id: 4, role: 'AGNT', agencyId: AGENCY }
/** Source and recipient deliberately share a display name — the production case. */
const SOURCE = 2 // "אבי Mekonen"
const RECIPIENT = 3 // "אבי Mekonen"

beforeEach(() => {
  h.user = ADMIN
  h.updates = []
  h.events = []
  h.transactions = 0
  h.users = [
    { id: SOURCE, agencyId: AGENCY },
    { id: RECIPIENT, agencyId: AGENCY },
    { id: 99, agencyId: 77 }, // another tenant
  ]
  h.rows = [
    { id: 101, userId: SOURCE, handlerId: SOURCE, createdById: SOURCE, agencyId: AGENCY },
    { id: 102, userId: SOURCE, handlerId: SOURCE, createdById: 55, agencyId: AGENCY },
    { id: 201, userId: SOURCE, handlerId: SOURCE, createdById: SOURCE, agencyId: 77 }, // other tenant
  ]
})

async function assign(ids: number[], target: number) {
  const { assignLeadsToRep } = await import('@/actions/clients')
  return assignLeadsToRep(ids, target)
}

describe('ownership actually moves', () => {
  it('sets BOTH userId and handlerId on the selected leads', async () => {
    await assign([101, 102], RECIPIENT)
    const moved = h.rows.filter((r) => [101, 102].includes(r.id))
    for (const r of moved) {
      expect(r.userId).toBe(RECIPIENT)
      expect(r.handlerId).toBe(RECIPIENT)
    }
  })

  it('never touches createdById — provenance is not ownership', async () => {
    await assign([101, 102], RECIPIENT)
    expect(h.rows.find((r) => r.id === 101)!.createdById).toBe(SOURCE)
    expect(h.rows.find((r) => r.id === 102)!.createdById).toBe(55)
    for (const u of h.updates) expect(Object.keys(u.patch)).not.toContain('createdById')
  })

  it('assigns a lead created by someone else — selection decides, not provenance', async () => {
    await assign([102], RECIPIENT)
    expect(h.rows.find((r) => r.id === 102)!.userId).toBe(RECIPIENT)
  })

  it('moves only the selected leads', async () => {
    await assign([101], RECIPIENT)
    expect(h.rows.find((r) => r.id === 101)!.userId).toBe(RECIPIENT)
    expect(h.rows.find((r) => r.id === 102)!.userId).toBe(SOURCE)
  })

  it('reports how many moved', async () => {
    const res = await assign([101, 102], RECIPIENT)
    expect(res.assignedCount).toBe(2)
    expect(res.skippedCount).toBe(0)
  })
})

describe('notification goes to the recipient, exactly once', () => {
  it('emits one summary for the whole batch, not one per lead', async () => {
    await assign([101, 102], RECIPIENT)
    expect(h.events).toHaveLength(1)
    expect(h.events[0].type).toBe('lead.bulk_assigned')
  })

  it('addresses the RECIPIENT, never the source', async () => {
    await assign([101, 102], RECIPIENT)
    expect(h.events[0].payload.assignedUserId).toBe(RECIPIENT)
    expect(h.events[0].payload.assignedUserId).not.toBe(SOURCE)
  })

  it('carries the count so the copy states a fact rather than guessing', async () => {
    await assign([101, 102], RECIPIENT)
    expect(h.events[0].payload.assignedCount).toBe(2)
  })

  it('records the acting admin as the actor', async () => {
    await assign([101], RECIPIENT)
    expect(h.events[0].actorUserId).toBe(ADMIN.id)
  })

  it('emits nothing when every lead is already on that rep — a retry is a no-op', async () => {
    await assign([101], RECIPIENT)
    h.events = []
    const res = await assign([101], RECIPIENT)
    expect(h.events).toHaveLength(0)
    expect(res.assignedCount).toBe(0)
    expect(res.skippedCount).toBe(1)
  })
})

describe('the aggregate entity is the representative, not a lead', () => {
  it('addresses the SET, not an arbitrary lead row', async () => {
    await assign([101, 102], RECIPIENT)
    expect(h.events[0].entityType).toBe('lead_assignment')
    expect(h.events[0].entityId).toBe(RECIPIENT)
    // Never anchored to one of the moved leads.
    expect([101, 102]).not.toContain(h.events[0].entityId)
  })

  it('keeps entity and recipient the same value — they cannot drift', async () => {
    await assign([101], RECIPIENT)
    expect(h.events[0].entityId).toBe(h.events[0].payload.assignedUserId)
  })

  it('carries a batch digest identifying WHICH leads moved', async () => {
    await assign([101, 102], RECIPIENT)
    expect(typeof h.events[0].payload.assignmentBatchId).toBe('string')
    expect(h.events[0].payload.assignmentBatchId.length).toBeGreaterThan(0)
  })

  it('gives two different batches different digests', async () => {
    await assign([101], RECIPIENT)
    const first = h.events[0].payload.assignmentBatchId
    // Reset ownership so the second batch is a real move, not a no-op.
    h.rows.find((r) => r.id === 102)!.userId = SOURCE
    h.events = []
    await assign([102], RECIPIENT)
    expect(h.events[0].payload.assignmentBatchId).not.toBe(first)
  })

  it('is order-independent — the same set hashes the same either way', async () => {
    await assign([101, 102], RECIPIENT)
    const a = h.events[0].payload.assignmentBatchId
    for (const r of h.rows) if ([101, 102].includes(r.id)) (r.userId = SOURCE), (r.handlerId = SOURCE)
    h.events = []
    await assign([102, 101], RECIPIENT)
    expect(h.events[0].payload.assignmentBatchId).toBe(a)
  })
})

describe('identical display names cannot misroute', () => {
  it('routes by id — the shared name "אבי Mekonen" is never consulted', async () => {
    await assign([101], RECIPIENT)
    expect(h.rows.find((r) => r.id === 101)!.userId).toBe(RECIPIENT)
    expect(h.events[0].payload.assignedUserId).toBe(RECIPIENT)
    const blob = JSON.stringify(h.updates) + JSON.stringify(h.events)
    expect(blob).not.toContain('Mekonen')
  })
})

describe('authorization and tenant isolation', () => {
  it('refuses a non-admin, writes nothing and notifies nobody', async () => {
    h.user = AGNT
    await expect(assign([101], RECIPIENT)).rejects.toThrow('Forbidden')
    expect(h.updates).toEqual([])
    expect(h.events).toEqual([])
    expect(h.transactions).toBe(0)
  })

  it('refuses a recipient from another agency, before any write', async () => {
    await expect(assign([101], 99)).rejects.toThrow('Forbidden')
    expect(h.updates).toEqual([])
    expect(h.transactions).toBe(0)
  })

  it('never moves a lead belonging to another agency', async () => {
    await assign([101, 201], RECIPIENT)
    expect(h.rows.find((r) => r.id === 201)!.userId).toBe(SOURCE)
    expect(h.rows.find((r) => r.id === 201)!.agencyId).toBe(77)
  })

  it('is a no-op for an empty selection', async () => {
    const res = await assign([], RECIPIENT)
    expect(res).toEqual({ assignedCount: 0, skippedCount: 0 })
    expect(h.transactions).toBe(0)
    expect(h.events).toEqual([])
  })

  it('ignores malformed ids rather than trusting them', async () => {
    const res = await assign([0, -5, NaN as unknown as number], RECIPIENT)
    expect(res.assignedCount).toBe(0)
    expect(h.updates).toEqual([])
  })
})
