import { test, expect, vi, beforeEach } from 'vitest'
import knex from 'knex'

/**
 * Compiles the SQL the PRODUCTION functions actually build — no rebuilt
 * lookalikes, or this would only prove that a copy of the query is scoped.
 *
 * A connection-less knex instance builds real query builders; awaiting one would
 * open a socket, so each builder is intercepted at `then` and its compiled SQL
 * is recorded instead of executed.
 *
 * This suite is what stands in for the DB-backed isolation tests, which cannot
 * run in this repo (the harness fails on Prisma-created base tables vs knex
 * migrate). It proves tenant scoping structurally rather than empirically.
 */
const compiler = knex({ client: 'pg' })
const compiled: string[] = []

function recordingDb(table: string) {
  const qb: any = compiler(table)
  qb.then = (resolve: any) => {
    compiled.push(qb.toSQL().sql)
    return Promise.resolve(resolve ? resolve([]) : [])
  }
  return qb
}
;(recordingDb as any).raw = compiler.raw.bind(compiler)
;(recordingDb as any).ref = compiler.ref.bind(compiler)

vi.mock('@/config/db', () => ({ db: recordingDb }))

beforeEach(() => {
  compiled.length = 0
})

test('listSupportRequestsSystem scopes by agencyId in BOTH scopes', async () => {
  const { listSupportRequestsSystem } = await import('@/db/support/requests')

  await listSupportRequestsSystem({ agencyId: 101, viewerUserId: 5, scope: 'own' })
  expect(compiled[0]).toContain('"agencyId"')
  expect(compiled[0]).toContain('"createdByUserId"')

  compiled.length = 0
  await listSupportRequestsSystem({ agencyId: 101, viewerUserId: 5, scope: 'agency' })
  expect(compiled[0]).toContain('"agencyId"')
  // Agency scope drops the author filter but NEVER the tenant filter.
  expect(compiled[0]).not.toContain('"createdByUserId" =')
})

test('getSupportRequestSystem never reads by id alone', async () => {
  const { getSupportRequestSystem } = await import('@/db/support/requests')
  await getSupportRequestSystem({ agencyId: 101, requestId: 9 })
  expect(compiled[0]).toContain('"agencyId"')
  expect(compiled[0]).toContain('"id"')
})

test('listSupportMessagesSystem scopes by agencyId, not just requestId', async () => {
  const { listSupportMessagesSystem } = await import('@/db/support/messages')
  await listSupportMessagesSystem({ agencyId: 101, requestId: 9 })
  expect(compiled[0]).toContain('"agencyId"')
  expect(compiled[0]).toContain('"requestId"')
})

test('countRequestsByUserSince is keyed by user, deliberately not by agency', async () => {
  const { countRequestsByUserSince } = await import('@/db/support/requests')
  await countRequestsByUserSince(5, new Date('2026-08-10T08:00:00Z'))
  // Per-user by design: one rep must not be able to exhaust the cap for their
  // colleagues. See lib/support/rateLimit.ts.
  expect(compiled[0]).toContain('"createdByUserId"')
})

test('db/support/admin.ts is the ENTIRE allowlist of cross-tenant functions', async () => {
  const admin = await import('@/db/support/admin')
  expect(Object.keys(admin).sort()).toEqual([
    'appendSupportMessageForAdmin',
    'getSupportRequestForAdmin',
    'listSupportRequestsForAdmin',
    'setSupportRequestStatusForAdmin',
  ])
})

test('the scoped modules export exactly the audited surface', async () => {
  // An export-inventory lock. A new function added to either scoped module fails
  // this test, which forces whoever adds it to come back and prove it is
  // tenant-scoped — the failure IS the audit working, so never "fix" it by
  // pasting the new name in without checking its WHERE clause.
  const requests = await import('@/db/support/requests')
  const messages = await import('@/db/support/messages')
  const actual = [...Object.keys(requests), ...Object.keys(messages)].sort()
  expect(actual).toEqual(
    [
      'appendMessageWithVerifiedParent',
      'appendSupportMessageSystem',
      'applyStatusTransition',
      'countRequestsByUserSince',
      'createSupportRequestSystem',
      'getSupportRequestSystem',
      'listSupportMessagesSystem',
      'listSupportRequestsSystem',
      'setSupportRequestStatusSystem',
    ].sort(),
  )
})
