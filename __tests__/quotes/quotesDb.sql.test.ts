import { describe, expect, it } from 'vitest'
import {
  findQuoteByAutomationKeyQuery,
  getQuoteByIdQuery,
  listQuoteItemsQuery,
  listQuotesForLeadQuery,
} from '@/db/quotes/quotes'
import { quoteRecipientQuery } from '@/db/quotes/recipient'
import {
  getQuoteTemplateQuery,
  listActiveQuoteTemplatesQuery,
  listQuoteTemplateItemsQuery,
} from '@/db/quotes/templates'
import { Roles } from '@/types/roles'

/**
 * SQL-shape tests. The repo's DB-backed harness cannot run — only `users` is
 * created by a knex migration, so `migrate.latest()` leaves `clients` and every
 * other base table absent (see __tests__/automations/queueDb.sql.test.ts and
 * __tests__/today/facts.sql.test.ts for the same pattern).
 *
 * What these pin is the storage CONTRACT: tenant scope on every read, lead
 * visibility on the join, and the idempotency lookup addressing the same key
 * the partial unique index is built on.
 */

const AGENT = { user: { role: Roles.AGNT }, gotPermIds: [7, 9] }
const ADMIN = { user: { role: Roles.ADMIN }, gotPermIds: [] }

const sqlOf = (b: { toSQL: () => { sql: string } }) => b.toSQL().sql.toLowerCase()

describe('quote reads are agency-scoped', () => {
  it('every read filters by agencyId', () => {
    expect(sqlOf(getQuoteByIdQuery(3, 12))).toContain('"agencyid"')
    expect(sqlOf(listQuoteItemsQuery(3, 12))).toContain('"agencyid"')
    expect(sqlOf(listActiveQuoteTemplatesQuery(3))).toContain('"agencyid"')
    expect(sqlOf(getQuoteTemplateQuery(3, 5))).toContain('"agencyid"')
    expect(sqlOf(listQuoteTemplateItemsQuery(3, 5))).toContain('"agencyid"')
    expect(sqlOf(quoteRecipientQuery(3, 42))).toContain('"agencyid"')
  })

  it('a wrong-tenant id cannot widen the result — the agency binding is present', () => {
    const { bindings } = getQuoteByIdQuery(3, 12).toSQL()
    expect(bindings).toContain(3)
    expect(bindings).toContain(12)
  })

  it('the template picker shows ACTIVE templates only', () => {
    const { sql, bindings } = listActiveQuoteTemplatesQuery(3).toSQL()
    expect(sql.toLowerCase()).toContain('"state"')
    expect(bindings).toContain('active')
  })
})

describe('quote visibility follows LEAD visibility', () => {
  it('joins the lead and scopes both sides by agency', () => {
    const s = sqlOf(listQuotesForLeadQuery(3, 42, AGENT))
    expect(s).toContain('inner join "clients"')
    expect(s).toContain('"q"."agencyid"')
    expect(s).toContain('"c"."agencyid"')
  })

  it('a non-admin is narrowed to the leads they can see', () => {
    const { sql, bindings } = listQuotesForLeadQuery(3, 42, AGENT).toSQL()
    expect(sql.toLowerCase()).toContain('"c"."userid" in')
    expect(bindings).toContain(7)
    expect(bindings).toContain(9)
  })

  it('an admin is NOT narrowed — the same rule scopedLeads applies', () => {
    expect(sqlOf(listQuotesForLeadQuery(3, 42, ADMIN))).not.toContain('"c"."userid" in')
  })

  it('newest first', () => {
    expect(sqlOf(listQuotesForLeadQuery(3, 42, AGENT))).toContain('order by "q"."createdat" desc')
  })
})

describe('the automation idempotency lookup', () => {
  it('addresses exactly the columns the partial unique index is built on', () => {
    // Index: UNIQUE ("agencyId","automationKey") WHERE "automationKey" IS NOT NULL.
    // A lookup on a different shape would find nothing and the executor would
    // create a second quote — the failure this whole key exists to prevent.
    const { sql, bindings } = findQuoteByAutomationKeyQuery(3, 'auto:8:lead:42:ever').toSQL()
    const s = sql.toLowerCase()
    expect(s).toContain('"agencyid"')
    expect(s).toContain('"automationkey"')
    expect(bindings).toEqual([3, 'auto:8:lead:42:ever', 1])
  })

  it('is scoped to one agency, so two tenants may hold the same opaque key', () => {
    const a = findQuoteByAutomationKeyQuery(1, 'k').toSQL().bindings
    const b = findQuoteByAutomationKeyQuery(2, 'k').toSQL().bindings
    expect(a).not.toEqual(b)
  })
})

describe('the quotation domain does not know what an automation is', () => {
  /**
   * Comments are stripped before matching (the `templates.test.tsx` precedent).
   * These files DISCUSS `requireUser` at length — explaining why a worker has
   * no session and therefore why the tenant is a parameter — and prose about a
   * rule is not a violation of it.
   */
  const codeOnly = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')

  const scanDomain = async (pattern: RegExp): Promise<string[]> => {
    const fs = await import('node:fs')
    const path = await import('node:path')
    const offenders: string[] = []
    for (const root of ['db/quotes', 'lib/quotes']) {
      const dir = path.join(process.cwd(), root)
      for (const file of fs.readdirSync(dir).filter((f) => /\.tsx?$/.test(f))) {
        const code = codeOnly(fs.readFileSync(path.join(dir, file), 'utf8'))
        if (pattern.test(code)) offenders.push(`${root}/${file}`)
      }
    }
    return offenders
  }

  it('no quote module imports from the automation layer', async () => {
    expect(await scanDomain(/from\s+['"]@\/(lib|db)\/automations/)).toEqual([])
  })

  it('no quote module reads a session — system primitives take agencyId explicitly', async () => {
    // A cron worker has no cookie. `requireUser()` baked into the data layer is
    // exactly why the billing data layer cannot be reused by the engine.
    expect(await scanDomain(/\brequireUser\b|\brequireProductAccess\b|\brequireAgencyUser\b/)).toEqual([])
  })

  it('no quote module parses the opaque automation key', async () => {
    // Storing and uniquely enforcing it is the contract. Splitting it, reading
    // an id out of it, or branching on its shape would make the sales domain
    // depend on the automation layer's identity scheme.
    expect(await scanDomain(/automationKey\s*\.\s*(split|match|replace|startsWith|slice)/)).toEqual([])
  })
})
