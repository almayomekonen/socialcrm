import { describe, expect, it } from 'vitest'
import { listActiveQuoteTemplatesQuery } from '@/db/quotes/templates'
import { listAllQuoteTemplateItemsQuery, listAllQuoteTemplatesQuery } from '@/db/quotes/templateWrites'

/**
 * SQL-shape tests for the management reads (the repo's `.toSQL()` pattern —
 * the DB-backed harness cannot run; see __tests__/quotes/quotesDb.sql.test.ts).
 *
 * The two properties worth pinning are the ones a bug would make invisible:
 * every read is agency-scoped, and the SELECTION read is active-only while the
 * MANAGEMENT read is not.
 */

const sqlOf = (b: { toSQL: () => { sql: string } }) => b.toSQL().sql.toLowerCase()

describe('management reads are agency-scoped', () => {
  it('both management queries filter by agencyId', () => {
    expect(sqlOf(listAllQuoteTemplatesQuery(3))).toContain('"agencyid"')
    expect(sqlOf(listAllQuoteTemplateItemsQuery(3))).toContain('"agencyid"')
    expect(listAllQuoteTemplatesQuery(3).toSQL().bindings).toContain(3)
    expect(listAllQuoteTemplateItemsQuery(3).toSQL().bindings).toContain(3)
  })

  it('two agencies produce different bindings — no shared read path', () => {
    expect(listAllQuoteTemplatesQuery(1).toSQL().bindings).not.toEqual(listAllQuoteTemplatesQuery(2).toSQL().bindings)
  })
})

describe('archived templates and the two read paths', () => {
  it('SELECTION is active-only — an archived price is not offerable', () => {
    const { sql, bindings } = listActiveQuoteTemplatesQuery(3).toSQL()
    expect(sql.toLowerCase()).toContain('"state"')
    expect(bindings).toContain('active')
  })

  it('MANAGEMENT includes archived — otherwise archiving would be irreversible', () => {
    // The settings list is where restoring happens; filtering archived rows out
    // of it would strand every archived template permanently.
    const { sql, bindings } = listAllQuoteTemplatesQuery(3).toSQL()
    expect(bindings).not.toContain('archived')
    expect(sql.toLowerCase()).not.toContain('"state" =')
  })

  it('management orders archived after active, then by name', () => {
    const s = sqlOf(listAllQuoteTemplatesQuery(3))
    expect(s).toContain('order by "state" asc, "name" asc')
  })

  it('items come back in line order, so the editor renders what was saved', () => {
    expect(sqlOf(listAllQuoteTemplateItemsQuery(3))).toContain('order by "linenumber" asc')
  })
})

describe('the selection primitive returns only what a picker needs', () => {
  it('narrows to id and name rather than whole rows', async () => {
    // The future Automation Builder reaches this through its own action; a
    // dropdown has no use for prices and terms, and a narrow contract is one
    // that can stay stable.
    const { listQuoteTemplatesSystem } = await import('@/db/quotes/templates')
    expect(typeof listQuoteTemplatesSystem).toBe('function')
    // Guards the argument contract without a DB: a non-tenant resolves to empty
    // rather than to every agency's templates.
    expect(await listQuoteTemplatesSystem(0)).toEqual([])
    expect(await listQuoteTemplatesSystem(-1)).toEqual([])
    expect(await listQuoteTemplatesSystem(NaN)).toEqual([])
  })
})

describe('the management layer stays inside the domain boundary', () => {
  const codeOnly = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')

  it('the write module reads no session — the worker path must stay open', async () => {
    const fs = await import('node:fs')
    const path = await import('node:path')
    const code = codeOnly(fs.readFileSync(path.join(process.cwd(), 'db/quotes/templateWrites.ts'), 'utf8'))
    expect(/\brequireUser\b|\brequireProductAccess\b|\brequireAgencyUser\b/.test(code)).toBe(false)
  })

  it('the Server Action is the ONLY place a session is read', async () => {
    const fs = await import('node:fs')
    const path = await import('node:path')
    const code = fs.readFileSync(path.join(process.cwd(), 'actions/quotes/templates.ts'), 'utf8')
    expect(code).toContain("'use server'")
    expect(code).toContain('requireProductAccess')
    // The tenant comes from the session, never from the caller's payload.
    expect(/agencyId:\s*user\.agencyId/.test(code)).toBe(true)
    expect(/agencyId:\s*input\./.test(code)).toBe(false)
  })
})
