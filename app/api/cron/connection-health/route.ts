import { NextRequest, NextResponse } from 'next/server'
import { runConnectionHealthSweep } from '@/lib/connections/healthSweep'

/**
 * Scheduled health check for Facebook Page and WhatsApp connections.
 *
 * Before this, both channels' health was evaluated only when a customer opened
 * Settings or after a webhook had already failed — so a dead token was found by
 * a human, typically after leads had been lost. This is the clock that finds it
 * first.
 *
 * Hourly, deliberately: token death and lost subscriptions are hour-scale
 * events, and each pass costs a Graph call per connection. Notifications fire
 * only on genuine state transitions, so a persistently broken connection is
 * reported once, not once per pass.
 *
 * CRON_SECRET-gated, matching every other cron route.
 */

export const maxDuration = 60

function isAuthorized(req: NextRequest, secret: string): boolean {
  if (req.headers.get('authorization') === `Bearer ${secret}`) return true
  if (req.headers.get('x-cron-secret') === secret) return true
  return false
}

async function handle(req: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret) {
    console.error('[connection-health] CRON_SECRET is not set')
    return new NextResponse('Internal Server Error', { status: 500 })
  }
  if (!isAuthorized(req, secret)) {
    return new NextResponse('Forbidden', { status: 403 })
  }

  try {
    const result = await runConnectionHealthSweep()
    return NextResponse.json({ ok: true, ...result })
  } catch (err) {
    console.error('[connection-health] sweep threw', err)
    return NextResponse.json({ ok: false }, { status: 500 })
  }
}

export async function GET(req: NextRequest) {
  return handle(req)
}

export async function POST(req: NextRequest) {
  return handle(req)
}
