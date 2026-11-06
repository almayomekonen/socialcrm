import { createHmac, timingSafeEqual } from 'crypto'
import { NextRequest, NextResponse, after } from 'next/server'
import { runAutoResponseKick } from '@/lib/inbox/autoresponse/kickWorker'
import { platformWhatsappPhoneNumberId } from '@/lib/flags/ownerWhatsappReminderFlags'
import { splitPlatformWebhook } from '@/lib/whatsapp/platform/webhookBatch'
import { handleDeliveryWithPlatformChanges } from '@/lib/whatsapp/platform/delivery'
import { whatsappWebhookMode } from '@/lib/whatsapp/webhook/mode'
import { receiveWhatsappWebhook } from '@/lib/whatsapp/webhook/receive'
import { runWhatsappWebhookWorker } from '@/lib/whatsapp/webhook/worker'

export const maxDuration = 60

export async function GET(req: NextRequest) {
  const url = new URL(req.url)
  const mode = url.searchParams.get('hub.mode')
  const token = url.searchParams.get('hub.verify_token')
  const challenge = url.searchParams.get('hub.challenge')

  if (mode === 'subscribe' && token === process.env.META_VERIFY_TOKEN) {
    return new Response(challenge, { status: 200 })
  }

  return new Response('Forbidden', { status: 403 })
}

// POST — incoming WhatsApp message from Meta Cloud API
export async function POST(req: NextRequest) {
  const appSecret = process.env.META_APP_SECRET
  if (!appSecret) {
    console.error('[WhatsappWebhook] META_APP_SECRET is not set')
    return new NextResponse('Internal Server Error', { status: 500 })
  }

  const rawBody = await req.text()
  const signature = req.headers.get('x-hub-signature-256')

  if (!signature) {
    console.warn('[WhatsappWebhook] Missing X-Hub-Signature-256 header — rejecting')
    return new NextResponse('Forbidden', { status: 403 })
  }

  const expected = 'sha256=' + createHmac('sha256', appSecret).update(rawBody).digest('hex')
  const sigBuffer = Buffer.from(signature)
  const expectedBuffer = Buffer.from(expected)
  const signatureValid = sigBuffer.length === expectedBuffer.length && timingSafeEqual(sigBuffer, expectedBuffer)

  if (!signatureValid) {
    console.warn('[WhatsappWebhook] Signature mismatch — rejecting')
    return new NextResponse('Forbidden', { status: 403 })
  }

  let body: any
  try {
    body = JSON.parse(rawBody)
  } catch {
    console.warn('[WhatsappWebhook] Invalid JSON body')
    return NextResponse.json({ ok: true })
  }

  // SocialCRM's own number (owner reminders) is never an agency's number: its
  // changes are taken out here and never reach the agency path below. Unset
  // PLATFORM_WHATSAPP_PHONE_NUMBER_ID, or no change for it, and the agency path
  // gets the original body, exactly as before.
  const split = splitPlatformWebhook(body, platformWhatsappPhoneNumberId())
  if (!split.platform.length) return handleAgencyPayload(body)
  return handleDeliveryWithPlatformChanges(split, handleAgencyPayload)
}

/**
 * Agency payloads: durable receipt by default, direct processing only under the kill
 * switch (lib/whatsapp/webhook/mode.ts). The mode is read once here, so this delivery
 * takes exactly one path. Processing never happens before the response in durable mode;
 * after() drains this delivery's receipts, and the minute-ly cron is the backstop.
 */
async function handleAgencyPayload(body: unknown): Promise<NextResponse> {
  const mode = whatsappWebhookMode()
  const result = await receiveWhatsappWebhook(body, mode)

  if (mode === 'durable' && result.recordedIds.length > 0) {
    const ids = result.recordedIds
    after(async () => {
      try {
        await runWhatsappWebhookWorker({ workerId: `webhook-${Math.random().toString(36).slice(2, 10)}`, ids })
      } catch (err) {
        // The receipts are durable; the cron picks them up.
        console.error('[wa-webhook] post-response drain failed', JSON.stringify({ name: (err as Error)?.name ?? null }))
      }
    })
  }
  if (mode === 'direct' && result.kick) {
    after(async () => {
      try {
        await runAutoResponseKick({ delaySeconds: result.delaySeconds, limit: 5 })
      } catch (err) {
        console.error('[auto-response] kick failed', { reason: (err as Error)?.name ?? null })
      }
    })
  }

  return result.status === 200
    ? NextResponse.json({ ok: true })
    : NextResponse.json({ ok: false, error: 'not_recorded_retry' }, { status: 503 })
}
