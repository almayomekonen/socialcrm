/**
 * Quote numbers are unique and sequential per agency and year: under repeated
 * creation, under failure at the latest possible point, and under concurrency.
 * The real allocator and a real Postgres row lock; the only stand-in is a wrapper
 * that can throw AFTER a number was really allocated.
 * Run: NODE_ENV=test npx vitest run --no-file-parallelism __tests__/quotes/quoteNumbering.db.test.ts
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ failAfterAllocate: false, failEvery: 0, calls: 0 }))
vi.mock('@/db/billing/numbering', async (orig) => {
  const real = await orig<typeof import('@/db/billing/numbering')>()
  return {
    ...real,
    allocateNumberInTransaction: async (...args: Parameters<typeof real.allocateNumberInTransaction>) => {
      const allocated = await real.allocateNumberInTransaction(...args)
      if (h.failAfterAllocate) throw new Error('injected failure after allocation')
      if (h.failEvery && ++h.calls % h.failEvery === 0) throw new Error('injected failure after allocation')
      return allocated
    },
  }
})

import { db } from '@/config/db'
import { allocateNumberInTransaction } from '@/db/billing/numbering'
import { createQuoteSystem } from '@/db/quotes/createQuote'

type Fixture = { agencyId: number; userId: number; leadId: number }
const created: number[] = []
const YEAR = 2026
const IN_YEAR = Date.parse('2026-06-15T09:00:00Z')
let seq = 0

async function fixture(name: string): Promise<Fixture> {
  const [a] = await db('agencies').insert({ name }).returning('id')
  const agencyId = Number(a.id)
  created.push(agencyId)
  await db.raw(`UPDATE agencies SET "businessType" = 'authorized' WHERE id = ?`, [agencyId])
  const [u] = await db('users').insert({ firstName: 'A', role: 'ADMIN', agencyId } as never).returning('id')
  const userId = Number(u.id)
  const [c] = await db('clients').insert({ firstName: 'דוד', lastName: 'כהן', createdById: userId, agencyId, userId, status: 'new', lead: true }).returning('id')
  await db('bill_tax_rates').insert({ agencyId, code: 'VAT_STD', label: 'מע"מ', ratePercent: 18, country: 'IL', effectiveFrom: '2024-01-01' })
  return { agencyId, userId, leadId: Number(c.id) }
}

const input = (f: Fixture, over: Record<string, unknown> = {}) => ({
  agencyId: f.agencyId,
  leadId: f.leadId,
  createdByUserId: f.userId,
  title: 'שיפוץ',
  lines: [{ title: 'פריט', quantity: 1, unitAmount: 100 }],
  priceBasis: 'excl_vat' as const,
  validityDays: null,
  automationKey: `numbering:${++seq}`,
  finalize: true,
  nowMs: IN_YEAR,
  ...over,
})

const create = (f: Fixture, over: Record<string, unknown> = {}) => createQuoteSystem(input(f, over) as never)
const numbers = async (agencyId: number) => (await db('sales_quotes').where({ agencyId }).whereNotNull('quoteNumber').orderBy('quoteNumber').pluck('quoteNumber')).map(Number)
const nextValue = async (agencyId: number, year = YEAR) => {
  const row = await db('bill_numbering_sequences').where({ agencyId, year, kind: 'quote' }).first('nextValue')
  return row ? Number(row.nextValue) : null
}
const oneTo = (n: number) => Array.from({ length: n }, (_, i) => i + 1)

beforeAll(async () => {
  await db.raw(`SELECT setval('agencies_id_seq', (SELECT COALESCE(MAX(id) + 1, 1) FROM agencies), false)`)
  await db.raw(`SELECT setval('users_seq', (SELECT COALESCE(MAX(id) + 1, 1) FROM users), false)`)
  await db.raw(`SELECT setval('"Client_id_seq"', (SELECT COALESCE(MAX(id) + 1, 1) FROM clients), false)`)
})

afterAll(async () => {
  h.failAfterAllocate = false
  h.failEvery = 0
  for (const agencyId of created) {
    await db('sales_quotes').where({ agencyId }).del()
    await db('bill_numbering_sequences').where({ agencyId }).del()
    await db('bill_tax_rates').where({ agencyId }).del()
    await db('clients').where({ agencyId }).del()
    await db('users').where({ agencyId }).del()
    await db('agencies').where({ id: agencyId }).del()
  }
  await db.destroy()
})

describe('consecutive quotes', () => {
  it('five in a row for one agency are numbered 1 to 5, each ready and in its year', async () => {
    const f = await fixture('__numbering_five__')
    const got = []
    for (let i = 0; i < 5; i++) got.push(await create(f))
    expect(got.map((r) => (r as { quoteNumber: number }).quoteNumber)).toEqual(oneTo(5))
    expect(got.every((r) => r.ok === true && r.created && r.status === 'ready' && r.quoteYear === YEAR)).toBe(true)
    expect(new Set(got.map((r) => (r as { quoteId: number }).quoteId)).size).toBe(5)
    expect(await numbers(f.agencyId)).toEqual(oneTo(5))
    expect(await nextValue(f.agencyId)).toBe(6)
  })

  it('agencies count separately', async () => {
    const [a, b] = [await fixture('__numbering_a__'), await fixture('__numbering_b__')]
    for (const f of [a, b, a, b, a]) await create(f)
    expect(await numbers(a.agencyId)).toEqual([1, 2, 3])
    expect(await numbers(b.agencyId)).toEqual([1, 2])
  })

  it('a new business year starts again at 1, and the old year is left where it was', async () => {
    const f = await fixture('__numbering_year__')
    await create(f)
    await create(f)
    // 22:30 UTC on Dec 31 is already Jan 1 in Israel.
    const r = await create(f, { nowMs: Date.parse('2026-12-31T22:30:00Z') })
    expect(r).toMatchObject({ ok: true, quoteNumber: 1, quoteYear: 2027 })
    expect(await nextValue(f.agencyId, 2026)).toBe(3)
    expect(await nextValue(f.agencyId, 2027)).toBe(2)
  })

  it('the database itself refuses a second quote with the same number', async () => {
    const f = await fixture('__numbering_unique__')
    const r = (await create(f)) as { quoteNumber: number; quoteYear: number }
    const draft = (await create(f, { finalize: false })) as { quoteId: number }
    await expect(db('sales_quotes').where({ id: draft.quoteId }).update({ status: 'ready', quoteNumber: r.quoteNumber, quoteYear: r.quoteYear, readyAt: db.fn.now() })).rejects.toThrow(/duplicate key|unique/i)
  })
})

describe('failure never consumes a number', () => {
  it.each([
    ['a total that no longer matches', { expectedTotalAmount: 1 }, 'total_mismatch'],
    ['a changed VAT rate', { expectedRatePercent: 17 }, 'rate_changed'],
    ['a lead that does not exist', { leadId: 2147483000 }, 'lead_not_found'],
    ['a discount above the price', { lines: [{ title: 'פריט', quantity: 1, unitAmount: 100, discountAmount: 500 }] }, 'discount_exceeds_price'],
  ])('%s is refused with nothing written', async (_name, over, reason) => {
    const f = await fixture(`__numbering_refused_${reason}__`)
    expect(await create(f)).toMatchObject({ ok: true, quoteNumber: 1 })
    expect(await create(f, over)).toEqual({ ok: false, reason })
    expect(await nextValue(f.agencyId)).toBe(2)
    expect(await create(f)).toMatchObject({ ok: true, quoteNumber: 2 })
  })

  it('a failure after the number was allocated rolls the number back with the quote', async () => {
    const f = await fixture('__numbering_rollback__')
    await create(f)
    h.failAfterAllocate = true
    await expect(create(f)).rejects.toThrow('injected failure after allocation')
    await expect(create(f)).rejects.toThrow('injected failure after allocation')
    h.failAfterAllocate = false
    expect(await nextValue(f.agencyId)).toBe(2)
    expect(await db('sales_quotes').where({ agencyId: f.agencyId })).toHaveLength(1)
    expect(await db('sales_quote_items').where({ agencyId: f.agencyId })).toHaveLength(1)
    expect(await create(f)).toMatchObject({ ok: true, quoteNumber: 2 })
    expect(await numbers(f.agencyId)).toEqual([1, 2])
  })

  it('a failure on the very first quote leaves no sequence behind', async () => {
    const f = await fixture('__numbering_first__')
    h.failAfterAllocate = true
    await expect(create(f)).rejects.toThrow('injected failure after allocation')
    h.failAfterAllocate = false
    expect(await nextValue(f.agencyId)).toBeNull()
    expect(await create(f)).toMatchObject({ ok: true, quoteNumber: 1 })
  })

  it('a retry of the same key returns the same quote and takes no new number', async () => {
    const f = await fixture('__numbering_retry__')
    const automationKey = `numbering:retry:${++seq}`
    const first = (await create(f, { automationKey })) as { quoteId: number }
    expect(await create(f, { automationKey })).toMatchObject({ ok: true, created: false, quoteId: first.quoteId, quoteNumber: 1 })
    expect(await nextValue(f.agencyId)).toBe(2)
  })

  it('a draft takes no number', async () => {
    const f = await fixture('__numbering_draft__')
    expect(await create(f, { finalize: false })).toMatchObject({ ok: true, quoteNumber: null, status: 'draft' })
    expect(await nextValue(f.agencyId)).toBeNull()
    expect(await create(f)).toMatchObject({ ok: true, quoteNumber: 1 })
  })
})

describe('concurrent creation', () => {
  it('twenty at once get twenty unique, gap-free numbers', async () => {
    const f = await fixture('__numbering_concurrent__')
    const got = await Promise.all(Array.from({ length: 20 }, () => create(f)))
    expect(got.every((r) => r.ok === true && r.created)).toBe(true)
    expect(got.map((r) => (r as { quoteNumber: number }).quoteNumber).sort((a, b) => a - b)).toEqual(oneTo(20))
    expect(await numbers(f.agencyId)).toEqual(oneTo(20))
    expect(await nextValue(f.agencyId)).toBe(21)
  }, 60_000)

  it('ten callers with the same key make one quote and take one number', async () => {
    const f = await fixture('__numbering_same_key__')
    const automationKey = `numbering:race:${++seq}`
    const got = await Promise.all(Array.from({ length: 10 }, () => create(f, { automationKey })))
    expect(new Set(got.map((r) => (r as { quoteId: number }).quoteId)).size).toBe(1)
    expect(got.filter((r) => r.ok === true && r.created)).toHaveLength(1)
    expect(got.every((r) => r.ok === true && r.quoteNumber === 1)).toBe(true)
    expect(await numbers(f.agencyId)).toEqual([1])
    expect(await nextValue(f.agencyId)).toBe(2)
  }, 60_000)

  it('failures in the middle of a burst leave the survivors gap-free', async () => {
    const f = await fixture('__numbering_burst__')
    h.calls = 0
    h.failEvery = 3
    const got = await Promise.allSettled(Array.from({ length: 18 }, () => create(f)))
    h.failEvery = 0
    const ok = got.filter((r) => r.status === 'fulfilled')
    expect(got.filter((r) => r.status === 'rejected').length).toBeGreaterThan(0)
    expect(await numbers(f.agencyId)).toEqual(oneTo(ok.length))
    expect(await nextValue(f.agencyId)).toBe(ok.length + 1)
  }, 60_000)

  it('two agencies racing do not touch each other', async () => {
    const [a, b] = [await fixture('__numbering_race_a__'), await fixture('__numbering_race_b__')]
    await Promise.all(Array.from({ length: 16 }, (_, i) => create(i % 2 ? a : b)))
    expect(await numbers(a.agencyId)).toEqual(oneTo(8))
    expect(await numbers(b.agencyId)).toEqual(oneTo(8))
  }, 60_000)
})

describe('invoice and receipt sequences', () => {
  const take = (agencyId: number, kind: 'invoice' | 'receipt' | 'quote') => db.transaction((trx) => allocateNumberInTransaction(trx, { agencyId, year: YEAR, kind }))
  const legal = (agencyId: number) => db('bill_numbering_sequences').where({ agencyId }).whereIn('kind', ['invoice', 'receipt']).orderBy(['year', 'kind']).select('*')

  it('are unchanged, to the timestamp, by quotes, failures and a concurrent burst', async () => {
    const f = await fixture('__numbering_legal__')
    for (const kind of ['invoice', 'invoice', 'invoice', 'receipt', 'receipt'] as const) await take(f.agencyId, kind)
    const before = await legal(f.agencyId)
    expect(before.map((r) => [r.kind, Number(r.nextValue)])).toEqual([['invoice', 4], ['receipt', 3]])

    for (let i = 0; i < 5; i++) await create(f)
    await create(f, { expectedTotalAmount: 1 })
    h.failAfterAllocate = true
    await expect(create(f)).rejects.toThrow('injected failure after allocation')
    h.failAfterAllocate = false
    await Promise.all(Array.from({ length: 10 }, () => create(f)))

    expect(await numbers(f.agencyId)).toEqual(oneTo(15))
    expect(await legal(f.agencyId)).toEqual(before)
  }, 60_000)

  it('quotes start at 1 whatever invoices and receipts have reached, and do not advance them', async () => {
    const f = await fixture('__numbering_independent__')
    for (let i = 0; i < 7; i++) await take(f.agencyId, 'invoice')
    expect(await create(f)).toMatchObject({ ok: true, quoteNumber: 1 })
    expect(await take(f.agencyId, 'invoice')).toBe(8)
    expect(await take(f.agencyId, 'receipt')).toBe(1)
    expect(await create(f)).toMatchObject({ ok: true, quoteNumber: 2 })
  })
})
