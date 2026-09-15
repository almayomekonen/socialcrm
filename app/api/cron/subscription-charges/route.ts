import { NextRequest, NextResponse } from 'next/server'
import { runChargePass } from '@/lib/payments/charges/runChargePass'

/**
 * Card-token billing scheduler pass (lib/payments/charges/runChargePass.ts).
 *
 * NOT SCHEDULED YET: there is deliberately no vercel.json cron entry — adding it
 * is a production launch step (plan Amendment A7). With
 * SUBSCRIPTION_CHARGES_ENABLED absent the pass returns before touching the
 * database, and charge dispatch stays disabled until Grow sandbox evidence is
 * recorded (lib/payments/grow/providerEvidence.ts).
 */

export const maxDuration = 60

const LOG = '[subscription-charges]'

function isAuthorized(req: NextRequest, secret: string): boolean {
  if (req.headers.get('authorization') === `Bearer ${secret}`) return true
  return req.headers.get('x-cron-secret') === secret
}

async function handle(req: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret) {
    console.error(`${LOG} CRON_SECRET is not set`)
    return new NextResponse('Internal Server Error', { status: 500 })
  }
  if (!isAuthorized(req, secret)) return new NextResponse('Forbidden', { status: 403 })

  try {
    const summary = await runChargePass()
    if (summary.enabled) console.log(`${LOG} pass`, summary)
    return NextResponse.json({ ok: true, ...summary })
  } catch (err) {
    console.error(`${LOG} pass failed`, { err: String(err) })
    return new NextResponse('Internal Server Error', { status: 500 })
  }
}

export async function GET(req: NextRequest) {
  return handle(req)
}

export async function POST(req: NextRequest) {
  return handle(req)
}
