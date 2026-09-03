'use server'

import type { Knex } from 'knex'
import { revalidatePath } from 'next/cache'
import { db } from '@/config/db'
import { requireAgencyUser, AuthError } from '@/lib/requireUser'
import { isAdmin } from '@/types/roles'
import { getAgencyProductAccess } from '@/lib/access/productAccess'
import { loadPlatformOperators } from '@/db/notifications/recipients'
import { notifyEvent } from '@/lib/notifications/emit'

export type CancelResumeResult = { ok: true } | { error: 'unauthorized' | 'no_subscription' }

/** Greppable in production logs. A silent failure here means a live standing order nobody knows about. */
const LOG = '[SubscriptionCancellationNotification]'

async function setCancelFlag(value: boolean): Promise<CancelResumeResult> {
  let user
  try {
    user = await requireAgencyUser()
  } catch (err) {
    if (err instanceof AuthError) return { error: 'unauthorized' }
    throw err
  }
  /**
   * Subscription state is agency-wide: cancelling ends the workspace for every
   * user in it. The page that hosts this control was reachable by direct URL
   * from any role, so the boundary has to live here rather than in the page.
   */
  if (!isAdmin(user.role)) return { error: 'unauthorized' }

  const rowcount = await db('subscriptions')
    .where({ agencyId: user.agencyId })
    .update({ cancelAtPeriodEnd: value, updatedAt: new Date() })

  if (rowcount === 0) return { error: 'no_subscription' }

  revalidatePath('/settings/update_payment')
  return { ok: true }
}

/**
 * Tell the PLATFORM OPERATOR that a customer cancelled and their Grow standing
 * order still needs stopping by hand.
 *
 * WHY THE OPERATOR AND NOT THE AGENCY. Cancelling in SocialCRM sets a flag on our
 * own row; it contacts no payment provider, because Grow documents no
 * cancellation operation for a hosted Payment-Link mandate and this system holds
 * no Grow API credentials. Somebody therefore has to stop the mandate manually,
 * and that somebody is whoever runs SocialCRM — never the customer, and never
 * their agency's admins, for whom this is not actionable and not their business.
 *
 * WHY THE EVENT CARRIES THE OWNER'S agencyId. Notification reads are tenant
 * scoped — every query in db/notifications/feed.ts filters agencyId AND userId —
 * so a row stamped with the CANCELLING agency would be invisible to the operator
 * forever. The same field also drives the emit gates (allowlist, product
 * access), and keying those to the cancelling customer would mean a lapsed
 * customer's cancellation is silently dropped: precisely the case where a live
 * mandate is most dangerous. The cancelling agency travels as the entity and in
 * the payload instead.
 *
 * NEVER BREAKS THE CANCELLATION. `notifyEvent` does not throw by contract, and
 * the two reads around it are wrapped, so a notification problem can never roll
 * back or fail the customer's cancellation. It is loud in the logs instead.
 */
async function notifyPlatformOperatorOfCancellation(
  trx: Knex.Transaction,
  args: { cancellingAgencyId: number; cancelledAt: Date },
): Promise<void> {
  try {
    /**
     * FAIL CLOSED. Identity comes from the platform-owner allowlist that already
     * gates /admin. If it resolves to nobody — or to somebody with no agency, who
     * therefore has no tenant to read a notification in — nothing is emitted.
     * Nobody told is recoverable from a log; the wrong person told is not.
     */
    const owner = (await loadPlatformOperators()).find((o) => o.agencyId != null)
    if (!owner?.agencyId) {
      console.error(`${LOG} no platform owner resolved — cancellation recorded, nobody notified`, {
        cancellingAgencyId: args.cancellingAgencyId,
      })
      return
    }

    // Name is a courtesy for the copy; absent resolves to name-free wording.
    const agency = await trx('agencies').where({ id: args.cancellingAgencyId }).select('name').first()

    const result = await notifyEvent(
      {
        type: 'subscription.cancellation_requested',
        agencyId: owner.agencyId,
        entityType: 'subscription',
        entityId: args.cancellingAgencyId,
        // System-originated: the cancelling user is NOT the actor for this
        // event. A non-null actor would be filtered out of the recipients by
        // plan.ts when the operator's own agency cancels, silencing it.
        actorUserId: null,
        occurredAt: args.cancelledAt,
        payload: {
          cancellingAgencyId: args.cancellingAgencyId,
          cancellingAgencyName: agency?.name ?? null,
          cancelledAt: args.cancelledAt.getTime(),
        },
      },
      { trx },
    )

    /**
     * `notifyEvent` is deliberately silent — for a lead notification a swallowed
     * refusal costs a courtesy. Here it costs money: the customer cancelled,
     * Grow keeps charging, and nobody is told. So every refusal is surfaced.
     */
    if (result.enqueued === false) {
      console.error(`${LOG} not enqueued — the Grow standing order may go unhandled`, {
        cancellingAgencyId: args.cancellingAgencyId,
        platformOwnerAgencyId: owner.agencyId,
        reason: result.reason,
      })
    }
  } catch (err) {
    console.error(`${LOG} failed (swallowed — cancellation still stands)`, {
      cancellingAgencyId: args.cancellingAgencyId,
      err: String(err),
    })
  }
}

/**
 * Record the customer's cancellation request, and raise the manual Grow task.
 *
 * TRANSITION-GATED, not a blind write. The UPDATE carries
 * `cancelAtPeriodEnd: false` in its WHERE, so it succeeds only on a genuine
 * false→true transition. A double-submitted cancel matches nothing the second
 * time and asks the operator to cancel one mandate once. Cancel → resume →
 * cancel is a real second transition and correctly raises a second task.
 *
 * The enqueue shares this transaction (spec §14.1): if the flag write rolls
 * back, no notification is queued for a cancellation that never happened.
 */
export async function cancelRenewal(): Promise<CancelResumeResult> {
  let user
  try {
    user = await requireAgencyUser()
  } catch (err) {
    if (err instanceof AuthError) return { error: 'unauthorized' }
    throw err
  }
  /**
   * Subscription state is agency-wide: cancelling ends the workspace for every
   * user in it. The page that hosts this control was reachable by direct URL
   * from any role, so the boundary has to live here rather than in the page.
   */
  if (!isAdmin(user.role)) return { error: 'unauthorized' }

  let outcome: CancelResumeResult = { ok: true }

  await db.transaction(async (trx) => {
    const rows = (await trx('subscriptions')
      .where({ agencyId: user.agencyId, cancelAtPeriodEnd: false })
      .update({ cancelAtPeriodEnd: true, updatedAt: new Date() })
      .returning('updatedAt')) as unknown as { updatedAt: string | Date }[]

    if (rows.length === 0) {
      /**
       * Nothing transitioned. Two very different reasons, and the caller must be
       * able to tell them apart: there is no subscription to cancel (an error
       * the modal reports), or it was already cancelling (success — the customer
       * asked for something that is already true). Only the second is idempotent.
       */
      const existing = await trx('subscriptions').where({ agencyId: user.agencyId }).first()
      outcome = existing ? { ok: true } : { error: 'no_subscription' }
      return
    }

    await notifyPlatformOperatorOfCancellation(trx, {
      cancellingAgencyId: user.agencyId,
      cancelledAt: new Date(rows[0].updatedAt),
    })
  })

  if ('error' in outcome) return outcome

  revalidatePath('/settings/update_payment')
  return outcome
}

export async function resumeRenewal(): Promise<CancelResumeResult> {
  return setCancelFlag(false)
}

/**
 * "Has the server positively confirmed that this agency's subscription is
 * active RIGHT NOW?" — the only entitlement question the client is allowed to
 * ask, and the only thing the activation verifier polls.
 *
 * WHY `active` IS NOT JUST `hasAccess`.
 *
 * `getAgencyProductAccess` FAILS OPEN: a transient DB error, or a missing
 * agency row, resolves to `{ status: 'UNKNOWN', hasAccess: true }` so that
 * infrastructure trouble can never lock out a paying customer. That is exactly
 * right for guarding the product — and exactly wrong as proof of payment. A
 * database hiccup one second after checkout would otherwise let the success
 * page announce "המנוי הופעל בהצלחה" for a payment that never landed.
 *
 * So `active` requires a POSITIVE answer: access granted AND a real resolved
 * status, never the fail-open sentinel. UNKNOWN means "keep waiting", which
 * costs the customer nothing — the app itself still fails open, so they are not
 * blocked while we decline to make the claim.
 *
 * Deriving that rule HERE, once, is deliberate: the client never re-implements
 * it, and the pollGate latch can only ever be cleared by this answer.
 *
 * Returns no transaction id, amount, provider reference or billing detail — a
 * boolean and the lifecycle status the client already holds via
 * EntitlementProvider. Reuses the canonical resolver; adds no query beyond the
 * one it already performs.
 */
export type EntitlementStatusResult = {
  /** Server-confirmed active entitlement. Never true on a fail-open read. */
  active: boolean
  /** Lifecycle status for copy only (PAID / TRIAL_EXPIRED / UNKNOWN / …). */
  status: string
}

export async function getEntitlementStatus(): Promise<EntitlementStatusResult> {
  let user
  try {
    user = await requireAgencyUser()
  } catch (err) {
    // Not signed in, or no agency. Not a confirmation, and not a revocation:
    // the caller simply keeps waiting.
    if (err instanceof AuthError) return { active: false, status: 'UNAUTHENTICATED' }
    throw err
  }

  const { status, hasAccess } = await getAgencyProductAccess(user.agencyId)
  return { active: hasAccess && status !== 'UNKNOWN', status }
}
