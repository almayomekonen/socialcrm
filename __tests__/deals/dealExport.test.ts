/**
 * Deals export — the trust boundary (no database).
 *
 * Before: the page signed the table's `{ sql, bindings }` with JWT_SECRET, the
 * client carried that token back, and the export ran the `sql` claim through
 * db.raw. Anyone holding the session key could choose the SQL.
 *
 * After: the client sends only the page's active filter. The action validates it
 * (a JSON object, bounded), resolves agency/role/rep scope from the SESSION via
 * getPermsAndFilter, and builds the rows on the server. These tests pin that no
 * input — including a correctly signed legacy token — reaches SQL text.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { SignJWT } from 'jose'

const { requireProductAccess, getPermsAndFilter, getDealExportRows, raw } = vi.hoisted(() => ({
  requireProductAccess: vi.fn(),
  getPermsAndFilter: vi.fn(),
  getDealExportRows: vi.fn(),
  raw: vi.fn(),
}))

vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn(), cacheTag: vi.fn() }))
vi.mock('@/lib/requireUser', () => ({ requireProductAccess, requireBasicCrmAccess: vi.fn() }))
vi.mock('@/db/auth', () => ({ getUser: vi.fn() }))
vi.mock('@/db/filter', () => ({ getPermsAndFilter }))
vi.mock('@/db/salesTbl', () => ({ getDealExportRows }))
vi.mock('@/config/db', () => {
  const db: any = vi.fn()
  db.raw = raw
  return { db }
})

import { getDealDataToExport } from '@/actions/salesTbl'
import { MAX_EXPORT_FILTER_LENGTH, parseExportFilter } from '@/lib/deals/exportFilter'

const SESSION = { id: 11, agencyId: 7, role: 'AGNT', name: 'נציג' }
const SQL_FILTER = { sql: 'built-on-the-server', userIds: [11] }

/** A token exactly like the removed `sqlExport`: valid HS256 under the session key. */
const legacySignedToken = (sql: string) =>
  new SignJWT({ sql, bindings: [] })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('365 days')
    .sign(new TextEncoder().encode(process.env.JWT_SECRET!))

beforeEach(() => {
  requireProductAccess.mockReset().mockResolvedValue(SESSION)
  getPermsAndFilter.mockReset().mockResolvedValue({ sqlFilter: SQL_FILTER })
  getDealExportRows.mockReset().mockResolvedValue([{ id: 1 }])
  raw.mockReset()
})

describe('parseExportFilter — the only accepted input', () => {
  it.each([null, undefined, ''])('%j → no filter (the page defaults)', (v) => {
    expect(parseExportFilter(v)).toEqual({ ok: true, filter: undefined })
  })

  it('a JSON object string is accepted unchanged', () => {
    const f = JSON.stringify({ dateRange: 'כל התאריכים', status: ['שולם'], userIds: [3] })
    expect(parseExportFilter(f)).toEqual({ ok: true, filter: f })
  })

  it.each([
    ['SQL text', 'SELECT * FROM users'],
    ['a JWT-shaped token', 'eyJhbGciOiJIUzI1NiJ9.eyJzcWwiOiJTRUxFQ1QgMSJ9.c2ln'],
    ['a JSON array', '[1,2]'],
    ['JSON null', 'null'],
    ['a JSON string', '"x"'],
    ['a JSON number', '42'],
    ['broken JSON', '{"a":'],
    ['an object (not a string)', { sql: 'SELECT 1', bindings: [] }],
    ['a number', 7],
    ['over the length cap', JSON.stringify({ x: 'a'.repeat(MAX_EXPORT_FILTER_LENGTH) })],
  ])('%s is refused', (_label, v) => {
    expect(parseExportFilter(v)).toEqual({ ok: false })
  })
})

describe('getDealDataToExport', () => {
  it('builds the rows on the server from the filter, scoped by the SESSION user and agency', async () => {
    const f = JSON.stringify({ dateRange: 'כל התאריכים' })
    expect(await getDealDataToExport(f)).toEqual([{ id: 1 }])
    expect(getPermsAndFilter).toHaveBeenCalledWith({ user: SESSION, filter: f })
    expect(getDealExportRows).toHaveBeenCalledWith(SQL_FILTER, 7)
    expect(raw).not.toHaveBeenCalled()
  })

  it('a filter naming another agency or user changes nothing about whose scope is used', async () => {
    await getDealDataToExport(JSON.stringify({ agencyId: 999, userId: 1, userIds: [1] }))
    expect(getPermsAndFilter.mock.calls[0][0].user).toBe(SESSION)
    expect(getDealExportRows.mock.calls[0][1]).toBe(7)
  })

  it('REGRESSION: a correctly signed legacy token carrying SQL is refused; no query is built and nothing reaches db.raw', async () => {
    const token = await legacySignedToken('SELECT 1 AS "agencyId"')
    await expect(getDealDataToExport(token)).rejects.toThrow('Invalid export request')
    expect(getPermsAndFilter).not.toHaveBeenCalled()
    expect(getDealExportRows).not.toHaveBeenCalled()
    expect(raw).not.toHaveBeenCalled()
  })

  it.each([
    ['SQL text', 'SELECT * FROM users'],
    ['an object payload', { sql: 'SELECT 1', bindings: [1] }],
    ['an array', '[]'],
  ])('%s is refused before any query is built', async (_l, v) => {
    await expect(getDealDataToExport(v)).rejects.toThrow('Invalid export request')
    expect(getPermsAndFilter).not.toHaveBeenCalled()
    expect(raw).not.toHaveBeenCalled()
  })

  it('no product access (or no session): refused before input is even read', async () => {
    requireProductAccess.mockRejectedValue(new Error('subscription-required'))
    await expect(getDealDataToExport(JSON.stringify({}))).rejects.toThrow('subscription-required')
    expect(getPermsAndFilter).not.toHaveBeenCalled()
  })
})

describe('the flow no longer depends on the session signing key', () => {
  const read = (f: string) => readFileSync(path.join(process.cwd(), f), 'utf8')

  it.each(['db/salesTbl.ts', 'actions/salesTbl.ts'])('%s neither signs nor verifies JWTs', (f) => {
    expect(read(f)).not.toMatch(/\b(encrypt|decrypt)\b/)
  })

  it('the export path never runs raw SQL text', () => {
    const action = read('actions/salesTbl.ts')
    const exportFn = action.slice(
      action.indexOf('export async function getDealDataToExport'),
      action.indexOf('export async function addFavDeals'),
    )
    expect(exportFn).not.toMatch(/db\.raw|\.raw\(/)
  })

  it('the page hands the export a filter, never a query or token', () => {
    const page = read('app/(app)/deals/page.tsx')
    expect(page).toMatch(/exportFilter: filter \?\? null/)
    expect(page).not.toMatch(/sqlExport/)
    expect(read('lib/table/export/index.tsx')).not.toMatch(/sqlExport/)
  })
})
