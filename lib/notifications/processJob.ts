import { db } from '@/config/db'
import type { RecipientContext } from '@/db/notifications/recipients'
import {
  ensurePendingChannelDelivery,
  findChannelDelivery,
  markDeliveryFailed,
  markDeliverySent,
  markDeliverySuppressed,
  recordDelivery,
} from '@/db/notifications/deliveries'
import { updateNotificationCopy, upsertCollapsedNotification } from '@/db/notifications/notifications'
import type { NotificationJob } from '@/db/notifications/jobs'
import { planNotification, rebuildCopyForGroupCount } from './plan'
import { buildWorkerCapabilities } from './policy'
import { isNotificationsPushEnabled } from './flags'
import type { Presence } from './types'
import { buildPushPayload, deliverWebPush } from './webPush'

/**
 * Job execution — spec §3 steps 1–7, §10, §15.
 *
 * Executes the plan produced by plan.ts and makes no channel-policy decisions
 * of its own. Presence is injected (P3.0). WEB_PUSH dispatch (P3.2) goes through
 * `deliverWebPush` so this file never imports the web-push SDK.
 */

export type ProcessOutcome = { kind: 'done'; created: number } | { kind: 'skipped'; reason: string }

type PushWorkItem = {
  deliveryId: number
  agencyId: number
  userId: number
  notificationId: number
  title: string
  body: string | null
  deepLink: string
}

async function finalizeWebPushDelivery(work: PushWorkItem): Promise<void> {
  // Re-check terminal state so a concurrent/retried pass cannot double-send.
  const existing = await findChannelDelivery(db, {
    notificationId: work.notificationId,
    agencyId: work.agencyId,
    userId: work.userId,
    channel: 'web_push',
  })
  if (existing && (existing.status === 'sent' || existing.status === 'suppressed')) return

  const result = await deliverWebPush({
    agencyId: work.agencyId,
    userId: work.userId,
    pushEnabled: isNotificationsPushEnabled(),
    payload: buildPushPayload({
      notificationId: work.notificationId,
      title: work.title,
      body: work.body,
      deepLink: work.deepLink,
    }),
  })

  if (result.kind === 'sent') {
    await markDeliverySent(db, {
      id: work.deliveryId,
      agencyId: work.agencyId,
      userId: work.userId,
    })
    return
  }
  if (result.kind === 'suppressed') {
    await markDeliverySuppressed(db, {
      id: work.deliveryId,
      agencyId: work.agencyId,
      userId: work.userId,
      reason: result.reason,
    })
    return
  }
  if (result.kind === 'failed') {
    await markDeliveryFailed(db, {
      id: work.deliveryId,
      agencyId: work.agencyId,
      userId: work.userId,
      reason: result.reason,
    })
  }
}

export async function processNotificationJob(
  job: NotificationJob,
  context: RecipientContext,
  /**
   * Server-classified presence for each recipient. Built once per worker pass
   * from a batched read of `user_presence` — see `buildPresenceLookup`.
   */
  presence: (userId: number) => Presence,
): Promise<ProcessOutcome> {
  const capabilities = buildWorkerCapabilities()
  const planned = planNotification({
    job,
    context,
    presence,
    capabilities,
    // No preference reader yet: the table is empty, and an absent row means
    // "all defaults" (spec §17), which is exactly what `undefined` expresses.
    preferences: undefined,
  })

  if ('skip' in planned) return { kind: 'skipped', reason: planned.skip }
  const plan = planned.plan

  /**
   * One transaction per job for the notification row + channel delivery rows.
   * Provider I/O (web-push) runs AFTER commit so a network stall cannot hold a
   * DB transaction open. Pending web_push rows are completed (or resumed on
   * job retry) outside the transaction.
   */
  let created = 0
  const pushWork: PushWorkItem[] = []

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

      if (result.inserted) {
        for (const channel of recipient.channels) {
          if (channel === 'in_app') {
            await recordDelivery(trx, {
              notificationId: result.id,
              agencyId: job.agencyId,
              userId: recipient.userId,
              channel: 'in_app',
            })
          } else if (channel === 'web_push') {
            const delivery = await ensurePendingChannelDelivery(trx, {
              notificationId: result.id,
              agencyId: job.agencyId,
              userId: recipient.userId,
              channel: 'web_push',
            })
            if (delivery.status === 'pending' || delivery.status === 'failed') {
              pushWork.push({
                deliveryId: delivery.id,
                agencyId: job.agencyId,
                userId: recipient.userId,
                notificationId: result.id,
                title: recipient.title,
                body: recipient.body,
                deepLink: plan.deepLink,
              })
            }
          }
          // toast / email: not dispatched by the worker in P3.2
        }
        created++
      } else if (recipient.channels.includes('web_push')) {
        // Resume a pending/failed push left by a prior crash after insert.
        const delivery = await findChannelDelivery(trx, {
          notificationId: result.id,
          agencyId: job.agencyId,
          userId: recipient.userId,
          channel: 'web_push',
        })
        if (delivery && (delivery.status === 'pending' || delivery.status === 'failed')) {
          pushWork.push({
            deliveryId: delivery.id,
            agencyId: job.agencyId,
            userId: recipient.userId,
            notificationId: result.id,
            title: recipient.title,
            body: recipient.body,
            deepLink: plan.deepLink,
          })
        }
      }
    }
  })

  for (const work of pushWork) {
    try {
      await finalizeWebPushDelivery(work)
    } catch (err) {
      // Never let a provider exception fail the whole job after the
      // notification row already committed — record failure and continue.
      await markDeliveryFailed(db, {
        id: work.deliveryId,
        agencyId: work.agencyId,
        userId: work.userId,
        reason: String(err),
      }).catch(() => undefined)
      console.error('[notifications][web_push]', {
        notificationId: work.notificationId,
        userId: work.userId,
        reason: String(err),
      })
    }
  }

  return { kind: 'done', created }
}
