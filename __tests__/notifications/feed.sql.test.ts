import { readFileSync } from 'fs'
import { resolve } from 'path'
import { describe, expect, it } from 'vitest'
import {
  countUnreadNotificationsQuery,
  FEED_ITEM_LIMIT,
  FEED_MAX_LIMIT,
  listNotificationsQuery,
  nextCursorFrom,
  summarizeAwayNotificationsQuery,
} from '@/db/notifications/feed'
import {
  clearAwayBoundaryQuery,
  PRESENCE_WRITE_THROTTLE_SECONDS,
  readPresenceQuery,
  stampPresenceQuery,
} from '@/db/notifications/presence'
import type { NotificationRow } from '@/modules/notifications/types'

/**
 * SQL-shape tests for the feed — spec §22.2, extending the technique already used
 * by queries.sql.test.ts. No database is touched.
 *
 * Isolation is asserted as a STRUCTURAL property of every statement rather than
 * demonstrated on one fixture: proving the predicate is in the SQL proves it for
 * all inputs, including the tenants nobody wrote a row for.
 */

const sqlOf = (q: { toSQL: () => { sql: string; bindings: readonly unknown[] } }) => {
  const { sql, bindings } = q.toSQL()
  return { sql, lower: sql.toLowerCase(), bindings }
}

const SCOPE = { agencyId: 7, userId: 55 }
const OTHER_USER = 56

describe('feed reads are scoped to a tenant AND a user (§20.1)', () => {
  it('the item list filters agencyId and userId', () => {
    const { lower, bindings } = sqlOf(listNotificationsQuery({ ...SCOPE, limit: FEED_ITEM_LIMIT }))
    expect(lower).toContain('"agencyid"')
    expect(lower).toContain('"userid"')
    expect(bindings).toContain(7)
    expect(bindings).toContain(55)
    expect(bindings).not.toContain(OTHER_USER)
  })

  it('the unread count filters agencyId and userId', () => {
    const { lower, bindings } = sqlOf(countUnreadNotificationsQuery(SCOPE))
    expect(lower).toContain('"agencyid"')
    expect(lower).toContain('"userid"')
    expect(bindings).toContain(7)
    expect(bindings).toContain(55)
  })

  it('the While-You-Were-Away aggregate filters agencyId and userId', () => {
    const { lower, bindings } = sqlOf(summarizeAwayNotificationsQuery({ ...SCOPE, since: new Date(0) }))
    expect(lower).toContain('"agencyid"')
    expect(lower).toContain('"userid"')
    expect(bindings).toContain(7)
    expect(bindings).toContain(55)
  })

  it('the presence read filters agencyId and userId', () => {
    const { lower, bindings } = sqlOf(readPresenceQuery(SCOPE))
    expect(lower).toContain('"agencyid"')
    expect(lower).toContain('"userid"')
    expect(bindings).toContain(7)
    expect(bindings).toContain(55)
  })

  it('the boundary clear filters agencyId and userId — never userId alone', () => {
    const { lower, bindings } = sqlOf(clearAwayBoundaryQuery(SCOPE))
    expect(lower).toContain('"agencyid"')
    expect(lower).toContain('"userid"')
    expect(bindings).toContain(7)
    expect(bindings).toContain(55)
  })

  it('NO feed statement joins another table — nothing can leak through a join', () => {
    /**
     * The whole hot path is single-table. P1 denormalizes rendered copy onto the
     * row, so there is no entity lookup to authorize and no join to get wrong.
     * If a later change introduces one, this test fails and forces the author to
     * think about authorization rather than discover it in review.
     */
    const statements = [
      listNotificationsQuery({ ...SCOPE, limit: 20 }),
      countUnreadNotificationsQuery(SCOPE),
      summarizeAwayNotificationsQuery({ ...SCOPE, since: new Date(0) }),
      readPresenceQuery(SCOPE),
      clearAwayBoundaryQuery(SCOPE),
    ]
    for (const s of statements) {
      expect(sqlOf(s).lower).not.toContain(' join ')
    }
  })
})

describe('the two unread metrics stay separate (P2.0 §11.1)', () => {
  it('the notification count reads the notifications table and the readAt predicate', () => {
    const { lower } = sqlOf(countUnreadNotificationsQuery(SCOPE))
    expect(lower).toContain('from "notifications"')
    expect(lower).toContain('"readat" is null')
    // It must NOT be counting conversations.
    expect(lower).not.toContain('inbox_conversations')
  })

  it('the feed does not reimplement the conversation metric', () => {
    /**
     * NAV BADGE NON-REGRESSION, part 1 of 2.
     *
     * db/notifications/feed.ts must contain no conversation counting of its own —
     * the number has to come from the existing inbox function or the nav badge's
     * meaning could drift. Part 2 (feedAssembly.test.ts) asserts the assembler
     * actually calls that function.
     */
    const source = readFileSync(resolve(process.cwd(), 'db/notifications/feed.ts'), 'utf8')
    expect(source).not.toContain('inbox_conversations')
    expect(source).not.toContain('inbox_conversation_reads')
  })
})

describe('presence stamp statement (§7.2)', () => {
  const stamp = () => sqlOf(stampPresenceQuery({ ...SCOPE, visible: true, awaySinceAt: null }))

  it('writes user_presence and never users_info', () => {
    const { lower } = stamp()
    expect(lower).toContain('insert into user_presence')
    expect(lower).not.toContain('users_info')
  })

  it('throttles in SQL via ON CONFLICT … WHERE, not in application code', () => {
    const { lower, bindings } = stamp()
    expect(lower).toContain('on conflict')
    expect(lower).toContain('do update')
    // The throttle predicate, and the interval it uses.
    expect(lower).toContain('interval')
    expect(bindings).toContain(PRESENCE_WRITE_THROTTLE_SECONDS)
  })

  it('lets a visibility change bypass the throttle', () => {
    // A tab going hidden IS the online→idle transition; suppressing that write
    // would keep a user classified as watching for up to 30 seconds.
    expect(stamp().lower).toContain('is distinct from')
  })

  it('never clobbers an open away boundary', () => {
    // COALESCE(existing, incoming) — the boundary has one opener and one closer.
    const { lower } = stamp()
    expect(lower).toContain('coalesce')
    expect(lower).toContain('"awaysinceat"')
  })

  it('carries agencyId in the conflict predicate, so a tenant cannot move another tenant row', () => {
    const { lower, bindings } = stamp()
    expect(lower).toContain('"agencyid"')
    expect(bindings).toContain(7)
  })
})

describe('While You Were Away query semantics (§13.3)', () => {
  const wywa = () => sqlOf(summarizeAwayNotificationsQuery({ ...SCOPE, since: new Date('2026-08-11T10:00:00Z') }))

  it('filters on seenAt IS NULL, NOT readAt — push does not stamp seenAt (§8.2)', () => {
    const { lower } = wywa()
    expect(lower).toContain('"seenat" is null')
    expect(lower).not.toContain('"readat" is null')
  })

  it('bounds the window by the persisted boundary', () => {
    const { lower, bindings } = wywa()
    expect(lower).toContain('"createdat" >')
    expect(bindings.some((b) => b instanceof Date)).toBe(true)
  })

  it('aggregates in SQL, one row per category — never counts a fetched array', () => {
    const { lower } = wywa()
    expect(lower).toContain('group by')
    expect(lower).toContain('"category"')
    expect(lower).toContain('count(')
  })
})

describe('pagination is keyset, and bounded', () => {
  it('orders by createdAt DESC with an id tiebreak, matching the index', () => {
    const { lower } = sqlOf(listNotificationsQuery({ ...SCOPE, limit: 20 }))
    expect(lower).toContain('order by')
    expect(lower).toContain('"createdat" desc')
    expect(lower).toContain('"id" desc')
  })

  it('a cursor becomes a row-value comparison, not an OFFSET', () => {
    const { lower } = sqlOf(
      listNotificationsQuery({ ...SCOPE, limit: 20, cursor: { createdAt: '2026-08-11T10:00:00.000Z', id: 900 } }),
    )
    expect(lower).toContain('("createdat", id) <')
    expect(lower).not.toContain('offset')
  })

  it('always applies a LIMIT — an unbounded feed read is not possible', () => {
    const { lower } = sqlOf(listNotificationsQuery({ ...SCOPE, limit: FEED_MAX_LIMIT }))
    expect(lower).toContain('limit')
  })

  it('nextCursor is null on a short page and set on a full one', () => {
    const item = (id: number): NotificationRow => ({
      id,
      type: 'lead.created',
      category: 'leads',
      priority: 'medium',
      title: 'ליד חדש',
      body: null,
      entityType: 'lead',
      entityId: id,
      deepLink: `/clients/${id}`,
      groupCount: 1,
      createdAt: '2026-08-11T10:00:00.000Z',
      seenAt: null,
      readAt: null,
    })
    expect(nextCursorFrom([item(1)], 20)).toBeNull()
    expect(nextCursorFrom([], 20)).toBeNull()
    expect(nextCursorFrom([item(1), item(2)], 2)).toEqual({ createdAt: '2026-08-11T10:00:00.000Z', id: 2 })
  })
})

describe('deep links target entities, never notifications (§20.2)', () => {
  it('the selected columns include deepLink and never expose a token or capability', () => {
    const { lower } = sqlOf(listNotificationsQuery({ ...SCOPE, limit: 20 }))
    expect(lower).toContain('"deeplink"')
    expect(lower).not.toContain('token')
    expect(lower).not.toContain('secret')
  })
})
