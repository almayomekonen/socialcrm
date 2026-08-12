/**
 * Web Push delivery adapter — P3.2. Spec §15.2–15.4, §18.3, §20.5.
 *
 * Isolates the `web-push` library from the worker. processJob calls
 * `deliverWebPush` and never imports the provider SDK.
 *
 * One channel-level delivery outcome per notification (not per device). Every
 * active subscription for the recipient's (agencyId, userId) is attempted;
 * 404/410 removes that subscription; transient errors leave it in place.
 */

import webpush from 'web-push'
import {
  deletePushSubscriptionById,
  listPushSubscriptionsForUser,
  touchPushSubscriptionUsed,
  type PushSubscriptionRow,
} from '@/db/notifications/subscriptions'
import { getVapidAuth } from './vapidAuth'

export type PushPayload = {
  notificationId: number
  title: string
  body: string | null
  deepLink: string
}

export type WebPushDeliverResult =
  | { kind: 'sent'; deviceCount: number; removedDead: number }
  | { kind: 'failed'; reason: string; transient: boolean; removedDead: number }
  | { kind: 'suppressed'; reason: 'no_subscription' | 'not_configured' | 'push_disabled' }
  | { kind: 'skipped'; reason: 'already_terminal' }

/** Spec §15.4 — only these four fields leave the server. */
export function buildPushPayload(args: {
  notificationId: number
  title: string
  body: string | null
  deepLink: string
}): PushPayload {
  return {
    notificationId: args.notificationId,
    title: args.title,
    body: args.body,
    deepLink: args.deepLink,
  }
}

export function pushPayloadJson(payload: PushPayload): string {
  return JSON.stringify({
    notificationId: payload.notificationId,
    title: payload.title,
    body: payload.body ?? '',
    deepLink: payload.deepLink,
  })
}

/** Permanent = subscription must be removed (spec §15.3). */
export function isPermanentPushFailure(err: unknown): boolean {
  const status = (err as { statusCode?: number })?.statusCode
  return status === 404 || status === 410
}

export type DeliverWebPushArgs = {
  agencyId: number
  userId: number
  payload: PushPayload
  /** When false, no provider call — caller still records suppression. */
  pushEnabled: boolean
}

export type WebPushDeps = {
  listSubscriptions: typeof listPushSubscriptionsForUser
  deleteSubscription: typeof deletePushSubscriptionById
  touchUsed: typeof touchPushSubscriptionUsed
  send: (sub: PushSubscriptionRow, body: string, vapid: { publicKey: string; privateKey: string; subject: string }) => Promise<void>
  getAuth: typeof getVapidAuth
}

const defaultSend: WebPushDeps['send'] = async (sub, body, vapid) => {
  webpush.setVapidDetails(vapid.subject, vapid.publicKey, vapid.privateKey)
  await webpush.sendNotification(
    {
      endpoint: sub.endpoint,
      keys: { p256dh: sub.p256dh, auth: sub.auth },
    },
    body,
    { TTL: 60 * 60 },
  )
}

const defaultDeps: WebPushDeps = {
  listSubscriptions: listPushSubscriptionsForUser,
  deleteSubscription: deletePushSubscriptionById,
  touchUsed: touchPushSubscriptionUsed,
  send: defaultSend,
  getAuth: getVapidAuth,
}

/**
 * Deliver one WEB_PUSH channel attempt to every device owned by the recipient.
 * Never looks up by endpoint alone — always (agencyId, userId).
 */
export async function deliverWebPush(
  args: DeliverWebPushArgs,
  deps: WebPushDeps = defaultDeps,
): Promise<WebPushDeliverResult> {
  if (!args.pushEnabled) return { kind: 'suppressed', reason: 'push_disabled' }

  const auth = deps.getAuth()
  if (!auth) return { kind: 'suppressed', reason: 'not_configured' }

  const subs = await deps.listSubscriptions({
    agencyId: args.agencyId,
    userId: args.userId,
  })
  if (subs.length === 0) return { kind: 'suppressed', reason: 'no_subscription' }

  const body = pushPayloadJson(args.payload)
  let sent = 0
  let removedDead = 0
  let lastTransient: string | null = null

  for (const sub of subs) {
    // Defence in depth: never use a row that somehow escaped the scoped query.
    if (sub.agencyId !== args.agencyId || sub.userId !== args.userId) continue

    try {
      await deps.send(sub, body, auth)
      sent++
      await deps.touchUsed({ id: sub.id, agencyId: args.agencyId, userId: args.userId }).catch(() => undefined)
    } catch (err) {
      if (isPermanentPushFailure(err)) {
        const n = await deps.deleteSubscription({
          id: sub.id,
          agencyId: args.agencyId,
          userId: args.userId,
        })
        if (n > 0) removedDead++
      } else {
        lastTransient = String((err as { message?: string })?.message ?? err)
      }
    }
  }

  if (sent > 0) return { kind: 'sent', deviceCount: sent, removedDead }

  if (removedDead > 0 && removedDead === subs.length) {
    return { kind: 'failed', reason: 'subscription_gone', transient: false, removedDead }
  }

  return {
    kind: 'failed',
    reason: lastTransient ?? (removedDead > 0 ? 'subscription_gone' : 'push_failed'),
    transient: removedDead === 0,
    removedDead,
  }
}
