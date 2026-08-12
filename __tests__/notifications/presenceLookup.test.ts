// Worker presence lookup — P3.0. Pure + SQL-shape; no database.
//
// Pins: ONLINE/IDLE/OFFLINE from real rows, missing ⇒ OFFLINE, batch target
// collection, and that the worker presence path is SELECT-only.
//
// Runs in `npm run test:notifications`.

import { readFileSync } from 'fs'
import { resolve } from 'path'
import { describe, expect, it } from 'vitest'
import { loadPresenceBatchQuery } from '@/db/notifications/presence'
import type { RecipientContext } from '@/db/notifications/recipients'
import { IDLE_WINDOW_MS, ONLINE_WINDOW_MS, type PresenceRow } from '@/lib/notifications/presence'
import { collectPresenceTargets, presenceLookupFromRows } from '@/lib/notifications/presenceLookup'

const NOW = new Date('2026-08-11T12:00:00.000Z')
const ago = (ms: number) => new Date(NOW.getTime() - ms)

function context(over: Partial<RecipientContext> = {}): RecipientContext {
  return {
    handlerByLead: new Map(),
    adminsByAgency: new Map(),
    ...over,
  }
}

describe('collectPresenceTargets — one pass, every potential recipient', () => {
  it('includes handlers and admins, deduplicated', () => {
    const ctx = context({
      handlerByLead: new Map([
        ['7:100', 55],
        ['7:101', 55], // same handler, second lead
        ['7:102', null], // unassigned — no presence target from the lead
      ]),
      adminsByAgency: new Map([[7, [1, 2, 55]]]), // 55 is also a handler
    })
    const targets = collectPresenceTargets(ctx)
    expect(targets).toEqual(
      expect.arrayContaining([
        { agencyId: 7, userId: 1 },
        { agencyId: 7, userId: 2 },
        { agencyId: 7, userId: 55 },
      ]),
    )
    expect(targets).toHaveLength(3)
  })

  it('scopes each target to its own agency', () => {
    const ctx = context({
      handlerByLead: new Map([['9:50', 80]]),
      adminsByAgency: new Map([
        [7, [1]],
        [9, [2]],
      ]),
    })
    expect(collectPresenceTargets(ctx)).toEqual(
      expect.arrayContaining([
        { agencyId: 7, userId: 1 },
        { agencyId: 9, userId: 2 },
        { agencyId: 9, userId: 80 },
      ]),
    )
  })

  it('an empty context yields no targets — every recipient will classify OFFLINE', () => {
    expect(collectPresenceTargets(context())).toEqual([])
  })
})

describe('presenceLookupFromRows — the classification the worker hands to plan', () => {
  const row = (over: Partial<PresenceRow> & Pick<PresenceRow, 'lastSeenAt'>): PresenceRow => ({
    lastSeenVisible: true,
    ...over,
  })

  it('ONLINE: recent and visible — a feed-polling user is not offline', () => {
    const rows = new Map<number, PresenceRow>([[55, row({ lastSeenAt: ago(5_000), lastSeenVisible: true })]])
    expect(presenceLookupFromRows(rows, NOW)(55)).toBe('online')
  })

  it('IDLE: within the idle window but past the online window', () => {
    const rows = new Map<number, PresenceRow>([[55, row({ lastSeenAt: ago(ONLINE_WINDOW_MS + 1_000) })]])
    expect(presenceLookupFromRows(rows, NOW)(55)).toBe('idle')
  })

  it('IDLE: recent but the tab was hidden on the last poll', () => {
    const rows = new Map<number, PresenceRow>([[55, row({ lastSeenAt: ago(5_000), lastSeenVisible: false })]])
    expect(presenceLookupFromRows(rows, NOW)(55)).toBe('idle')
  })

  it('OFFLINE: stale past the idle window', () => {
    const rows = new Map<number, PresenceRow>([[55, row({ lastSeenAt: ago(IDLE_WINDOW_MS + 1_000) })]])
    expect(presenceLookupFromRows(rows, NOW)(55)).toBe('offline')
  })

  it('OFFLINE: missing presence row — fail-safe, never guessed online', () => {
    const rows = new Map<number, PresenceRow>()
    expect(presenceLookupFromRows(rows, NOW)(55)).toBe('offline')
  })

  it('boundary: just inside online stays online; at the online window becomes idle', () => {
    const justInside = new Map([[1, row({ lastSeenAt: ago(ONLINE_WINDOW_MS - 1) })]])
    const atBoundary = new Map([[1, row({ lastSeenAt: ago(ONLINE_WINDOW_MS) })]])
    expect(presenceLookupFromRows(justInside, NOW)(1)).toBe('online')
    expect(presenceLookupFromRows(atBoundary, NOW)(1)).toBe('idle')
  })

  it('boundary: just inside idle stays idle; at the idle window becomes offline', () => {
    const justInside = new Map([[1, row({ lastSeenAt: ago(IDLE_WINDOW_MS - 1) })]])
    const atBoundary = new Map([[1, row({ lastSeenAt: ago(IDLE_WINDOW_MS) })]])
    expect(presenceLookupFromRows(justInside, NOW)(1)).toBe('idle')
    expect(presenceLookupFromRows(atBoundary, NOW)(1)).toBe('offline')
  })

  it('a future lastSeenAt (clock skew) is treated as fresh online, not offline', () => {
    const rows = new Map([[1, row({ lastSeenAt: ago(-60_000) })]])
    expect(presenceLookupFromRows(rows, NOW)(1)).toBe('online')
  })

  it('two recipients can classify differently from the same snapshot', () => {
    const rows = new Map<number, PresenceRow>([
      [1, row({ lastSeenAt: ago(5_000), lastSeenVisible: true })],
      [2, row({ lastSeenAt: ago(IDLE_WINDOW_MS + 5_000) })],
    ])
    const presence = presenceLookupFromRows(rows, NOW)
    expect(presence(1)).toBe('online')
    expect(presence(2)).toBe('offline')
    expect(presence(3)).toBe('offline') // never loaded
  })
})

describe('loadPresenceBatchQuery — read-only and tenant-scoped', () => {
  it('is a SELECT, never a write', () => {
    const { sql } = loadPresenceBatchQuery([
      { agencyId: 7, userId: 55 },
      { agencyId: 7, userId: 56 },
    ]).toSQL()
    const lower = sql.toLowerCase()
    expect(lower).toContain('select')
    expect(lower).toContain('user_presence')
    expect(lower).not.toMatch(/\binsert\b/)
    expect(lower).not.toMatch(/\bupdate\b/)
    expect(lower).not.toMatch(/\bdelete\b/)
  })

  it('scopes with agencyId AND userId tuples — never userId alone', () => {
    const { sql, bindings } = loadPresenceBatchQuery([
      { agencyId: 7, userId: 55 },
      { agencyId: 9, userId: 80 },
    ]).toSQL()
    expect(sql).toContain('"agencyId"')
    expect(sql).toContain('"userId"')
    expect(bindings).toEqual([7, 55, 9, 80])
  })

  it('an empty pair list does not open the table', () => {
    const { sql } = loadPresenceBatchQuery([]).toSQL()
    expect(sql.toLowerCase()).toContain('where false')
  })
})

describe('the worker presence path never writes user_presence', () => {
  it('presenceLookup.ts and processJob.ts contain no stamp/clear/insert into user_presence', () => {
    const files = [
      'lib/notifications/presenceLookup.ts',
      'lib/notifications/processJob.ts',
      'lib/notifications/worker.ts',
    ]
    for (const file of files) {
      const src = readFileSync(resolve(process.cwd(), file), 'utf8')
      expect(src, file).not.toMatch(/stampPresence/)
      expect(src, file).not.toMatch(/clearAwayBoundary/)
      expect(src, file).not.toMatch(/INSERT\s+INTO\s+user_presence/i)
      expect(src, file).not.toMatch(/users_info/)
    }
  })

  it('p1Presence is gone — the placeholder that classified everyone offline', () => {
    const src = readFileSync(resolve(process.cwd(), 'lib/notifications/processJob.ts'), 'utf8')
    expect(src).not.toMatch(/p1Presence/)
    expect(src).toMatch(/presence:\s*\(userId:\s*number\)\s*=>\s*Presence/)
  })
})
