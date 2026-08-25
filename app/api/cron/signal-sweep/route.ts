import { NextRequest, NextResponse } from 'next/server'
import { getAutomationSecret, isAutomationAuthorized } from '@/lib/automation/apiAuth'
import { runSignalTick } from '@/lib/ai/integration/signalTick'

export const maxDuration = 60

/**
 * The signal tick's scheduled wake-up.
 *
 * This route is ONLY an adapter: authenticate, then invoke the reusable tick.
 * It holds no detection, no queue logic and no scheduler-specific behaviour, so
 * the same work runs identically from a script or any other trigger. Vercel Cron
 * decides WHEN; Postgres decides what is durable. Nothing about correctness
 * depends on this handler completing — a tick killed mid-drain leaves leased
 * jobs that the next tick reclaims.
 *
 * `maxDuration = 60` is the repository convention for every cron route and the
 * practical ceiling; the worker's own budget (45s by default) stops claiming
 * well inside it so the response is written before the platform intervenes.
 *
 * Auth is the shared automation secret (AUTOMATION_API_KEY / CRON_SECRET) via
 * `Authorization: Bearer`, `x-automation-key`, or `x-cron-secret` — the same
 * helper `send-auto-responses` and `email-automations` already use. There is no
 * user, no session, and no agency in the request: the swept agencies come from
 * the server's own allowlist, so a caller who holds the secret still cannot
 * choose whose data is read.
 */
async function handle(req: NextRequest): Promise<NextResponse> {
  const secret = getAutomationSecret()
  if (!secret) {
    console.error('[signal-sweep] AUTOMATION_API_KEY / CRON_SECRET is not set')
    return NextResponse.json({ error: 'Server not configured' }, { status: 500 })
  }
  if (!isAutomationAuthorized(req, secret)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const result = await runSignalTick()
  return NextResponse.json({ ok: true, ...result })
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  return handle(req)
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  return handle(req)
}
