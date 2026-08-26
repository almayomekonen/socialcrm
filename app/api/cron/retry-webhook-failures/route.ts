import { NextRequest, NextResponse } from 'next/server'
import { runWebhookFailureRetry } from '@/lib/facebook/retryWebhookFailures'

/**
 * Recovery drain for failed Meta lead ingestion.
 *
 * Both Meta webhooks answer HTTP 200 unconditionally, so Meta never redelivers
 * and a transient internal failure would otherwise lose a paid lead forever.
 * This is the retry that Meta will not run for us.
 *
 * Deliberately INFREQUENT and BOUNDED. The worker claims a small batch per pass
 * with `SKIP LOCKED`, spaces attempts on an exponential backoff, and stops at an
 * attempt budget — a recovery queue must never become a source of load against
 * Meta. Every attempt is idempotent: the lead's own dedup ladder and the unique
 * index on `clients."leadSource"` make a duplicate unrepresentable.
 *
 * CRON_SECRET-gated, exactly as the other cron routes are.
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
    console.error('[retry-webhook-failures] CRON_SECRET is not set')
    return new NextResponse('Internal Server Error', { status: 500 })
  }
  if (!isAuthorized(req, secret)) {
    return new NextResponse('Forbidden', { status: 403 })
  }

  try {
    const result = await runWebhookFailureRetry()
    return NextResponse.json({ ok: true, ...result })
  } catch (err) {
    // Never surface internals; the pass is retried on the next tick anyway.
    console.error('[retry-webhook-failures] pass threw', err)
    return NextResponse.json({ ok: false }, { status: 500 })
  }
}

export async function GET(req: NextRequest) {
  return handle(req)
}

export async function POST(req: NextRequest) {
  return handle(req)
}
