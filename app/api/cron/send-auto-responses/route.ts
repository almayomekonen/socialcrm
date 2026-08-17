import { NextRequest, NextResponse } from 'next/server'
import { getAutomationSecret, isAutomationAuthorized } from '@/lib/automation/apiAuth'
import { runAutoResponseWorker } from '@/lib/inbox/autoresponse/worker'

export const maxDuration = 60

/**
 * Instant Response Engine drain. The WhatsApp webhook / promotion `after()`
 * kick waits approximately until notBefore (capped) then claims due jobs
 * (`pending` AND `notBefore <= now()`). This cron remains the scheduled
 * backstop when that kick is missed, the wait cap is shorter than delaySeconds,
 * or the function ends before the job is due. Idempotent with the kick via
 * SKIP LOCKED + the in-flight unique index.
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
