import { describe, expect, it } from 'vitest'
import { getQuoteTemplateSystem, listActiveQuoteTemplatesQuery } from '@/db/quotes/templates'

/**
 * THE INVARIANT THE FIRST-PARTY AUDIT ASKED FOR.
 *
 *   `listQuoteTemplatesSystem()` (what the Builder offers) and
 *   `getQuoteTemplateSystem()` (what an executor's preflight may use)
 *   must AGREE about archived templates.
 *
 * They are two functions by necessity — a picker needs a list, a preflight needs
 * one row with its items — so nothing but a test makes them agree. If they ever
 * drifted, a business could archive a price, watch it vanish from the Builder,
 * and still have an automation configured months earlier quote it.
 *
 * Proven from both sides without a database (the repo's harness cannot run):
 * the list side by the SQL it generates, the load side by driving the real
 * function with a stub executor.
 */

type Row = Record<string, unknown>

/**
 * A minimal knex-shaped stub. Only the three chains these functions use —
 * `.where().first()`, `.where().orderBy()`, `.where().orderBy().select()` — so
 * the real code runs unmodified against it.
 */
function stubExecutor(template: Row | undefined, items: Row[]) {
  const chain = (table: string) => {
    const rows = table === 'sales_quote_templates' ? (template ? [template] : []) : items
    const self: Record<string, unknown> = {
      where: () => self,
      first: async () => rows[0],
      orderBy: () => self,
      select: () => self,
      then: (resolve: (v: Row[]) => unknown) => resolve(rows),
    }
    return self
  }
  return chain as never
}

const template = (over: Row = {}): Row => ({
  id: 5,
  agencyId: 1,
  createdByUserId: 1,
  name: 'בניית אתר',
  title: 'הצעת מחיר',
  introText: '',
  termsText: '',
  currency: 'ILS',
  locale: 'he',
  validityDays: 14,
  state: 'active',
  metadata: {},
  createdAt: '2026-08-09',
  updatedAt: '2026-08-09',
  ...over,
})

const item = (): Row => ({
  id: 1,
  templateId: 5,
  agencyId: 1,
  lineNumber: 1,
  title: 'אתר',
  description: '',
  quantity: 1,
  unitPrice: 4900,
  discount: 0,
  isOptional: false,
  metadata: {},
  createdAt: '2026-08-09',
  updatedAt: '2026-08-09',
})

describe('the two read paths agree about ARCHIVED', () => {
  it('the OFFER path filters to active in SQL', () => {
    const { sql, bindings } = listActiveQuoteTemplatesQuery(1).toSQL()
    expect(sql.toLowerCase()).toContain('"state"')
    expect(bindings).toContain('active')
  })

  it('the USE path refuses an archived template', async () => {
    const loaded = await getQuoteTemplateSystem(1, 5, stubExecutor(template({ state: 'archived' }), [item()]))
    expect(loaded).toBeNull()
  })

  it('the USE path accepts an active one', async () => {
    const loaded = await getQuoteTemplateSystem(1, 5, stubExecutor(template(), [item()]))
    expect(loaded?.template.id).toBe(5)
    expect(loaded?.items).toHaveLength(1)
  })

  it('the USE path also refuses an EMPTY template — listed must mean usable', async () => {
    // A template with no lines would quote ₪0. Refusing it here is what keeps
    // "offered by the Builder" and "usable by an executor" the same set, since
    // the management layer already refuses to save one.
    expect(await getQuoteTemplateSystem(1, 5, stubExecutor(template(), []))).toBeNull()
  })

  it('a missing template is null, not a throw', async () => {
    expect(await getQuoteTemplateSystem(1, 5, stubExecutor(undefined, []))).toBeNull()
  })

  it('a non-tenant argument is refused before any read', async () => {
    expect(await getQuoteTemplateSystem(0, 5, stubExecutor(template(), [item()]))).toBeNull()
    expect(await getQuoteTemplateSystem(1, 0, stubExecutor(template(), [item()]))).toBeNull()
  })
})
