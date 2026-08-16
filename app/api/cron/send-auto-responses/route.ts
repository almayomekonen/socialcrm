import { NextRequest, NextResponse } from 'next/server'
import { getAutomationSecret, isAutomationAuthorized } from '@/lib/automation/apiAuth'
import { runAutoResponseWorker } from '@/lib/inbox/autoresponse/worker'

export const maxDuration = 60

/**
 * Instant Response Engine drain. The WhatsApp webhook after() kick claims only
 * jobs that are already due (`pending` AND `notBefore <= now()`). Delayed jobs
 * (`delaySeconds` > 0) are therefore not processed by that same-request kick.
 * This cron is the scheduled drain for those due jobs, and the backstop when a
 * kick is missed (cold start, crash, after() not firing). Idempotent with the
 * kick via SKIP LOCKED + the in-flight unique index.
 */
async function handle(req: NextRequest) {
  const secret = getAutomationSecret()
  if (!secret) {
    console.error('[send-auto-responses] AUTOMATION_API_KEY / CRON_SECRET is not set')
    return NextResponse.json({ error: 'Server not configured' }, { status: 500 })
  }
  if (!isAutomationAuthorized(req, secret)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const result = await runAutoResponseWorker()
  return NextResponse.json({ ok: true, ...result })
}

export async function GET(req: NextRequest) {
  return handle(req)
}

export async function POST(req: NextRequest) {
  return handle(req)
}
