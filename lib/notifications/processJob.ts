import { db } from '@/config/db'
import type { RecipientContext } from '@/db/notifications/recipients'
import { recordDelivery } from '@/db/notifications/deliveries'
import { updateNotificationCopy, upsertCollapsedNotification } from '@/db/notifications/notifications'
import type { NotificationJob } from '@/db/notifications/jobs'
import { planNotification, rebuildCopyForGroupCount } from './plan'
import { IN_APP_ONLY_CAPABILITIES } from './policy'
import { classifyPresence } from './presence'
import type { Presence } from './types'

/**
 * Job execution — spec §3 steps 1–7, §10.
 *
 * Executes the plan produced by plan.ts and makes no decisions of its own. The
 * split exists so every decision is unit-testable without a database, which is
 * the only kind of test that can run in this repo today (spec §22.4).
 */

export type ProcessOutcome = { kind: 'done'; created: number } | { kind: 'skipped'; reason: string }

/**
 * P1 presence: everyone reads `offline`.
 *
 * Not a stub — a truthful reading. `user_presence` has exactly one writer, the
 * notification feed poll, and that is P2. Until a row exists, "when did this
 * user last look at the app" genuinely has no answer, and `classifyPresence`
 * answers `offline` for an absent row by design (spec §7.2).
 *
 * It changes nothing in P1: IN_APP appears in the offline column of every row of
 * the §19 matrix, and IN_APP is the only capability enabled. P2 replaces this
 * with a batched read of user_presence and the same plan code starts selecting
 * toast.
 */
const p1Presence = (): Presence => classifyPresence(null, new Date())

export async function processNotificationJob(job: NotificationJob, context: RecipientContext): Promise<ProcessOutcome> {
  const planned = planNotification({
    job,
    context,
    presence: p1Presence,
    capabilities: IN_APP_ONLY_CAPABILITIES,
    // No preference reader in P1: the table is empty, and an absent row means
    // "all defaults" (spec §17), which is exactly what `undefined` expresses.
    preferences: undefined,
  })

  if ('skip' in planned) return { kind: 'skipped', reason: planned.skip }
  const plan = planned.plan

  /**
   * One transaction per job, so a notification and its delivery record land
   * together. A notification with no delivery row would be unexplainable later
   * ("was this ever dispatched?"), and a delivery row with no notification would
   * be a dangling reference.
   */
  let created = 0
  await db.transaction(async (trx) => {
    for (const recipient of plan.recipients) {
      const result = await upsertCollapsedNotification(trx, {
        agencyId: job.agencyId,
        userId: recipient.userId,
        type: plan.type,
        category: plan.category,
        priority: plan.priority,
        title: recipient.title,
        body: recipient.body,
        entityType: plan.entityType,
        entityId: plan.entityId,
        deepLink: plan.deepLink,
        collapseKey: plan.collapseKey,
        metadata: plan.metadata,
      })

      // The database owns the count, so copy that depends on it is corrected
      // against the returned value rather than a guess made before the write.
      if (!result.inserted && result.groupCount > 1) {
        const rebuilt = rebuildCopyForGroupCount(plan.type, recipient.context, result.groupCount)
        if (rebuilt && (rebuilt.title !== recipient.title || rebuilt.body !== recipient.body)) {
          await updateNotificationCopy(trx, {
            id: result.id,
            agencyId: job.agencyId,
            userId: recipient.userId,
            title: rebuilt.title,
            body: rebuilt.body,
          })
        }
      }

      /**
       * A delivery row per channel — but only for a NEW row. An event absorbed
       * into an existing open notification is the same interruption the user
       * already has; recording a second in-app "delivery" for it would inflate
       * the delivery log without anything having been dispatched.
       */
      if (result.inserted) {
        for (const channel of recipient.channels) {
          await recordDelivery(trx, {
            notificationId: result.id,
            agencyId: job.agencyId,
            userId: recipient.userId,
            channel,
          })
        }
        created++
      }
    }
  })

  return { kind: 'done', created }
}
