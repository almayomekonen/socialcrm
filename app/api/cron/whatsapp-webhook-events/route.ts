import { NextRequest, NextResponse } from 'next/server'
import { getAutomationSecret, isAutomationAuthorized } from '@/lib/automation/apiAuth'
import { runWhatsappWebhookWorker } from '@/lib/whatsapp/webhook/worker'
import { whatsappEventHealth } from '@/db/whatsappWebhookEvents'
import { logDirectModeActive, whatsappWebhookMode } from '@/lib/whatsapp/webhook/mode'

export const maxDuration = 60

/**
 * WhatsApp receipt drain: the scheduled backstop for the webhook's own post-response
 * drain, in BOTH modes (receipts recorded before a switch to direct mode still drain).
 * Reclaims stale leases, processes everything due including retries past their
 * backoff, and prunes settled receipts past retention. Concurrent runs are safe.
 *
 * Auth: the shared automation secret (AUTOMATION_API_KEY / CRON_SECRET), as the other
 * crons. The response carries COUNTS ONLY. The lines to alert on:
 *   [wa-webhook] direct_mode_active      the kill switch is on
 *   [wa-webhook] receipts failed         receipts that spent their attempts
 *   [wa-webhook] receipts waiting        the oldest unprocessed receipt is over 5 minutes old
 */
async function handle(req: NextRequest): Promise<NextResponse> {
  const secret = getAutomationSecret()
  if (!secret) {
    console.error('[wa-webhook] AUTOMATION_API_KEY / CRON_SECRET is not set')
    return NextResponse.json({ error: 'Server not configured' }, { status: 500 })
  }
  if (!isAutomationAuthorized(req, secret)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  const mode = whatsappWebhookMode()
  if (mode === 'direct') logDirectModeActive('cron')

  const workerId = `cron-${process.env.VERCEL_DEPLOYMENT_ID ?? 'local'}-${Math.random().toString(36).slice(2, 10)}`
  const summary = await runWhatsappWebhookWorker({ workerId })
  const health = await whatsappEventHealth()
  if ((health.counts.failed ?? 0) > 0) console.error('[wa-webhook] receipts failed', JSON.stringify({ failed: health.counts.failed }))
  if ((health.oldestReceivedSeconds ?? 0) > 300) {
    console.error('[wa-webhook] receipts waiting', JSON.stringify({ oldestReceivedSeconds: health.oldestReceivedSeconds, received: health.counts.received ?? 0 }))
  }
  return NextResponse.json({ ok: true, mode, ...summary, ...health })
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  return handle(req)
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  return handle(req)
}
