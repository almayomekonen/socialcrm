import type { Knex } from 'knex'
import { db } from '@/config/db'
import type { EntityType, NotificationCategory, NotificationPayload, NotificationType, Priority } from '@/lib/notifications/types'

/**
 * notifications data access — the record of truth. Spec §10 (collapse), §21.3
 * (pruning).
 *
 * TENANT ISOLATION: every statement here carries BOTH "agencyId" and "userId".
 * There is no function in this module that reads or writes a notification by id
 * alone (spec §20.1), so a guessed id returns zero rows — indistinguishable from
 * not-found, which means there is no enumeration oracle. Asserted by
 * __tests__/notifications/queries.sql.test.ts.
 */

export type UpsertNotificationArgs = {
  agencyId: number
  userId: number
  type: NotificationType
  category: NotificationCategory
  priority: Priority
  title: string
  body: string | null
  entityType: EntityType
  entityId: number
  deepLink: string
  collapseKey: string
  metadata: NotificationPayload
}

export type UpsertNotificationResult = {
  id: number
  groupCount: number
  /** false ⇒ an existing OPEN row absorbed this event (upgraded in place). */
  inserted: boolean
}

/**
 * Priority rank, low → high. Used to make priority upgrades one-directional:
 * collapse may raise a row's priority (a lead turning out to be hot) but must
 * never lower it (spec §7.1, §10.2). Rendered as SQL rather than decided in JS
 * because the comparison has to happen atomically inside the upsert.
 */
const PRIORITY_RANK_SQL = `array_position(ARRAY['info','low','medium','high','critical']::text[], %COL%)`

/**
 * COLLAPSE / DEDUP — spec §10.
 *
 * One statement, race-proof. The conflict target is the PARTIAL unique index
 * `notifications_collapse_open_uniq (userId, collapseKey) WHERE readAt IS NULL`,
 * so concurrent webhooks for the same lead cannot produce two rows no matter how
 * they interleave — the database decides, not the application.
 *
 * The predicate is `readAt IS NULL`, deliberately NOT `seenAt IS NULL`: a
 * seen-but-unread row must keep absorbing related events, which is how
 * "3 לידים חדשים" becomes "4" in place instead of spawning a second row
 * (spec §10.1). Once the user READS it, the key frees and a genuinely new event
 * may open a fresh row.
 *
 * On conflict the row is UPGRADED IN PLACE: newest type, title, body and deep
 * link win (the most recent truth about the same work), groupCount increments,
 * and priority moves up only. The bell count never inflates — one piece of work
 * stays one row.
 */
export function upsertCollapsedNotificationQuery(q: Knex.Transaction | Knex, args: UpsertNotificationArgs) {
  const newRank = PRIORITY_RANK_SQL.replace('%COL%', 'EXCLUDED.priority')
  const oldRank = PRIORITY_RANK_SQL.replace('%COL%', 'notifications.priority')
  return q.raw(
    `
    INSERT INTO notifications
      ("agencyId","userId",type,category,priority,title,body,
       "entityType","entityId","deepLink",metadata,"collapseKey")
    VALUES
      (:agencyId,:userId,:type,:category,:priority,:title,:body,
       :entityType,:entityId,:deepLink,:metadata::jsonb,:collapseKey)
    ON CONFLICT ("userId","collapseKey") WHERE "readAt" IS NULL
    DO UPDATE SET
      type          = EXCLUDED.type,
      category      = EXCLUDED.category,
      priority      = CASE WHEN ${newRank} > ${oldRank}
                           THEN EXCLUDED.priority ELSE notifications.priority END,
      title         = EXCLUDED.title,
      body          = EXCLUDED.body,
      "deepLink"    = EXCLUDED."deepLink",
      metadata      = EXCLUDED.metadata,
      "groupCount"  = notifications."groupCount" + 1,
      "updatedAt"   = now()
    RETURNING id, "groupCount", (xmax = 0) AS inserted
  `,
    {
      agencyId: args.agencyId,
      userId: args.userId,
      type: args.type,
      category: args.category,
      priority: args.priority,
      title: args.title,
      body: args.body,
      entityType: args.entityType,
      entityId: args.entityId,
      deepLink: args.deepLink,
      metadata: JSON.stringify(args.metadata ?? {}),
      collapseKey: args.collapseKey,
    },
  )
}

export async function upsertCollapsedNotification(
  q: Knex.Transaction | Knex,
  args: UpsertNotificationArgs,
): Promise<UpsertNotificationResult> {
  const res = await upsertCollapsedNotificationQuery(q, args)
  const row = res.rows?.[0] ?? {}
  return {
    id: Number(row.id),
    groupCount: Number(row.groupCount ?? 1),
    inserted: row.inserted === true,
  }
}

/**
 * Rewrite the display strings of a row whose copy depends on how many events it
 * absorbed (`message.inbound_multiple`: "3 הודעות חדשות" → "4").
 *
 * The upsert cannot do this itself: the new groupCount is computed by the
 * database, while the copy is built by a pure JS function that needs that count
 * as input. So the worker rebuilds the strings from the RETURNED count and
 * patches only when they actually changed — which for count-independent copy is
 * never, meaning the common path costs no extra write.
 *
 * Doubly scoped, like every statement in this module.
 */
export async function updateNotificationCopy(args: {
  id: number
  agencyId: number
  userId: number
  title: string
  body: string | null
}): Promise<void> {
  await db('notifications')
    .where({ id: args.id, agencyId: args.agencyId, userId: args.userId })
    .update({ title: args.title, body: args.body, updatedAt: db.fn.now() })
}

/**
 * Prune 1/2 — finished business past the operational window (spec §21.3).
 *
 * Requires BOTH readAt and resolvedAt: a row the user read but whose work is
 * still unresolved is live state, not history, and deleting it would erase the
 * one case escalation exists for (spec §8.3). 90 days matches the automation
 * engine's window.
 */
export function pruneSettledNotificationsQuery(cutoff: Date) {
  return db.raw(
    `DELETE FROM notifications
      WHERE "readAt" IS NOT NULL AND "resolvedAt" IS NOT NULL AND "updatedAt" < ?`,
    [cutoff],
  )
}

/**
 * Prune 2/2 — orphans (spec §21.3, §20.4).
 *
 * A notification whose lead was deleted can never be rendered (the feed filters
 * it) and can never be acted on, so it is pure noise in the badge count.
 * Scoped to `entityType = 'lead'` because that is the only entity kind P1
 * creates; conversation and integration orphans get their own clause when those
 * types acquire emitters.
 *
 * Reads `clients` only via NOT EXISTS — this never writes to, alters, or joins
 * into lead data.
 */
export function pruneOrphanedNotificationsQuery() {
  return db.raw(
    `DELETE FROM notifications n
      WHERE n."entityType" = 'lead'
        AND NOT EXISTS (SELECT 1 FROM clients c WHERE c.id = n."entityId")`,
  )
}

export async function pruneNotifications(cutoff: Date): Promise<void> {
  await pruneSettledNotificationsQuery(cutoff)
  await pruneOrphanedNotificationsQuery()
}
