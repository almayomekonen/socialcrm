import { NextRequest, NextResponse } from 'next/server'
import { getAutomationSecret, isAutomationAuthorized } from '@/lib/automation/apiAuth'
import { runMessengerEventWorker } from '@/lib/facebook/messenger/eventWorker'
import { messengerEventStatusCounts } from '@/db/messengerWebhookEvents'

export const maxDuration = 60

/**
 * Messenger receipt drain — the scheduled backstop for the webhook's own
 * post-response kick. An adapter only, like /api/cron/history-import: it
 * authenticates and runs the worker, which reclaims stale leases, processes
 * everything due (including retries past their backoff), and prunes settled
 * receipts past retention. Concurrent runs are safe (SKIP LOCKED).
 *
 * Auth: the shared automation secret (AUTOMATION_API_KEY / CRON_SECRET).
 * The response carries COUNTS ONLY — never a message, a PSID or a Page id.
 * `failed` in `statusCounts` is the number to alert on: receipts that spent
 * their attempts and wait for an operator (scripts/requeue_messenger_events.cjs).
 */
async function handle(req: NextRequest): Promise<NextResponse> {
  const secret = getAutomationSecret()
  if (!secret) {
    console.error('[messenger-events] AUTOMATION_API_KEY / CRON_SECRET is not set')
    return NextResponse.json({ error: 'Server not configured' }, { status: 500 })
  }
  if (!isAutomationAuthorized(req, secret)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  const workerId = `cron-${process.env.VERCEL_DEPLOYMENT_ID ?? 'local'}-${Math.random().toString(36).slice(2, 10)}`
  const summary = await runMessengerEventWorker({ workerId })
  const statusCounts = await messengerEventStatusCounts()
  if ((statusCounts.failed ?? 0) > 0) {
    console.error('[messenger-events] receipts in terminal failed state', { failed: statusCounts.failed })
  }
  return NextResponse.json({ ok: true, ...summary, statusCounts })
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  return handle(req)
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  return handle(req)
}
