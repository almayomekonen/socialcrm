/**
 * CHARACTERIZATION, through the real write: what the database holds for identical
 * lines, and that nothing changes between the computed totals and the stored row.
 *
 * Run: npm run test:db -- __tests__/quotes/quoteRoundingPersistence.db.test.ts
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { db } from '@/config/db'
import { createQuoteSystem } from '@/db/quotes/createQuote'

const ids = { registered: { agency: 0, user: 0, lead: 0 }, exempt: { agency: 0, user: 0, lead: 0 } }
const setSeq = (seq: string, table: string) => db.raw(`SELECT setval(?, (SELECT COALESCE(MAX(id) + 1, 1) FROM ??), false)`, [seq, table])

beforeAll(async () => {
  await setSeq('agencies_id_seq', 'agencies')
  await setSeq('users_seq', 'users')
  await setSeq('"Client_id_seq"', 'clients')
  for (const kind of ['registered', 'exempt'] as const) {
    const [a] = await db('agencies').insert({ name: `__rounding_${kind}__` }).returning('id')
    const agency = Number(a.id)
    await db.raw(`UPDATE agencies SET "businessType" = ? WHERE id = ?`, [kind === 'exempt' ? 'exempt' : 'authorized', agency])
    const [u] = await db('users').insert({ firstName: 'A', role: 'ADMIN', agencyId: agency } as never).returning('id')
    const [c] = await db('clients').insert({ firstName: 'דוד', lastName: 'כהן', createdById: Number(u.id), agencyId: agency, userId: Number(u.id), status: 'new', lead: true }).returning('id')
    ids[kind] = { agency, user: Number(u.id), lead: Number(c.id) }
  }
  await db('bill_tax_rates').insert({ agencyId: ids.registered.agency, code: 'VAT_STD', label: 'מע"מ', ratePercent: 18, country: 'IL', effectiveFrom: '2024-01-01' })
  await db('bill_tax_rates').insert({ agencyId: ids.exempt.agency, code: 'VAT_STD', label: 'מע"מ', ratePercent: 18, country: 'IL', effectiveFrom: '2024-01-01' })
})
const agencies = () => [ids.registered.agency, ids.exempt.agency]
beforeEach(async () => {
  await db('sales_quotes').whereIn('agencyId', agencies()).del()
  await db('bill_numbering_sequences').whereIn('agencyId', agencies()).del()
})
afterAll(async () => {
  await db('sales_quotes').whereIn('agencyId', agencies()).del()
  await db('bill_numbering_sequences').whereIn('agencyId', agencies()).del()
  await db('bill_tax_rates').whereIn('agencyId', agencies()).del()
  await db('clients').whereIn('agencyId', agencies()).del()
  await db('users').whereIn('agencyId', agencies()).del()
  await db('agencies').whereIn('id', agencies()).del()
  await db.destroy()
})

async function write(kind: 'registered' | 'exempt', n: number, priceBasis: 'incl_vat' | 'excl_vat') {
  const { agency, user, lead } = ids[kind]
  const r = await createQuoteSystem({ agencyId: agency, leadId: lead, createdByUserId: user, title: 'בדיקה', lines: Array.from({ length: n }, (_, i) => ({ title: `פריט ${i + 1}`, quantity: 1, unitAmount: 18500 })), priceBasis, finalize: true })
  if (r.ok === false) throw new Error('not created')
  const q = await db('sales_quotes').where({ id: r.quoteId }).first('subtotalAmount', 'taxAmount', 'totalAmount')
  const items = await db('sales_quote_items').where({ quoteId: r.quoteId }).orderBy('lineNumber').select('unitPrice', 'lineSubtotal', 'lineTaxAmount', 'lineTotal')
  const sum = (k: string) => Math.round(items.reduce((s, i) => s + Number(i[k]) * 100, 0)) / 100
  return { returned: r.totalAmount, header: [q.subtotalAmount, q.taxAmount, q.totalAmount].map(Number), sums: [sum('lineSubtotal'), sum('lineTaxAmount'), sum('lineTotal')], prices: new Set(items.map((i) => Number(i.unitPrice))), count: items.length, lastTax: Number(items.at(-1)!.lineTaxAmount) }
}

describe('stored totals equal computed totals, and the lines add up to the header', () => {
  it.each([
    ['registered', 'incl_vat', 1, [15677.97, 2822.03, 18500], 15677.97],
    ['registered', 'incl_vat', 2, [31355.94, 5644.07, 37000.01], 15677.97],
    ['registered', 'incl_vat', 12, [188135.64, 33864.42, 222000.06], 15677.97],
    ['registered', 'incl_vat', 50, [783898.5, 141101.73, 925000.23], 15677.97],
    ['registered', 'excl_vat', 1, [18500, 3330, 21830], 18500],
    ['registered', 'excl_vat', 2, [37000, 6660, 43660], 18500],
    ['registered', 'excl_vat', 12, [222000, 39960, 261960], 18500],
    ['registered', 'excl_vat', 50, [925000, 166500, 1091500], 18500],
    ['exempt', 'incl_vat', 1, [18500, 0, 18500], 18500],
    ['exempt', 'incl_vat', 2, [37000, 0, 37000], 18500],
    ['exempt', 'incl_vat', 12, [222000, 0, 222000], 18500],
    ['exempt', 'incl_vat', 50, [925000, 0, 925000], 18500],
    ['exempt', 'excl_vat', 12, [222000, 0, 222000], 18500],
  ] as const)('%s, %s, %i lines', async (kind, basis, n, header, unit) => {
    const s = await write(kind, n, basis)
    expect(s.header).toEqual(header)
    expect(s.returned).toBe(header[2])
    expect(s.sums).toEqual(header)
    expect(s.count).toBe(n)
    expect(s.prices).toEqual(new Set([unit]))
  })
})
