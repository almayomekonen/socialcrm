/**
 * Comments Inbox read layer — SQL-shape tests.
 *
 * The repo's `.toSQL()` pattern (see __tests__/automations/queueDb.sql.test.ts):
 * no live database, but the real query builder, so the storage contract is
 * pinned exactly — including the one that matters most here, which is that a
 * tenant predicate is present on EVERY read path.
 */
import { describe, expect, it } from 'vitest'
import { db } from '@/config/db'
import {
  listPageCommentsQuery,
  countOpenCommentsQuery,
  listCommentRepliesQuery,
  listCommentPostsQuery,
  COMMENTS_PAGE_SIZE,
} from '@/modules/facebookComments/queries'

const AGENCY = 103

describe('listPageCommentsQuery — tenant isolation', () => {
  it('always filters by agencyId, on every status filter', () => {
    for (const status of ['open', 'converted', 'ignored', 'deleted', 'all'] as const) {
      const { sql, bindings } = listPageCommentsQuery(db, AGENCY, { status }).toSQL()
      expect(sql.toLowerCase()).toContain('"agencyid" = ?')
      expect(bindings).toContain(AGENCY)
    }
  })

  it('binds the agencyId it was given and nothing else', () => {
    const { bindings } = listPageCommentsQuery(db, AGENCY, {}).toSQL()
    expect(bindings).toContain(103)
    expect(bindings).not.toContain(999)
  })

  it('reads only from facebook_page_comments — no join can widen the tenant scope', () => {
    const { sql } = listPageCommentsQuery(db, AGENCY, {}).toSQL()
    expect(sql.toLowerCase()).toContain('from "facebook_page_comments"')
    expect(sql.toLowerCase()).not.toContain('join')
  })

  it('the open-count query is tenant-scoped too', () => {
    const { sql, bindings } = countOpenCommentsQuery(db, AGENCY).toSQL()
    expect(sql.toLowerCase()).toContain('"agencyid" = ?')
    expect(bindings).toContain(AGENCY)
  })
})

describe('listPageCommentsQuery — status filtering', () => {
  it('defaults to open comments only', () => {
    const { sql, bindings } = listPageCommentsQuery(db, AGENCY, {}).toSQL()
    expect(sql.toLowerCase()).toContain('"status" = ?')
    expect(bindings).toContain('open')
  })

  it.each(['converted', 'ignored', 'deleted'] as const)('filters to %s when asked', (status) => {
    const { bindings } = listPageCommentsQuery(db, AGENCY, { status }).toSQL()
    expect(bindings).toContain(status)
  })

  it('"all" excludes deleted tombstones rather than showing everything', () => {
    const { sql, bindings } = listPageCommentsQuery(db, AGENCY, { status: 'all' }).toSQL()
    expect(sql.toLowerCase()).toContain('not "status" = ?')
    expect(bindings).toContain('deleted')
  })

  it('a comment deleted on Facebook that produced a ליד stays under "all" and "converted", grouped inside the tenant filter', () => {
    for (const status of ['all', 'converted'] as const) {
      const { sql, bindings } = listPageCommentsQuery(db, AGENCY, { status }).toSQL()
      const s = sql.toLowerCase()
      expect(s).toContain('"convertedleadid" is not null')
      // The OR is parenthesised after the agency predicate — it cannot widen the tenant scope.
      expect(s).toMatch(/"agencyid" = \? and "authorispage" = \? and \(.*or.*"convertedleadid" is not null.*\)/)
      expect(bindings[0]).toBe(AGENCY)
    }
    const open = listPageCommentsQuery(db, AGENCY, { status: 'open' }).toSQL().sql.toLowerCase()
    expect(open).not.toContain('convertedleadid" is not null')
  })

  it('rejects an unknown status by falling back to open — no injection surface', () => {
    // A querystring is user input; an unrecognised value must not reach SQL.
    const { bindings } = listPageCommentsQuery(db, AGENCY, {
      status: "open'; DROP TABLE clients; --" as never,
    }).toSQL()
    expect(bindings).toContain('open')
    expect(bindings.join(' ')).not.toContain('DROP')
  })
})

describe('listPageCommentsQuery — ordering and pagination', () => {
  it('orders newest first, with id as the tiebreaker', () => {
    const { sql } = listPageCommentsQuery(db, AGENCY, {}).toSQL()
    const s = sql.toLowerCase()
    expect(s).toContain('order by "receivedat" desc, "id" desc')
  })

  it('fetches one more row than the page size to detect a next page', () => {
    const { bindings } = listPageCommentsQuery(db, AGENCY, {}).toSQL()
    expect(bindings).toContain(COMMENTS_PAGE_SIZE + 1)
  })

  it('clamps an absurd limit rather than trusting it', () => {
    const { bindings } = listPageCommentsQuery(db, AGENCY, { limit: 100000 }).toSQL()
    expect(bindings).not.toContain(100001)
    expect(bindings.some((b) => typeof b === 'number' && b > 1 && b <= 101)).toBe(true)
  })

  it('applies a keyset cursor as a tuple comparison', () => {
    const cursor = { receivedAt: '2026-08-11T00:00:00.000Z', id: 42 }
    const { sql, bindings } = listPageCommentsQuery(db, AGENCY, { cursor }).toSQL()
    expect(sql.toLowerCase()).toContain('("receivedat", id) < (?, ?)')
    expect(bindings).toContain(cursor.receivedAt)
    expect(bindings).toContain(42)
  })

  it('selects every column the UI renders', () => {
    const { sql } = listPageCommentsQuery(db, AGENCY, {}).toSQL()
    for (const col of [
      'commentId',
      'postId',
      'parentId',
      'isTopLevel',
      'authorName',
      'message',
      'messageAvailable',
      'status',
      'convertedLeadId',
      'createdTime',
      'receivedAt',
      'authorPictureUrl',
      'attachmentType',
      'attachmentUrl',
    ]) {
      expect(sql).toContain(`"${col}"`)
    }
  })
})

describe("Page-authored replies stay out of the work list", () => {
  it('the list excludes the Page\'s own comments on every status', () => {
    for (const status of ['open', 'converted', 'ignored', 'deleted', 'all'] as const) {
      const { sql, bindings } = listPageCommentsQuery(db, AGENCY, { status }).toSQL()
      expect(sql.toLowerCase()).toContain('"authorispage" = ?')
      expect(bindings).toContain(false)
    }
  })

  it('the open count excludes them too', () => {
    const { sql, bindings } = countOpenCommentsQuery(db, AGENCY).toSQL()
    expect(sql.toLowerCase()).toContain('"authorispage" = ?')
    expect(bindings).toContain(false)
  })
})

describe('listCommentRepliesQuery — thread read', () => {
  const roots = [
    { pageId: 'P1', commentId: 'C1' },
    { pageId: 'P2', commentId: 'C2' },
  ]

  it('is tenant-scoped and keyed by (pageId, parentId), never by comment id alone', () => {
    const { sql, bindings } = listCommentRepliesQuery(db, AGENCY, roots).toSQL()
    const s = sql.toLowerCase()
    expect(s).toContain('"agencyid" = ?')
    expect(s).toContain('("pageid", "parentid") in')
    expect(bindings).toEqual(expect.arrayContaining([AGENCY, 'P1', 'C1', 'P2', 'C2']))
    expect(s).not.toContain('join')
  })

  it('hides deleted replies and caps from the newest, so the latest reply is never the one dropped', () => {
    const { sql, bindings } = listCommentRepliesQuery(db, AGENCY, roots).toSQL()
    expect(sql.toLowerCase()).toContain('not "status" = ?')
    expect(bindings).toContain('deleted')
    expect(sql.toLowerCase()).toContain('order by coalesce("createdtime", "receivedat") desc, "id" desc')
  })
})

describe('listCommentPostsQuery — post context', () => {
  const keys = [{ pageId: 'P1', postId: 'P1_9' }]

  it('is tenant-scoped and keyed by (pageId, postId), a separate read — never a join on the list', () => {
    const { sql, bindings } = listCommentPostsQuery(db, AGENCY, keys).toSQL()
    expect(sql).toContain('from "facebook_page_posts"')
    expect(sql).toContain('"agencyId" = ?')
    expect(bindings[0]).toBe(AGENCY)
    expect(sql).toMatch(/\("pageId", "postId"\) in/)
    expect(sql.toLowerCase()).not.toContain('join')
  })

  it('never selects a token or anything beyond what the card renders', () => {
    const { sql } = listCommentPostsQuery(db, AGENCY, keys).toSQL()
    expect(sql).not.toMatch(/token/i)
  })

  it('the comments list itself still reads one table', () => {
    const { sql } = listPageCommentsQuery(db, AGENCY, {}).toSQL()
    expect(sql).not.toContain('facebook_page_posts')
  })
})
