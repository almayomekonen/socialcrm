/**
 * Quote creation against a real Postgres: owner-stated lines, the shared
 * idempotent insert, quote numbering, configured-VAT refusal, and tenant +
 * lead-visibility isolation. Also pins the template path through the extracted
 * insert, and that invoice numbering is untouched by quote numbering.
 *
 * Run: npm run test:db -- __tests__/quotes/createQuote.db.test.ts
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { db } from '@/config/db'
import { Roles } from '@/types/roles'
import { createQuoteSystem, type CreateQuoteSystemInput } from '@/db/quotes/createQuote'
import { createQuoteFromTemplateSystem } from '@/db/quotes/quotes'
import { allocateNumberInTransaction } from '@/db/billing/numbering'

let agencyA = 0 // authorized, VAT_STD 18%
let agencyB = 0 // authorized, NO tax row
let agencyC = 0 // exempt, no tax row
let adminA = 0
let agentA = 0
let otherAgentA = 0
let adminB = 0
let adminC = 0
let leadA = 0 // owned by agentA
let leadB = 0
let leadC = 0
const NOW = Date.parse('2026-11-08T10:00:00Z')

async function syncSequence(seqName: string, table: string) {
  await db.raw(`SELECT setval(?, (SELECT COALESCE(MAX(id) + 1, 1) FROM ??), false)`, [seqName, table])
}

async function addUser(agencyId: number, role: Roles, name: string) {
  const [u] = await db('users').insert({ firstName: name, role, agencyId }).returning('id')
  return Number(u.id)
}

async function addLead(agencyId: number, userId: number, name: string) {
  const [row] = await db('clients')
    .insert({ firstName: name, lastName: 'כהן', phone: '0501234567', createdById: userId, agencyId, userId, status: 'new', lead: true })
    .returning('id')
  return Number(row.id)
}

const base = (over: Partial<CreateQuoteSystemInput> = {}): CreateQuoteSystemInput => ({
  agencyId: agencyA,
  leadId: leadA,
  createdByUserId: adminA,
  title: 'שיפוץ מטבח',
  lines: [{ title: 'שיפוץ מטבח', quantity: 1, unitAmount: 18500 }],
  priceBasis: 'incl_vat',
  nowMs: NOW,
  ...over,
})

beforeAll(async () => {
  await syncSequence('agencies_id_seq', 'agencies')
  await syncSequence('users_seq', 'users')
  await syncSequence('"Client_id_seq"', 'clients')
  const [a] = await db('agencies').insert({ name: '__quote_a__' }).returning('id')
  const [b] = await db('agencies').insert({ name: '__quote_b__' }).returning('id')
  const [c] = await db('agencies').insert({ name: '__quote_c__' }).returning('id')
  agencyA = Number(a.id)
  agencyB = Number(b.id)
  agencyC = Number(c.id)
  // businessType is not on the typed Agency record; set it directly.
  await db.raw(`UPDATE agencies SET "businessType" = 'authorized' WHERE id IN (?, ?)`, [agencyA, agencyB])
  await db.raw(`UPDATE agencies SET "businessType" = 'exempt' WHERE id = ?`, [agencyC])
  adminA = await addUser(agencyA, Roles.ADMIN, 'AdminA')
  agentA = await addUser(agencyA, Roles.AGNT, 'AgentA')
  otherAgentA = await addUser(agencyA, Roles.AGNT, 'OtherA')
  adminB = await addUser(agencyB, Roles.ADMIN, 'AdminB')
  adminC = await addUser(agencyC, Roles.ADMIN, 'AdminC')
  leadA = await addLead(agencyA, agentA, 'דוד')
  leadB = await addLead(agencyB, adminB, 'משה')
  leadC = await addLead(agencyC, adminC, 'רות')
  // bill_tax_rates survives the per-file truncation, so start and end clean.
  await db('bill_tax_rates').whereIn('agencyId', [agencyA, agencyB, agencyC]).del()
  await db('bill_tax_rates').insert({ agencyId: agencyA, code: 'VAT_STD', label: 'מע"מ', ratePercent: 18, country: 'IL', effectiveFrom: '2024-01-01' })
})

beforeEach(async () => {
  await db('sales_quotes').whereIn('agencyId', [agencyA, agencyB, agencyC]).del()
  await db('bill_numbering_sequences').whereIn('agencyId', [agencyA, agencyB, agencyC]).del()
})

afterAll(async () => {
  // Quote items RESTRICT their tax rate, so the quotes go first.
  await db('sales_quotes').whereIn('agencyId', [agencyA, agencyB, agencyC]).del()
  await db('bill_tax_rates').whereIn('agencyId', [agencyA, agencyB, agencyC]).del()
})

describe('createQuoteSystem — creation', () => {
  it('creates a draft with VAT-inclusive pricing that totals exactly what the owner said', async () => {
    const r = await createQuoteSystem(base())
    expect(r).toMatchObject({ ok: true, created: true, status: 'draft', quoteNumber: null, totalAmount: 18500 })
    if (!r.ok) return
    const q = await db('sales_quotes').where({ id: r.quoteId }).first()
    expect(q).toMatchObject({ agencyId: agencyA, leadId: leadA, templateId: null, status: 'draft', recipientNameSnapshot: 'דוד כהן', ownerUserId: agentA })
    expect(Number(q.totalAmount)).toBe(18500)
    expect(Number(q.subtotalAmount)).toBe(15677.97)
    expect(Number(q.taxAmount)).toBe(2822.03)
    expect(q.metadata.pricing).toEqual({ basis: 'incl_vat', ratePercent: 18, requestedTotal: 18500, exact: true })
    const items = await db('sales_quote_items').where({ quoteId: r.quoteId })
    expect(items).toHaveLength(1)
    expect(Number(items[0].lineTotal)).toBe(18500)
    expect(Number(items[0].taxRatePercentSnapshot)).toBe(18)
  })

  it('VAT-exclusive pricing adds the agency rate', async () => {
    const r = await createQuoteSystem(base({ priceBasis: 'excl_vat', lines: [{ title: 'עבודה', quantity: 2, unitAmount: 1000, discountAmount: 100 }] }))
    expect(r).toMatchObject({ ok: true, totalAmount: 2242 })
  })

  it('refuses an unstated VAT basis', async () => {
    expect(await createQuoteSystem(base({ priceBasis: null }))).toEqual({ ok: false, reason: 'vat_basis_required' })
    expect(await db('sales_quotes').where({ agencyId: agencyA }).count('* as n').first()).toMatchObject({ n: '0' })
  })

  it('an exempt business quotes 0% with no tax row and no basis', async () => {
    const r = await createQuoteSystem(base({ agencyId: agencyC, leadId: leadC, createdByUserId: adminC, priceBasis: null }))
    expect(r).toMatchObject({ ok: true, totalAmount: 18500 })
    if (!r.ok) return
    const q = await db('sales_quotes').where({ id: r.quoteId }).first('taxAmount')
    expect(Number(q.taxAmount)).toBe(0)
  })

  it('refuses when the agency has no configured VAT rate — never the 18% fallback', async () => {
    const r = await createQuoteSystem(base({ agencyId: agencyB, leadId: leadB, createdByUserId: adminB }))
    expect(r).toEqual({ ok: false, reason: 'tax_rate_missing' })
    expect(await db('sales_quotes').where({ agencyId: agencyB }).count('* as n').first()).toMatchObject({ n: '0' })
  })

  it('stores a validity date only when one is given', async () => {
    const without = await createQuoteSystem(base())
    const withDays = await createQuoteSystem(base({ validityDays: 14 }))
    const rows = await db('sales_quotes').whereIn('id', [without.ok ? without.quoteId : 0, withDays.ok ? withDays.quoteId : 0]).orderBy('id')
    expect(rows[0].expiresAt).toBeNull()
    expect(rows[1].expiresAt).not.toBeNull()
  })
})

describe('createQuoteSystem — the pinned total', () => {
  it('refuses with total_mismatch and writes nothing when the build differs from what was approved', async () => {
    expect(await createQuoteSystem(base({ expectedTotalAmount: 18499.99 }))).toEqual({ ok: false, reason: 'total_mismatch' })
    expect(await db('sales_quotes').where({ agencyId: agencyA }).count('* as n').first()).toMatchObject({ n: '0' })
  })

  it('refuses with rate_changed when the VAT rate moved since the card', async () => {
    expect(await createQuoteSystem(base({ expectedRatePercent: 17 }))).toEqual({ ok: false, reason: 'rate_changed' })
  })

  it('accepts the exact approved total', async () => {
    expect(await createQuoteSystem(base({ expectedTotalAmount: 18500, expectedRatePercent: 18 }))).toMatchObject({ ok: true })
  })
})

describe('createQuoteSystem — idempotency', () => {
  it('a retry with the same key returns the same quote and allocates no second number', async () => {
    const first = await createQuoteSystem(base({ automationKey: 'wa:act_1', finalize: true }))
    const again = await createQuoteSystem(base({ automationKey: 'wa:act_1', finalize: true }))
    expect(first).toMatchObject({ ok: true, created: true, status: 'ready', quoteNumber: 1 })
    expect(again).toMatchObject({ ok: true, created: false, status: 'ready', quoteNumber: 1 })
    expect(first.ok && again.ok && first.quoteId === again.quoteId).toBe(true)
    const seq = await db('bill_numbering_sequences').where({ agencyId: agencyA, kind: 'quote' }).first('nextValue')
    expect(Number(seq.nextValue)).toBe(2)
  })

  it('concurrent creates with one key produce exactly one quote and one number', async () => {
    const results = await Promise.all(Array.from({ length: 6 }, () => createQuoteSystem(base({ automationKey: 'wa:act_race', finalize: true }))))
    expect(results.every((r) => r.ok)).toBe(true)
    expect(results.filter((r) => r.ok && r.created)).toHaveLength(1)
    expect(new Set(results.map((r) => (r.ok ? r.quoteId : 0))).size).toBe(1)
    expect(await db('sales_quotes').where({ agencyId: agencyA }).count('* as n').first()).toMatchObject({ n: '1' })
    expect(await db('sales_quote_items').where({ agencyId: agencyA }).count('* as n').first()).toMatchObject({ n: '1' })
    const seq = await db('bill_numbering_sequences').where({ agencyId: agencyA, kind: 'quote' }).first('nextValue')
    expect(Number(seq.nextValue)).toBe(2)
  })

  it('the same key in another agency is a different quote', async () => {
    const a = await createQuoteSystem(base({ automationKey: 'wa:shared' }))
    const c = await createQuoteSystem(base({ agencyId: agencyC, leadId: leadC, createdByUserId: adminC, priceBasis: null, automationKey: 'wa:shared' }))
    expect(a.ok && c.ok && a.quoteId !== c.quoteId).toBe(true)
  })
})

describe('createQuoteSystem — numbering', () => {
  it('finalize numbers quotes 1, 2, 3 per agency per business year and sets ready', async () => {
    const n = []
    for (const k of ['a', 'b', 'c']) {
      const r = await createQuoteSystem(base({ automationKey: `wa:${k}`, finalize: true }))
      n.push(r.ok ? r.quoteNumber : null)
    }
    expect(n).toEqual([1, 2, 3])
    const q = await db('sales_quotes').where({ agencyId: agencyA, quoteNumber: 1 }).first()
    expect(q).toMatchObject({ status: 'ready', quoteYear: 2026 })
    expect(q.readyAt).not.toBeNull()
  })

  it('quote numbering leaves the invoice and receipt sequences untouched', async () => {
    await createQuoteSystem(base({ automationKey: 'wa:n1', finalize: true }))
    await createQuoteSystem(base({ automationKey: 'wa:n2', finalize: true }))
    const invoice = await db.transaction((trx) => allocateNumberInTransaction(trx, { agencyId: agencyA, year: 2026, kind: 'invoice' }))
    const receipt = await db.transaction((trx) => allocateNumberInTransaction(trx, { agencyId: agencyA, year: 2026, kind: 'receipt' }))
    expect(invoice).toBe(1)
    expect(receipt).toBe(1)
  })

  it('the allocator still refuses an unknown kind', async () => {
    await expect(
      db.transaction((trx) => allocateNumberInTransaction(trx, { agencyId: agencyA, year: 2026, kind: 'order' as never })),
    ).rejects.toThrow('billing.numbering.invalid_kind')
  })
})

describe('createQuoteSystem — isolation', () => {
  it('a lead from another agency resolves to lead_not_found', async () => {
    expect(await createQuoteSystem(base({ leadId: leadB }))).toEqual({ ok: false, reason: 'lead_not_found' })
  })

  it('a rep who cannot see the lead is refused; its owner and an admin are not', async () => {
    const denied = await createQuoteSystem(base({ createdByUserId: otherAgentA, visibility: { user: { role: Roles.AGNT }, gotPermIds: [otherAgentA] } }))
    expect(denied).toEqual({ ok: false, reason: 'lead_not_found' })
    const owner = await createQuoteSystem(base({ createdByUserId: agentA, visibility: { user: { role: Roles.AGNT }, gotPermIds: [agentA] } }))
    expect(owner).toMatchObject({ ok: true })
    const admin = await createQuoteSystem(base({ visibility: { user: { role: Roles.ADMIN }, gotPermIds: [] } }))
    expect(admin).toMatchObject({ ok: true })
  })
})

describe('database constraints for the new lifecycle', () => {
  it('a cancelled draft needs cancelledAt, but no number and no sentAt', async () => {
    const r = await createQuoteSystem(base())
    if (!r.ok) throw new Error('setup')
    await expect(db('sales_quotes').where({ id: r.quoteId }).update({ status: 'cancelled' })).rejects.toThrow()
    await db('sales_quotes').where({ id: r.quoteId }).update({ status: 'cancelled', cancelledAt: db.fn.now() })
    expect(await db('sales_quotes').where({ id: r.quoteId }).first('status')).toEqual({ status: 'cancelled' })
  })

  it('a sent quote still requires sentAt', async () => {
    const r = await createQuoteSystem(base({ automationKey: 'wa:s', finalize: true }))
    if (!r.ok) throw new Error('setup')
    await expect(db('sales_quotes').where({ id: r.quoteId }).update({ status: 'sent' })).rejects.toThrow()
  })

  it('sales_quote_documents allows one render in flight and one current PDF per quote', async () => {
    const r = await createQuoteSystem(base({ automationKey: 'wa:d', finalize: true }))
    if (!r.ok) throw new Error('setup')
    const doc = { agencyId: agencyA, quoteId: r.quoteId, path: 'tenants/x/quotes/1/a.pdf' }
    await db('sales_quote_documents').insert(doc)
    await expect(db('sales_quote_documents').insert({ ...doc, path: 'tenants/x/quotes/1/b.pdf' })).rejects.toThrow()
    await expect(db('sales_quote_documents').insert({ ...doc, status: 'ready', isCurrent: true })).rejects.toThrow() // ready without content
  })
})

describe('the template path still works through the extracted insert', () => {
  it('creates once per automation key', async () => {
    const [t] = await db('sales_quote_templates').insert({ agencyId: agencyA, createdByUserId: adminA, name: 'חבילה', title: 'חבילת אתר' }).returning('id')
    await db('sales_quote_template_items').insert({ templateId: t.id, agencyId: agencyA, lineNumber: 1, title: 'אתר', unitPrice: 4900 })
    const input = { agencyId: agencyA, leadId: leadA, templateId: Number(t.id), createdByUserId: adminA, automationKey: 'auto:1:1', nowMs: NOW }
    const first = await createQuoteFromTemplateSystem(input)
    const again = await createQuoteFromTemplateSystem(input)
    expect(first).toMatchObject({ ok: true, created: true })
    expect(again).toMatchObject({ ok: true, created: false })
    const q = await db('sales_quotes').where({ agencyId: agencyA, automationKey: 'auto:1:1' }).first()
    expect(q).toMatchObject({ status: 'draft', title: 'חבילת אתר' })
    expect(Number(q.templateId)).toBe(Number(t.id))
    expect(Number(q.totalAmount)).toBe(5782)
    expect(q.metadata).toEqual({})
    await db('sales_quotes').where({ agencyId: agencyA }).del()
    await db('sales_quote_templates').where({ id: t.id }).del()
  })
})
