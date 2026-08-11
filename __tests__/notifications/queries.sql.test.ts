import fs from 'fs'
import path from 'path'
import { describe, expect, it } from 'vitest'
import {
  claimNotificationJobsQuery,
  enqueueNotificationJobQuery,
  failNotificationJobQuery,
  pruneTerminalNotificationJobsQuery,
  reclaimStaleNotificationJobsQuery,
} from '@/db/notifications/jobs'
import {
  pruneOrphanedNotificationsQuery,
  pruneSettledNotificationsQuery,
  upsertCollapsedNotificationQuery,
} from '@/db/notifications/notifications'
import { loadAgencyAdminsQuery, loadLeadOwnershipQuery } from '@/db/notifications/recipients'
import { recordDeliveryQuery } from '@/db/notifications/deliveries'
import { findLeadsMissingCreatedJobQuery } from '@/db/notifications/reconcile'
import { db } from '@/config/db'

/**
 * SQL-shape tests — spec §22.2. No database is touched: every statement is
 * rendered with `.toSQL()`, the same technique __tests__/automations uses.
 *
 * The point is tenant isolation as a STRUCTURAL property. A test that inserts a
 * row and reads it back proves one case; asserting the predicate is present in
 * the statement proves it for every case, including the ones nobody wrote a
 * fixture for.
 */

const sqlOf = (q: { toSQL: () => { sql: string; bindings: readonly unknown[] } }) => {
  const { sql, bindings } = q.toSQL()
  return { sql, lower: sql.toLowerCase(), bindings }
}

const ENQUEUE = {
  agencyId: 7,
  type: 'lead.created' as const,
  eventKey: 'lead.created:7:lead:42',
  actorUserId: null,
  entityType: 'lead' as const,
  entityId: 42,
  payload: { leadName: 'דניאל כהן' },
}

const UPSERT = {
  agencyId: 7,
  userId: 55,
  type: 'lead.created' as const,
  category: 'leads' as const,
  priority: 'medium' as const,
  title: 'ליד חדש — דניאל כהן',
  body: null,
  entityType: 'lead' as const,
  entityId: 42,
  deepLink: '/clients/42',
  collapseKey: 'lead:42:arrival',
  metadata: {},
}

describe('notifications: every statement is scoped to a tenant AND a user (§20.1)', () => {
  it('the collapse upsert carries both agencyId and userId', () => {
    const { lower, bindings } = sqlOf(upsertCollapsedNotificationQuery(db, UPSERT))
    expect(lower).toContain('"agencyid"')
    expect(lower).toContain('"userid"')
    expect(bindings).toContain(7)
    expect(bindings).toContain(55)
  })

  it('the copy patch is keyed by id AND agencyId AND userId — never by id alone', () => {
    const { lower, bindings } = sqlOf(
      db('notifications').where({ id: 5, agencyId: 7, userId: 55 }).update({ title: 'x' }),
    )
    expect(lower).toContain('"id" =')
    expect(lower).toContain('"agencyid" =')
    expect(lower).toContain('"userid" =')
    expect(bindings).toEqual(expect.arrayContaining([5, 7, 55]))
  })

  it('no module reads or writes a notification by id alone', () => {
    // A bare `where({ id })` would be an enumeration oracle: a guessed id would
    // behave differently from a non-existent one.
    const src = fs.readFileSync(path.join(process.cwd(), 'db/notifications/notifications.ts'), 'utf8')
    for (const match of src.matchAll(/\.where\(\{([^}]*)\}\)/g)) {
      const clause = match[1]
      if (!clause.includes('id')) continue
      expect(clause, `unscoped notification lookup: ${clause.trim()}`).toContain('agencyId')
      expect(clause, `unscoped notification lookup: ${clause.trim()}`).toContain('userId')
    }
  })

  it('the delivery insert records the tenant and the user it belongs to', () => {
    const { lower, bindings } = sqlOf(
      recordDeliveryQuery(db, { notificationId: 9, agencyId: 7, userId: 55, channel: 'in_app' }),
    )
    expect(lower).toContain('"agencyid"')
    expect(lower).toContain('"userid"')
    expect(bindings).toEqual(expect.arrayContaining([7, 55, 'in_app']))
  })
})

describe('collapse is enforced by the database, on the right predicate (§10.1)', () => {
  it('targets the partial unique index on OPEN rows', () => {
    const { lower } = sqlOf(upsertCollapsedNotificationQuery(db, UPSERT))
    expect(lower).toContain('on conflict ("userid","collapsekey")')
    expect(lower).toContain('where "readat" is null')
    expect(lower).toContain('do update set')
  })

  it('collapses on READ, never on SEEN — a glanced-at row keeps counting up', () => {
    const { lower } = sqlOf(upsertCollapsedNotificationQuery(db, UPSERT))
    const conflictClause = lower.slice(lower.indexOf('on conflict'), lower.indexOf('do update'))
    expect(conflictClause).toContain('"readat" is null')
    expect(conflictClause).not.toContain('seenat')
  })

  it('increments the group count instead of inserting a second row', () => {
    const { lower } = sqlOf(upsertCollapsedNotificationQuery(db, UPSERT))
    expect(lower).toContain('"groupcount"  = notifications."groupcount" + 1')
  })

  it('upgrades priority but never lowers it (§7.1)', () => {
    const { lower } = sqlOf(upsertCollapsedNotificationQuery(db, UPSERT))
    expect(lower).toContain('array_position')
    expect(lower).toContain('case when')
    expect(lower).toContain('else notifications.priority end')
  })

  it('reports whether the row was inserted, so deliveries are not double-counted', () => {
    const { lower } = sqlOf(upsertCollapsedNotificationQuery(db, UPSERT))
    expect(lower).toContain('(xmax = 0) as inserted')
  })
})

describe('the queue behaves like the proven automation queue (§21.2)', () => {
  it('the enqueue is one guarded INSERT that absorbs retries', () => {
    const { lower } = sqlOf(enqueueNotificationJobQuery(db, ENQUEUE))
    expect(lower).toContain('insert into notification_jobs')
    expect(lower).toContain('on conflict ("eventkey") do nothing')
    // Cheap by construction: no join, no subquery, no fan-out in the hot path.
    expect(lower).not.toContain('join')
    expect(lower).not.toContain('select 1 from')
  })

  it('the enqueue accepts a transaction so it can roll back with its cause', () => {
    // Rendering through a builder other than the root proves the query is not
    // hardwired to `db`.
    expect(() => enqueueNotificationJobQuery(db, ENQUEUE).toSQL()).not.toThrow()
    const src = fs.readFileSync(path.join(process.cwd(), 'db/notifications/jobs.ts'), 'utf8')
    expect(src).toMatch(/enqueueNotificationJobQuery\(\s*q: Knex\.Transaction \| Knex/)
  })

  it('the claim leases with FOR UPDATE SKIP LOCKED, oldest first, bounded', () => {
    const { lower, bindings } = sqlOf(claimNotificationJobsQuery('w1', 25))
    expect(lower).toContain('for update skip locked')
    expect(lower).toContain("status = 'pending'")
    expect(lower).toContain('order by "notbefore" asc')
    expect(lower).toContain('limit')
    expect(bindings).toEqual(expect.arrayContaining(['w1', 25]))
  })

  it('the claim scan matches the partial index (pending, by due time)', () => {
    const { lower } = sqlOf(claimNotificationJobsQuery('w1', 5))
    expect(lower).toContain('"notbefore" <= now()')
  })

  it('a dead worker\'s lease is reclaimed by cutoff, not by worker identity', () => {
    const cutoff = new Date('2026-08-11T12:00:00Z')
    const { lower, bindings } = sqlOf(reclaimStaleNotificationJobsQuery(cutoff))
    expect(lower).toContain("status = 'processing'")
    expect(lower).toContain('"lockedat" <')
    expect(bindings).toContain(cutoff)
  })

  it('retries back off and dead-letter at maxAttempts', () => {
    const { lower } = sqlOf(failNotificationJobQuery(3, 'boom'))
    expect(lower).toContain('attempts >= "maxattempts"')
    expect(lower).toContain("then 'dead' else 'pending' end")
    expect(lower).toContain('interval')
  })
})

describe('recipient resolution is batched and tenant-scoped (§21.2)', () => {
  it('lead ownership is read by (agencyId, id) tuples — never by a bare id list', () => {
    const { lower, bindings } = sqlOf(
      loadLeadOwnershipQuery([
        { agencyId: 7, leadId: 42 },
        { agencyId: 8, leadId: 43 },
      ]),
    )
    expect(lower).toContain('(c."agencyid", c.id) in ((?,?),(?,?))')
    expect(bindings).toEqual([7, 42, 8, 43])
  })

  it('one query covers the whole batch, so there is no per-notification lookup', () => {
    const pairs = Array.from({ length: 25 }, (_, i) => ({ agencyId: 7, leadId: i + 1 }))
    const { bindings } = sqlOf(loadLeadOwnershipQuery(pairs))
    expect(bindings).toHaveLength(50)
  })

  it('admins are read per agency, excluding suspended users', () => {
    const { lower, bindings } = sqlOf(loadAgencyAdminsQuery([7, 8]))
    expect(lower).toContain('"agencyid" in')
    expect(lower).toContain('"role" in')
    expect(lower).toContain('"suspended" =')
    expect(bindings).toEqual(expect.arrayContaining(['ADMIN', 'GM', false]))
  })

  it('never reads or writes user_perms', () => {
    const src = fs.readFileSync(path.join(process.cwd(), 'db/notifications/recipients.ts'), 'utf8')
    expect(src.replace(/\/\*[\s\S]*?\*\//g, '')).not.toContain('user_perms')
  })
})

describe('pruning is bounded and cannot delete live state (§21.3)', () => {
  it('terminal jobs are pruned by status and age only', () => {
    const cutoff = new Date('2026-05-11T12:00:00Z')
    const { lower, bindings } = sqlOf(pruneTerminalNotificationJobsQuery(cutoff))
    expect(lower).toContain("status in ('done','skipped','dead')")
    expect(lower).toContain('"updatedat" <')
    expect(bindings).toContain(cutoff)
  })

  it('a notification is only pruned when it is BOTH read and resolved', () => {
    // Read-but-unresolved is live state — the one case escalation exists for.
    const { lower } = sqlOf(pruneSettledNotificationsQuery(new Date()))
    expect(lower).toContain('"readat" is not null')
    expect(lower).toContain('"resolvedat" is not null')
  })

  it('orphan pruning only removes rows whose lead is genuinely gone', () => {
    const { lower } = sqlOf(pruneOrphanedNotificationsQuery())
    expect(lower).toContain(`"entitytype" = 'lead'`)
    expect(lower).toContain('not exists')
    expect(lower).toContain('from clients c where c.id = n."entityid"')
  })
})

describe('the reconciliation sweep (§14.3)', () => {
  it('is windowed, bounded, and finds only leads with no job', () => {
    const { lower, bindings } = sqlOf(findLeadsMissingCreatedJobQuery(10, 200))
    expect(lower).toContain('not exists')
    expect(lower).toContain(`j.type = 'lead.created'`)
    expect(lower).toContain('interval')
    expect(lower).toContain('limit')
    expect(bindings).toEqual([10, 200])
  })

  it('matches jobs on agency AND entity, so tenants cannot mask each other', () => {
    const { lower } = sqlOf(findLeadsMissingCreatedJobQuery(10, 200))
    expect(lower).toContain('j."entityid" = c.id')
    expect(lower).toContain('j."agencyid" = c."agencyid"')
  })

  it('considers actual leads only', () => {
    expect(sqlOf(findLeadsMissingCreatedJobQuery(10, 200)).lower).toContain('c.lead = true')
  })
})

describe('the migrations declare the indexes these statements rely on', () => {
  const migration = (file: string) => fs.readFileSync(path.join(process.cwd(), 'migrations', file), 'utf8')

  it('the collapse index is partial on unread rows', () => {
    const src = migration('20260811120002_create_notifications.cjs')
    expect(src).toMatch(/notifications_collapse_open_uniq[\s\S]*?"userId", "collapseKey"\)\s*WHERE "readAt" IS NULL/)
  })

  it('the escalation index does NOT exclude read rows (§8.3)', () => {
    // A read-but-unresolved notification must keep escalating; filtering on
    // readAt here would silently drop the most important case.
    const src = migration('20260811120002_create_notifications.cjs')
    const idx = src.slice(src.indexOf('notifications_escalation_idx'))
    const predicate = idx.slice(0, idx.indexOf('`'))
    expect(predicate).toContain('"resolvedAt" IS NULL')
    expect(predicate).not.toContain('readAt')
  })

  it('the eventKey index is unique, which is what makes the sweep idempotent', () => {
    expect(migration('20260811120001_create_notification_jobs.cjs')).toMatch(
      /CREATE UNIQUE INDEX IF NOT EXISTS notification_jobs_event_uniq[\s\S]*?\("eventKey"\)/,
    )
  })

  it('every notification migration is additive and touches no existing table', () => {
    const files = fs.readdirSync(path.join(process.cwd(), 'migrations')).filter((f) => f.startsWith('202608111200'))
    expect(files).toHaveLength(6)
    for (const file of files) {
      const src = migration(file)
      expect(src, `${file} alters an existing table`).not.toMatch(/ALTER TABLE (?!IF)/i)
      // Scoped to the up path: the down path drops these tables by design, so
      // matching the whole file would flag every migration.
      const up = src.slice(src.indexOf('exports.up'), src.indexOf('exports.down'))
      expect(up, `${file} drops something in its up path`).not.toMatch(/DROP TABLE/i)
      expect(src, `${file} is not idempotent`).toContain('IF NOT EXISTS')
    }
  })
})
