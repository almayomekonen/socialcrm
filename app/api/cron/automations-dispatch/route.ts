import { NextRequest, NextResponse } from 'next/server'
import { runAutomationWorker } from '@/lib/automations/worker'
import { pruneTerminalJobs } from '@/db/automations/jobs'

/**
 * Customer Automation Engine drain — the engine's heartbeat (ADR-011 §cron):
 * reclaims expired leases, claims and processes due jobs (delayed sends
 * included), prunes terminal queue rows past the operational window. Safe to
 * overlap with itself and with after() kicks (leases + SKIP LOCKED). Delay
 * accuracy is bounded by the five-minute cadence — stated honestly in product
 * copy (TIMING_ACCURACY_COPY), never presented as exact.
 *
 * Engine-owned; NEVER shared with the platform email cron (spec §0).
 */

export const maxDuration = 60

const PRUNE_AFTER_DAYS = 90 // migration plan §4.4 / §8.2

function isAuthorized(req: NextRequest, secret: string): boolean {
  const auth = req.headers.get('authorization')
  if (auth && auth === `Bearer ${secret}`) return true
  if (req.headers.get('x-cron-secret') === secret) return true
  return false
}

async function handle(req: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret) {
    console.error('[automations][cron] CRON_SECRET is not set')
    return new NextResponse('Internal Server Error', { status: 500 })
  }
  if (!isAuthorized(req, secret)) {
    return new NextResponse('Forbidden', { status: 403 })
  }

  const summary = await runAutomationWorker({ limit: 25, workerId: 'cron-dispatch' })
  await pruneTerminalJobs(new Date(Date.now() - PRUNE_AFTER_DAYS * 24 * 60 * 60 * 1000))
  return NextResponse.json({ ok: true, ...summary })
}

export async function GET(req: NextRequest) {
  return handle(req)
}

export async function POST(req: NextRequest) {
  return handle(req)
}
