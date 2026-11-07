import { NextRequest, NextResponse } from 'next/server'
import { tickPersonalReminders } from '@/lib/reminders/delivery/tick'

/**
 * Owner personal reminders, every minute (Reminder Engine Phase 5). Its own
 * cron so a failure here never costs the lead_followup_alert reminders or the
 * notification heartbeat. Runs the exposure monitor and housekeeping on every
 * call; sends only with OWNER_PERSONAL_REMINDERS_SEND_ENABLED=1 AND the DB
 * switch on AND every control configured (see lib/reminders/delivery/tick.ts).
 */
export const maxDuration = 60

function isAuthorized(req: NextRequest, secret: string): boolean {
  if (req.headers.get('authorization') === `Bearer ${secret}`) return true
  return req.headers.get('x-cron-secret') === secret
}

async function handle(req: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret) {
    console.error('[personal-reminders][cron] CRON_SECRET is not set')
    return new NextResponse('Internal Server Error', { status: 500 })
  }
  if (!isAuthorized(req, secret)) return new NextResponse('Forbidden', { status: 403 })
  try {
    const summary = await tickPersonalReminders()
    return NextResponse.json({ ok: true, ...summary })
  } catch (err) {
    console.error('[personal-reminders][cron] tick failed', { code: (err as { code?: string })?.code ?? null })
    return NextResponse.json({ ok: false }, { status: 500 })
  }
}

export async function GET(req: NextRequest) {
  return handle(req)
}

export async function POST(req: NextRequest) {
  return handle(req)
}
