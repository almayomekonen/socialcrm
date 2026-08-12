import { describe, expect, it } from 'vitest'
import {
  countUserPushSubscriptionsQuery,
  deletePushSubscriptionQuery,
  upsertPushSubscriptionQuery,
} from '@/db/notifications/subscriptions'

/**
 * SQL-shape tests for push_subscriptions — P3.1. Spec §15.3, §20.5.
 * No database: `.toSQL()` only.
 */

const sqlOf = (q: { toSQL: () => { sql: string; bindings: readonly unknown[] } }) => {
  const { sql, bindings } = q.toSQL()
  return { sql, lower: sql.toLowerCase(), bindings }
}

const WRITE = {
  agencyId: 7,
  userId: 55,
  endpoint: 'https://fcm.googleapis.com/fcm/send/abc',
  p256dh: 'p256',
  auth: 'authkey',
  userAgent: 'Mozilla/5.0',
}

describe('upsertPushSubscriptionQuery — reassignment is deterministic', () => {
  it('inserts into push_subscriptions with session agencyId and userId bindings', () => {
    const { lower, bindings } = sqlOf(upsertPushSubscriptionQuery(WRITE))
    expect(lower).toContain('insert into push_subscriptions')
    expect(lower).toContain('on conflict (endpoint) do update')
    expect(bindings).toEqual(
      expect.arrayContaining([WRITE.agencyId, WRITE.userId, WRITE.endpoint, WRITE.p256dh, WRITE.auth, WRITE.userAgent]),
    )
  })

  it('ON CONFLICT reassigns agencyId and userId — never leaves a dual binding', () => {
    const { sql, lower } = sqlOf(upsertPushSubscriptionQuery(WRITE))
    expect(lower).toContain('on conflict (endpoint)')
    expect(sql).toMatch(/"agencyId"\s*=\s*EXCLUDED\."agencyId"/i)
    expect(sql).toMatch(/"userId"\s*=\s*EXCLUDED\."userId"/i)
    expect(sql).toMatch(/"p256dh"\s*=\s*EXCLUDED\."p256dh"/i)
    // A second INSERT without conflict would be the dual-bind failure mode.
    expect(lower.match(/insert into/g)?.length).toBe(1)
  })

  it('does not write phone, email, idNum, or users_info', () => {
    const { lower } = sqlOf(upsertPushSubscriptionQuery(WRITE))
    expect(lower).not.toMatch(/\bphone\b/)
    expect(lower).not.toMatch(/\bemail\b/)
    expect(lower).not.toMatch(/\bidnum\b/)
    expect(lower).not.toContain('users_info')
    expect(lower).not.toContain('notification_deliveries')
  })
})

describe('deletePushSubscriptionQuery — session-scoped', () => {
  it('deletes only rows matching agencyId AND userId AND endpoint', () => {
    const { lower, bindings } = sqlOf(
      deletePushSubscriptionQuery({
        agencyId: 7,
        userId: 55,
        endpoint: WRITE.endpoint,
      }),
    )
    expect(lower).toContain('delete')
    expect(lower).toContain('push_subscriptions')
    expect(lower).toContain('"agencyid"')
    expect(lower).toContain('"userid"')
    expect(lower).toContain('endpoint')
    expect(bindings).toEqual(expect.arrayContaining([7, 55, WRITE.endpoint]))
  })

  it('never deletes by endpoint alone', () => {
    const { lower, bindings } = sqlOf(
      deletePushSubscriptionQuery({ agencyId: 7, userId: 55, endpoint: WRITE.endpoint }),
    )
    // All three predicates must be present so another user's endpoint is untouched.
    expect(bindings.filter((b) => b === 7 || b === 55 || b === WRITE.endpoint).length).toBeGreaterThanOrEqual(3)
    expect(lower).toMatch(/where/)
  })
})

describe('countUserPushSubscriptionsQuery — tenant scoped', () => {
  it('counts with both agencyId and userId', () => {
    const { lower, bindings } = sqlOf(countUserPushSubscriptionsQuery({ agencyId: 7, userId: 55 }))
    expect(lower).toContain('push_subscriptions')
    expect(bindings).toEqual(expect.arrayContaining([7, 55]))
  })
})
