import { NextRequest, NextResponse } from 'next/server'
import { getAutomationSecret, isAutomationAuthorized } from '@/lib/automation/apiAuth'
import { runScheduledAutomations } from '@/lib/emailAutomations/runScheduled'
import { AUTOMATIONS } from '@/lib/emailAutomations/registry'
import { dispatchLive } from '@/lib/emailAutomations/live'

export const maxDuration = 60

async function handle(req: NextRequest) {
  const secret = getAutomationSecret()
  if (!secret) {
    console.error('[email-automations] AUTOMATION_API_KEY/CRON_SECRET is not set')
    return new NextResponse('Internal Server Error', { status: 500 })
  }
  if (!isAutomationAuthorized(req, secret)) {
    return new NextResponse('Forbidden', { status: 403 })
  }

  const now = new Date()
  const summary = await runScheduledAutomations({
    automations: AUTOMATIONS,
    dispatch: (automation, recipient) => dispatchLive(automation, recipient, now),
    now,
  })
  return NextResponse.json({ ok: true, ...summary })
}

export async function GET(req: NextRequest) {
  return handle(req)
}

export async function POST(req: NextRequest) {
  return handle(req)
}
