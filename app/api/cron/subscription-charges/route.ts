import { NextRequest, NextResponse } from 'next/server'
import { runChargePass } from '@/lib/payments/charges/runChargePass'

/**
 * Card-token billing scheduler pass (lib/payments/charges/runChargePass.ts).
 *
 * SCHEDULED every 5 minutes in vercel.json (05a33aaa). Vercel runs crons only
 * against production deployments, so this does not fire on the staging preview.
 *
 * Being scheduled is not being armed. Three independent things must all be true
 * before this pass can move money, and none of them is:
 *
 *   1. SUBSCRIPTION_CHARGES_ENABLED — absent in production, so runChargePass
 *      returns before it touches the database at all.
 *   2. The per-environment dispatch gate — tokenChargeDispatch.production has no
 *      evidenceRef (lib/payments/grow/providerEvidence.ts), so dispatch stays
 *      false even with the flag on. Sandbox is open; production is not.
 *   3. GROW_USER_ID / GROW_PAGE_CODE_TOKEN — absent in production, so a call to
 *      Grow throws grow.config.* before a request is built.
 *
 * Turning billing on is opening those deliberately, in that order — never
 * discovering that the cron was already running.
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
