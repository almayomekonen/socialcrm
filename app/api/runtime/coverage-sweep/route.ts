import { NextRequest, NextResponse } from 'next/server'
import { getAutomationSecret, isAutomationAuthorized } from '@/lib/automation/apiAuth'
import { runShadowCoverageSweep } from '@/lib/ai/integration/shadowCoverageSweep'

/**
 * Thin, scheduler-agnostic adapter for the Coverage Sweep (Integration-3).
 *
 * This route is ONLY an adapter: authenticate, then invoke the reusable runtime
 * function. It contains no sweep logic and no scheduler-specific behaviour — any
 * trigger (Vercel cron, GitHub Actions, Trigger.dev, cron-job.org, AWS
 * EventBridge, a future internal scheduler) calls the same endpoint with the same
 * shared secret, and the runtime behaves identically. The sweep can also be run
 * with zero HTTP via `scripts/shadow-coverage-sweep.ts`. Scheduling is
 * infrastructure; the sweep is intelligence.
 *
 * Auth uses the shared automation secret (AUTOMATION_API_KEY / CRON_SECRET) via
 * an Authorization: Bearer header, x-automation-key, or x-cron-secret.
 */
async function handle(req: NextRequest): Promise<NextResponse> {
  const secret = getAutomationSecret()
  if (!secret) {
    console.error('[coverage-sweep] AUTOMATION_API_KEY / CRON_SECRET is not set')
    return NextResponse.json({ error: 'Server not configured' }, { status: 500 })
  }
  if (!isAutomationAuthorized(req, secret)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  const result = await runShadowCoverageSweep()
  return NextResponse.json({ ok: true, ...result })
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  return handle(req)
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  return handle(req)
}
