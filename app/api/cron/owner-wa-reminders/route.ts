import { NextRequest, NextResponse } from 'next/server'
import { tickOwnerWhatsappReminders } from '@/lib/ownerWhatsappReminders/tick'

/**
 * Owner WhatsApp reminders, every minute. Its own cron on purpose: it does not
 * depend on NOTIFICATIONS_ENABLED, and a failure here can never cost the
 * notification heartbeat (or the other way round). OFF unless the platform
 * number and an agency allowlist are configured; sends only with
 * OWNER_WA_REMINDERS_SEND_ENABLED=1 (see lib/ownerWhatsappReminders/tick.ts).
 */
export const maxDuration = 60

function isAuthorized(req: NextRequest, secret: string): boolean {
  if (req.headers.get('authorization') === `Bearer ${secret}`) return true
  return req.headers.get('x-cron-secret') === secret
}

async function handle(req: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret) {
    console.error('[OwnerWaReminder][cron] CRON_SECRET is not set')
    return new NextResponse('Internal Server Error', { status: 500 })
  }
  if (!isAuthorized(req, secret)) return new NextResponse('Forbidden', { status: 403 })
  try {
    const summary = await tickOwnerWhatsappReminders()
    return NextResponse.json({ ok: true, ...summary })
  } catch (err) {
    console.error('[OwnerWaReminder][cron] tick failed', { code: (err as { code?: string })?.code ?? null })
    return NextResponse.json({ ok: false }, { status: 500 })
  }
}

export async function GET(req: NextRequest) {
  return handle(req)
}

export async function POST(req: NextRequest) {
  return handle(req)
}
