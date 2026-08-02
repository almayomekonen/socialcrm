import { describe, expect, it } from 'vitest'
import {
  getDefinitionQuery,
  listActiveDefinitionsForTriggerQuery,
  listDefinitionsQuery,
} from '@/db/automations/definitions'
import {
  countAutomatedTodayForAgencyQuery,
  countAutomatedTodayForLeadQuery,
  listActivityForAutomationQuery,
  updateDeliveryStateQuery,
} from '@/db/automations/activity'
import { addLeadSuppressionQuery, isLeadSuppressedQuery } from '@/db/automations/suppressions'
import { addEmailBlockQuery, isEmailBlockedQuery, normalizeEmail } from '@/db/automations/emailBlocks'

// SQL-shape tests for the record stores: definitions (soft delete, active
// lookup), activity (BUSINESS_TZ cap contract, monotonic delivery ladder),
// and the two permanent memories (suppressions, blocks).

const SINCE = new Date('2026-08-01T21:00:00Z') // a BUSINESS_TZ midnight, computed app-side

describe('automation_definitions shapes', () => {
  it('list excludes soft-deleted rows and is agency-scoped', () => {
    const { sql, bindings } = listDefinitionsQuery(7).toSQL()
    const s = sql.toLowerCase()
    expect(s).toContain('"agencyid" =')
    expect(s).toContain('"status"')
    expect(bindings).toContain('deleted')
    expect(bindings).toContain(7)
  })

  it('active-trigger lookup matches the partial index shape (status = active)', () => {
    const { sql, bindings } = listActiveDefinitionsForTriggerQuery(7, 'lead_created').toSQL()
    expect(sql.toLowerCase()).toContain('"status" =')
    expect(bindings).toContain('active')
    expect(bindings).toContain('lead_created')
    expect(bindings).toContain(7)
  })

  it('get is always agency-scoped (tenant isolation)', () => {
    const { sql, bindings } = getDefinitionQuery(7, 3).toSQL()
    expect(sql.toLowerCase()).toContain('"agencyid" =')
    expect(bindings).toEqual(expect.arrayContaining([7, 3]))
  })
})

describe('automation_activity shapes', () => {
  it('cap counts take the BUSINESS_TZ day start as a BINDING — never date_trunc in SQL', () => {
    for (const q of [countAutomatedTodayForAgencyQuery(7, SINCE), countAutomatedTodayForLeadQuery(7, 42, SINCE)]) {
      const { sql, bindings } = q.toSQL()
      const s = sql.toLowerCase()
      expect(s).not.toContain('date_trunc')
      expect(s).toContain('"occurredat" >=')
      expect(bindings).toContain(SINCE)
    }
  })

  it('cap counts include would_send — observation consumes eligibility (ADR-009)', () => {
    const { bindings } = countAutomatedTodayForAgencyQuery(7, SINCE).toSQL()
    expect(bindings).toContain('sent')
    expect(bindings).toContain('would_send')
  })

  it('log view is per-automation, newest first, bounded', () => {
    const { sql, bindings } = listActivityForAutomationQuery(7, 3, 100).toSQL()
    const s = sql.toLowerCase()
    expect(s).toContain('order by "occurredat" desc')
    expect(s).toContain('limit')
    expect(bindings).toEqual(expect.arrayContaining([7, 3, 100]))
  })

  it('delivery updates are monotonic: rank guard + sent-rows-only', () => {
    const { sql, bindings } = updateDeliveryStateQuery('msg_1', 'delivered').toSQL()
    const s = sql.toLowerCase()
    expect(s).toContain(`kind = 'sent'`)
    expect(s).toContain('case "deliverystate"')
    expect(s).toContain('< ')
    expect(bindings).toEqual(expect.arrayContaining(['msg_1', 'delivered', 2]))
  })

  it('a bounced row can never regress to delivered (rank order)', () => {
    // delivered ranks 2, bounced ranks 3 — an incoming 'delivered' carries
    // rank 2, and the SQL guard `current_rank < 2` excludes bounced (3).
    const { bindings } = updateDeliveryStateQuery('msg_1', 'delivered').toSQL()
    expect(bindings).toContain(2)
    const { bindings: b2 } = updateDeliveryStateQuery('msg_1', 'bounced').toSQL()
    expect(b2).toContain(3)
  })
})

describe('permanent memories', () => {
  it('suppression insert is idempotent on (agency, lead)', () => {
    const { sql } = addLeadSuppressionQuery(7, 42, 'unsubscribe_link').toSQL()
    expect(sql.toLowerCase()).toContain('on conflict ("agencyid","leadid") do nothing')
  })

  it('suppression lookup is tenant-scoped', () => {
    const { bindings } = isLeadSuppressedQuery(7, 42).toSQL()
    expect(bindings).toEqual(expect.arrayContaining([7, 42]))
  })

  it('email block insert is idempotent on (agency, normalized address)', () => {
    const { sql } = addEmailBlockQuery(7, 'a@b.co', 'hard_bounce').toSQL()
    expect(sql.toLowerCase()).toContain('on conflict ("agencyid","emailnormalized") do nothing')
  })

  it('normalizeEmail trims and lowercases (block keys are address-value keys)', () => {
    expect(normalizeEmail('  Dana@Example.COM ')).toBe('dana@example.com')
    const { bindings } = isEmailBlockedQuery(7, 'dana@example.com').toSQL()
    expect(bindings).toContain('dana@example.com')
  })
})
