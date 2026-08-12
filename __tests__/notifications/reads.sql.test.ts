// seenAt / readAt writes — statement shape and input validation.
//
// These assert on generated SQL rather than on a database, because the properties
// that matter here are structural: every UPDATE is scoped to agencyId AND userId,
// each field is written first-write-wins, and readAt never drags seenAt with it.
//
// Runs without a database: `npm run test:notifications`.

import { describe, expect, it } from 'vitest'
import {
  MAX_MARK_IDS,
  markAllNotificationsReadQuery,
  markNotificationsReadQuery,
  markNotificationsSeenQuery,
  parseIds,
} from '@/db/notifications/reads'

const SCOPE = { agencyId: 42, userId: 7 }

function sqlOf(builder: { toSQL: () => { sql: string; bindings: readonly unknown[] } }) {
  const { sql, bindings } = builder.toSQL()
  return { sql, lower: sql.toLowerCase(), bindings: [...bindings] }
}

describe('mark seen — tenant and user isolation', () => {
  it('scopes the UPDATE to agencyId AND userId AND the id list', () => {
    const { lower, bindings } = sqlOf(markNotificationsSeenQuery({ ...SCOPE, ids: [1, 2] }))
    expect(lower).toContain('"agencyid"')
    expect(lower).toContain('"userid"')
    expect(lower).toContain('in (')
    expect(bindings).toContain(42)
    expect(bindings).toContain(7)
  })

  it('is idempotent: only rows with seenAt IS NULL are touched', () => {
    // First-write-wins. Re-surfacing must not move the timestamp, because "when did
    // the user first see this" is the question While-you-were-away asks.
    const { lower } = sqlOf(markNotificationsSeenQuery({ ...SCOPE, ids: [1] }))
    expect(lower).toContain('"seenat" is null')
  })

  it('writes seenAt and updatedAt, and nothing else', () => {
    const { lower } = sqlOf(markNotificationsSeenQuery({ ...SCOPE, ids: [1] }))
    expect(lower).toContain('set "seenat"')
    expect(lower).toContain('"updatedat"')
    // Seeing is not reading: it must not clear the badge or free the collapse key.
    expect(lower).not.toContain('"readat" =')
    expect(lower).not.toContain('"resolvedat"')
  })
})

describe('mark read — independent of seenAt', () => {
  it('scopes the UPDATE to agencyId AND userId', () => {
    const { lower, bindings } = sqlOf(markNotificationsReadQuery({ ...SCOPE, ids: [3] }))
    expect(lower).toContain('"agencyid"')
    expect(lower).toContain('"userid"')
    expect(bindings).toContain(42)
    expect(bindings).toContain(7)
  })

  it('sets readAt WITHOUT setting seenAt', () => {
    // A clicked web push sets readAt while seenAt stays null: the OS surfaced it,
    // SocialCRM did not. Collapsing the two would destroy that distinction.
    const { lower } = sqlOf(markNotificationsReadQuery({ ...SCOPE, ids: [3] }))
    expect(lower).toContain('set "readat"')
    expect(lower).not.toContain('"seenat" =')
  })

  it('only transitions rows that are still unread', () => {
    const { lower } = sqlOf(markNotificationsReadQuery({ ...SCOPE, ids: [3] }))
    expect(lower).toContain('"readat" is null')
  })

  it('never writes resolvedAt — resolution is business state, not a UI action', () => {
    expect(sqlOf(markNotificationsReadQuery({ ...SCOPE, ids: [3] })).lower).not.toContain('"resolvedat"')
    expect(sqlOf(markAllNotificationsReadQuery(SCOPE)).lower).not.toContain('"resolvedat"')
  })
})

describe('mark all read', () => {
  it('is scoped to one user in one agency and carries no id list', () => {
    const { lower, bindings } = sqlOf(markAllNotificationsReadQuery(SCOPE))
    expect(lower).toContain('"agencyid"')
    expect(lower).toContain('"userid"')
    expect(lower).toContain('"readat" is null')
    expect(lower).not.toContain('in (')
    expect(bindings).toEqual(expect.arrayContaining([42, 7]))
  })
})

describe('parseIds — the body is the only client input, so it is validated', () => {
  it('accepts a list of positive integers', () => {
    expect(parseIds([1, 2, 3])).toEqual([1, 2, 3])
  })

  it('de-duplicates', () => {
    expect(parseIds([5, 5, 6])).toEqual([5, 6])
  })

  it('rejects an empty list, a non-array, and non-numeric members', () => {
    expect(parseIds([])).toBeNull()
    expect(parseIds('1,2')).toBeNull()
    expect(parseIds(undefined)).toBeNull()
    expect(parseIds([1, 'x'])).toBeNull()
    expect(parseIds([1.5])).toBeNull()
  })

  it('rejects zero and negatives rather than coercing them', () => {
    expect(parseIds([0])).toBeNull()
    expect(parseIds([-3])).toBeNull()
  })

  it('rejects an oversized batch instead of truncating it', () => {
    // A caller asking to mark thousands of rows has misunderstood the endpoint;
    // silently trimming would hide that. mark-all-read exists for the bulk case.
    expect(parseIds(Array.from({ length: MAX_MARK_IDS }, (_, i) => i + 1))).toHaveLength(MAX_MARK_IDS)
    expect(parseIds(Array.from({ length: MAX_MARK_IDS + 1 }, (_, i) => i + 1))).toBeNull()
  })
})
