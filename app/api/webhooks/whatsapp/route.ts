import { createHmac, timingSafeEqual } from 'crypto'
import { NextRequest, NextResponse, after } from 'next/server'
import { parseWhatsappLead } from '@/lib/adapters/whatsappLead'
import { createLeadFromWhatsappWebhook } from '@/lib/system/createLeadFromWhatsappWebhook'
import { ingestWhatsappInbound } from '@/lib/inbox/ingestWhatsappInbound'
import { runAutoResponseWorker } from '@/lib/inbox/autoresponse/worker'
import { db } from '@/config/db'

// GET — Meta webhook verification handshake
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

  const value = body?.entry?.[0]?.changes?.[0]?.value
  if (!value) {
    console.warn('[WhatsappWebhook] Invalid payload structure')
    return NextResponse.json({ ok: true })
  }

  // Skip status events (delivery receipts, read receipts) — only process messages
  const message = value.messages?.[0]
  if (!message) {
    console.log('[WhatsappWebhook] No message in payload (status/receipt event) — skipping')
    return NextResponse.json({ ok: true })
  }

  try {
    const messageId: string | undefined = message.id
    const from: string | undefined = message.from
    const phoneNumberId: string | undefined = value.metadata?.phone_number_id

    if (!messageId || !from || !phoneNumberId) {
      console.warn('[WhatsappWebhook] Missing required fields — ignoring')
      return NextResponse.json({ ok: true })
    }

    // Resolve tenant via phone_number_id — this is the multi-tenant mapping
    const connection = await db('whatsapp_connections').where({ phone_number_id: phoneNumberId }).first()
    if (!connection) {
      console.warn(`[WhatsappWebhook] No DB connection for phoneNumberId=${phoneNumberId} — ignoring`)
      return NextResponse.json({ ok: true })
    }

    console.log(
      `[WhatsappWebhook][routing][msgId=${messageId}] Resolved — phoneNumberId=${phoneNumberId}, userId=${connection.user_id}`,
    )

    // Profile name comes from contacts array (may not always be present)
    const profileName: string | null = value.contacts?.[0]?.profile?.name ?? null

    const { firstName, lastName, phone } = parseWhatsappLead(from, profileName)

    const lead = await createLeadFromWhatsappWebhook({
      firstName,
      lastName,
      phone,
      messageId,
      agencyId: connection.agency_id,
      userId: connection.user_id,
    })

    if (!lead) {
      console.error(`[WhatsappWebhook][create][msgId=${messageId}] createLeadFromWhatsappWebhook returned null`)
      return NextResponse.json({ ok: true })
    }

    console.log(`[WhatsappWebhook][success][msgId=${messageId}] lead id=${lead.id}`)

    // Additive: persist the message as a conversation attached to the lead.
    // Isolated so any failure here never affects lead creation or the 200 to Meta.
    try {
      const result = await ingestWhatsappInbound({
        agencyId: connection.agency_id,
        leadId: lead.id,
        businessPhoneNumberId: phoneNumberId,
        customerWaId: from,
        customerName: profileName,
        rawMessage: message,
      })
      console.log(
        `[WhatsappWebhook][inbox][msgId=${messageId}] conversation=${result.conversationId} message=${result.messageId} inserted=${result.inserted}`,
      )
      // Instant Response Engine: kick the worker AFTER the 200 is flushed so the
      // auto-response goes out in seconds. Primary path; the cron is the backstop.
      if (result.inserted) {
        after(async () => {
          try {
            await runAutoResponseWorker({ limit: 5 })
          } catch (kickErr) {
            console.error('[auto-response] kick failed', { reason: (kickErr as Error)?.message })
          }
        })
      }
    } catch (err) {
      console.error(`[WhatsappWebhook][inbox][msgId=${messageId}] persistence failed:`, err)
    }

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[WhatsappWebhook] Unhandled error:', err)
    return NextResponse.json({ ok: true })
  }
}
