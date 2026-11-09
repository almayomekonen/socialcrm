/**
 * A write that fails partway leaves nothing: no header, no items, no number.
 * The failure is injected AFTER the header and items are inserted, which is the
 * latest point a partial quote could exist.
 *
 * Run: npm run test:db -- __tests__/quotes/createQuoteAtomic.db.test.ts
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ fail: false }))
vi.mock('@/db/billing/numbering', async (orig) => {
  const real = await orig<typeof import('@/db/billing/numbering')>()
  return {
    ...real,
    allocateNumberInTransaction: async (...args: Parameters<typeof real.allocateNumberInTransaction>) => {
      if (h.fail) {
        const items = await args[0]('sales_quote_items').where({ agencyId: args[1].agencyId })
        expect(items.length).toBeGreaterThan(0) // the items really were written first
        throw new Error('injected numbering failure')
      }
      return real.allocateNumberInTransaction(...args)
    },
  }
})

import { db } from '@/config/db'
import { createQuoteSystem } from '@/db/quotes/createQuote'

let agencyId = 0
let userId = 0
let leadId = 0

beforeAll(async () => {
  await db.raw(`SELECT setval('agencies_id_seq', (SELECT COALESCE(MAX(id) + 1, 1) FROM agencies), false)`)
  await db.raw(`SELECT setval('users_seq', (SELECT COALESCE(MAX(id) + 1, 1) FROM users), false)`)
  await db.raw(`SELECT setval('"Client_id_seq"', (SELECT COALESCE(MAX(id) + 1, 1) FROM clients), false)`)
  const [a] = await db('agencies').insert({ name: '__quote_atomic__' }).returning('id')
  agencyId = Number(a.id)
  await db.raw(`UPDATE agencies SET "businessType" = 'authorized' WHERE id = ?`, [agencyId])
  const [u] = await db('users').insert({ firstName: 'A', role: 'ADMIN', agencyId } as never).returning('id')
  userId = Number(u.id)
  const [c] = await db('clients').insert({ firstName: 'דוד', lastName: 'כהן', createdById: userId, agencyId, userId, status: 'new', lead: true }).returning('id')
  leadId = Number(c.id)
  await db('bill_tax_rates').insert({ agencyId, code: 'VAT_STD', label: 'מע"מ', ratePercent: 18, country: 'IL', effectiveFrom: '2024-01-01' })
})

afterAll(async () => {
  await db('sales_quotes').where({ agencyId }).del()
  await db('bill_numbering_sequences').where({ agencyId }).del()
  await db('bill_tax_rates').where({ agencyId }).del()
  await db('clients').where({ agencyId }).del()
  await db('users').where({ agencyId }).del()
  await db('agencies').where({ id: agencyId }).del()
  await db.destroy()
})

describe('rollback', () => {
  const input = () => ({ agencyId, leadId, createdByUserId: userId, title: 'שיפוץ', lines: Array.from({ length: 3 }, () => ({ title: 'פריט', quantity: 1, unitAmount: 100 })), priceBasis: 'excl_vat' as const, automationKey: 'wa_quote:act_atomic', finalize: true })

  it('a failure after the items are written leaves no quote, no items and no number', async () => {
    h.fail = true
    await expect(createQuoteSystem(input())).rejects.toThrow('injected numbering failure')
    h.fail = false
    expect(await db('sales_quotes').where({ agencyId })).toHaveLength(0)
    expect(await db('sales_quote_items').where({ agencyId })).toHaveLength(0)
    expect(await db('bill_numbering_sequences').where({ agencyId, kind: 'quote' })).toHaveLength(0)
  })

  it('the same key then succeeds cleanly, with number 1 and every line', async () => {
    const r = await createQuoteSystem(input())
    expect(r).toMatchObject({ ok: true, created: true, status: 'ready', quoteNumber: 1 })
    expect(await db('sales_quote_items').where({ agencyId })).toHaveLength(3)
  })
})
