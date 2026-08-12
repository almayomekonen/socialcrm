import { NextRequest, NextResponse } from 'next/server'
import { pruneTerminalNotificationJobs } from '@/db/notifications/jobs'
import { pruneNotifications } from '@/db/notifications/notifications'
import { isNotificationsEnabled } from '@/lib/notifications/flags'
import { reconcileMissedLeadCreated } from '@/lib/notifications/reconcile'
import { runNotificationWorker } from '@/lib/notifications/worker'

/**
 * Notification drain — the engine's heartbeat (spec §23.3).
 *
 * Three jobs, in this order:
 *   1. drain — reclaim expired leases, claim and process due jobs
 *   2. reconcile — recover events lost between a lead INSERT and its job INSERT
 *   3. prune — terminal queue rows, settled notifications, orphans
 *
 * `after()` kicks make the common case immediate; THIS is the correctness and
 * recovery guarantee. Safe to overlap with itself and with kicks (leases +
 * SKIP LOCKED).
 *
 * Notification-owned; never shared with the automation or email crons, each of
 * which owns its own domain.
 */

export const maxDuration = 60

const PRUNE_AFTER_DAYS = 90 // spec §21.3, matching the automation engine's window

function isAuthorized(req: NextRequest, secret: string): boolean {
  const auth = req.headers.get('authorization')
  if (auth && auth === `Bearer ${secret}`) return true
  if (req.headers.get('x-cron-secret') === secret) return true
  return false
}

async function handle(req: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret) {
    console.error('[notifications][cron] CRON_SECRET is not set')
    return new NextResponse('Internal Server Error', { status: 500 })
  }
  if (!isAuthorized(req, secret)) {
    return new NextResponse('Forbidden', { status: 403 })
  }

  /**
   * OFF MEANS OFF (spec §23.1). Returning before the drain means a disabled
   * system runs no claim query, no sweep and no prune — the cron costs one
   * string comparison. Pruning is safe to skip because nothing is being created.
   */
  if (!isNotificationsEnabled()) {
    return NextResponse.json({ ok: true, disabled: true })
  }

  const summary = await runNotificationWorker({ limit: 25, workerId: 'cron-dispatch' })
  const reconciled = await reconcileMissedLeadCreated()

  const cutoff = new Date(Date.now() - PRUNE_AFTER_DAYS * 24 * 60 * 60 * 1000)
  await pruneTerminalNotificationJobs(cutoff)
  await pruneNotifications(cutoff)

  return NextResponse.json({ ok: true, ...summary, reconciled })
}

export async function GET(req: NextRequest) {
  return handle(req)
}

export async function POST(req: NextRequest) {
  return handle(req)
}
