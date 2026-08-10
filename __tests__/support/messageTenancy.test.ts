import { test, expect, vi } from 'vitest'

/**
 * The tenant-derivation guarantee, proven without a database.
 *
 * A recording fake transaction captures the ORDERED sequence of operations, so
 * these assert not just WHAT happened but what happened FIRST — the ordering is
 * the security property. If the parent lookup ever stops preceding the insert,
 * or stops carrying the tenant constraint, these fail.
 */

type Recorded = { table: string; op: string; where?: any; payload?: any; forUpdate?: boolean }

function makeTrx(parentRow: any) {
  const calls: Recorded[] = []

  const builder = (table: string) => {
    const rec: Recorded = { table, op: 'select' }
    const api: any = {
      select: () => api,
      where: (w: any) => {
        rec.where = { ...(rec.where ?? {}), ...w }
        return api
      },
      andWhere: (w: any) => {
        rec.where = { ...(rec.where ?? {}), ...w }
        return api
      },
      forUpdate: () => {
        rec.forUpdate = true
        return api
      },
      first: async () => {
        rec.op = 'select'
        calls.push(rec)
        return parentRow
      },
      insert: (payload: any) => {
        rec.op = 'insert'
        rec.payload = payload
        calls.push(rec)
        return { returning: async () => [{ id: 999 }] }
      },
      update: async (payload: any) => {
        rec.op = 'update'
        rec.payload = payload
        calls.push(rec)
        return 1
      },
    }
    return api
  }

  ;(builder as any).transaction = async (fn: any) => fn(builder)
  return { trx: builder as any, calls }
}

async function run(parentRow: any, agencyId: number | null, authorKind: any = 'customer') {
  vi.resetModules()
  const { trx, calls } = makeTrx(parentRow)
  vi.doMock('@/config/db', () => ({ db: trx }))
  const { appendMessageWithVerifiedParent } = await import('@/db/support/messages')
  const result = await appendMessageWithVerifiedParent(
    { requestId: 7, agencyId, authorKind, authorUserId: 5, body: 'שלום' },
    trx,
  )
  return { result, calls }
}

test('the FIRST statement resolves the parent under the tenant constraint, FOR UPDATE', async () => {
  const { calls } = await run({ id: 7, agencyId: 101, status: 'open', resolvedAt: null }, 101)
  expect(calls[0].table).toBe('support_requests')
  expect(calls[0].op).toBe('select')
  expect(calls[0].where).toMatchObject({ id: 7, agencyId: 101 })
  expect(calls[0].forUpdate).toBe(true)
})

test('when the parent does not resolve, NO insert is ever issued', async () => {
  const { result, calls } = await run(undefined, 101)
  expect(result).toEqual({ reason: 'not_found' })
  expect(calls.filter((c) => c.op === 'insert')).toHaveLength(0)
  expect(calls.filter((c) => c.table === 'support_messages')).toHaveLength(0)
})

test('a cross-tenant requestId is indistinguishable from a missing one', async () => {
  // The scoped SELECT returns nothing because the row is not this tenant's.
  // The caller learns only "not_found" — request ids are not enumerable.
  const { result } = await run(undefined, 999)
  expect(result).toEqual({ reason: 'not_found' })
})

test('the inserted agencyId is COPIED from the resolved row, not the argument', async () => {
  // A fabricated impossible state: the row says 999 while the caller asserted
  // 101. The written value must follow the ROW. If this ever fails, a caller
  // can choose the tenant of a message.
  const { calls } = await run({ id: 7, agencyId: 999, status: 'open', resolvedAt: null }, 101)
  const insert = calls.find((c) => c.table === 'support_messages' && c.op === 'insert')
  expect(insert!.payload.agencyId).toBe(999)
  expect(insert!.payload.agencyId).not.toBe(101)
})

test('the platform-owner path omits the tenant constraint but still copies from the row', async () => {
  const { result, calls } = await run(
    { id: 7, agencyId: 303, status: 'open', resolvedAt: null },
    null,
    'support',
  )
  expect(calls[0].where).toMatchObject({ id: 7 })
  expect(calls[0].where.agencyId).toBeUndefined()
  const insert = calls.find((c) => c.table === 'support_messages' && c.op === 'insert')
  expect(insert!.payload.agencyId).toBe(303)
  expect((result as any).ok).toBe(true)
})

test('the parent is updated after the insert, in the same transaction', async () => {
  const { calls } = await run({ id: 7, agencyId: 101, status: 'open', resolvedAt: null }, 101)
  const insertIdx = calls.findIndex((c) => c.table === 'support_messages' && c.op === 'insert')
  const updateIdx = calls.findIndex((c) => c.table === 'support_requests' && c.op === 'update')
  expect(insertIdx).toBeGreaterThanOrEqual(0)
  expect(updateIdx).toBeGreaterThan(insertIdx)
})

test('a support reply parks the request on the customer and stamps the clock', async () => {
  const { result, calls } = await run(
    { id: 7, agencyId: 101, status: 'open', resolvedAt: null },
    101,
    'support',
  )
  expect((result as any).nextStatus).toBe('waiting_for_customer')
  const statusUpdate = calls.filter((c) => c.table === 'support_requests' && c.op === 'update')
  expect(statusUpdate.some((c) => c.payload.status === 'waiting_for_customer')).toBe(true)
  expect(statusUpdate.some((c) => c.payload.lastMessageAuthorKind === 'support')).toBe(true)
})

test('a customer reply to a resolved request reopens it and clears resolvedAt', async () => {
  const { result, calls } = await run(
    { id: 7, agencyId: 101, status: 'resolved', resolvedAt: new Date('2026-08-01T00:00:00Z') },
    101,
    'customer',
  )
  expect((result as any).nextStatus).toBe('open')
  const statusUpdate = calls.find(
    (c) => c.table === 'support_requests' && c.op === 'update' && 'status' in (c.payload ?? {}),
  )
  expect(statusUpdate!.payload.status).toBe('open')
  expect(statusUpdate!.payload.resolvedAt).toBeNull()
})
