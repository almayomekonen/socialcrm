import { createHmac, timingSafeEqual } from 'crypto'
import { NextRequest, NextResponse, after } from 'next/server'
import { runAutoResponseKick } from '@/lib/inbox/autoresponse/kickWorker'
import { handleInboundWebhookMessage } from '@/lib/whatsapp/handleInboundWebhookMessage'
import { ingestWhatsappStatuses } from '@/lib/inbox/ingestWhatsappStatuses'
import { ingestTemplateStatusUpdate } from '@/lib/whatsapp/templates/ingestStatus'
import { isCoexistenceWebhookField, processCoexistenceWebhook } from '@/lib/whatsapp/coexistence'
import { db } from '@/config/db'
import { track } from '@/lib/analytics/track'

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

  const change = body?.entry?.[0]?.changes?.[0]

  // Coexistence webhooks, handled FIRST and terminally — before the `value`
  // shape check, so history / smb_app_state_sync / smb_message_echoes always
  // reach this pipeline rather than being dropped as "invalid payload".
  //
  // `smb_message_echoes` carries messages the BUSINESS sent from their own
  // phone. If one of those were treated as inbound it would create a lead from
  // the business's own message and could fire an automated reply at a real
  // customer — the single worst failure mode this feature could introduce.
  // `history` and `smb_app_state_sync` are likewise not new inbound traffic.
  const incomingField = change?.field
  if (typeof incomingField === 'string' && isCoexistenceWebhookField(incomingField)) {
    // Awaited: `smb_message_echoes` now persists the business's own outbound
    // traffic, and a fire-and-forget call could be cut short when the function
    // returns. `history` records the delivery durably and returns — the archive
    // is imported later by a worker, never inside this request — and only when
    // HISTORY_SYNC_ENABLED is lifted; today that branch cannot be taken.
    // `smb_app_state_sync` still does nothing but acknowledge.
    const coexistence = await processCoexistenceWebhook(incomingField, change?.value)
    // A coexistence field is acknowledged only when it was actually handled.
    // Today only `history` can refuse, and only when its durable write failed:
    // Meta redelivers on a non-2xx, and a one-shot archive has no second
    // chance, so answering 200 for a delivery we did not store would destroy it.
    // 503 rather than 500 — the work is retryable, nothing about it is invalid.
    if (!coexistence.ok) {
      console.error('[WhatsappWebhook][coexistence] not acknowledged', {
        field: incomingField,
        reason: coexistence.reason,
      })
      return NextResponse.json({ ok: false, error: coexistence.reason }, { status: 503 })
    }
    return NextResponse.json({ ok: true })
  }

  const value = change?.value
  if (!value) {
    console.warn('[WhatsappWebhook] Invalid payload structure')
    return NextResponse.json({ ok: true })
  }

  // Delivery lifecycle: statuses carry sent/delivered/read/failed for messages we
  // already sent. Processed before (and independently of) the messages path — a
  // single payload may legitimately carry both. Wrapped so a status-processing
  // failure can never break inbound message handling, and never returns non-200:
  // Meta retries on failure and can disable the subscription.
  const statuses = value.statuses
  if (Array.isArray(statuses) && statuses.length) {
    try {
      await ingestWhatsappStatuses(value.metadata?.phone_number_id, statuses)
    } catch (err) {
      console.error('[WhatsappWebhook][status] ingestion failed', { error: String(err) })
    }
  }

  // Template lifecycle: approval / rejection / quality updates for message
  // templates, keyed by the WABA id (entry.id). Fully separate from the messages
  // and delivery-statuses paths and from the auto-response worker — it returns
  // here and never sends or automates anything. Fail-safe: always 200.
  const field = change?.field
  if (field === 'message_template_status_update' || field === 'message_template_quality_update') {
    try {
      await ingestTemplateStatusUpdate(body?.entry?.[0]?.id, field, change?.value)
    } catch (err) {
      console.error('[WhatsappWebhook][template] ingestion failed', { error: String(err) })
    }
    return NextResponse.json({ ok: true })
  }

  /**
   * EVERY message in the payload, in order.
   *
   * Meta may batch several messages into one webhook, and this route used to
   * take `messages[0]` and drop the rest. Under the AI agent that lost a
   * sentence the next turn usually recovered from the transcript. A
   * questionnaire asks one question and waits for one answer: an answer that is
   * never persisted is never answered, and nothing re-reads it later.
   *
   * Sequential, not parallel: messages in one payload are ordered, and the
   * per-conversation row lock in the message insert would serialize them
   * anyway. Each is isolated, so one bad message cannot cost the others.
   */
  const messages: Array<Record<string, unknown>> = Array.isArray(value.messages) ? value.messages : []
  if (!messages.length) {
    return NextResponse.json({ ok: true })
  }
  const entries = Array.isArray(body?.entry) ? body.entry.length : 0
  const changes = Array.isArray(body?.entry?.[0]?.changes) ? body.entry[0].changes.length : 0
  if (entries > 1 || changes > 1) {
    // Observability only. Meta's documented shape is one change per entry; if
    // this ever fires, the loop above needs to cover those dimensions too.
    console.warn('[WhatsappWebhook] payload carries multiple entries/changes', { entries, changes })
  }

  try {
    const phoneNumberId: string | undefined = value.metadata?.phone_number_id
    if (!phoneNumberId) {
      console.warn('[WhatsappWebhook] Missing phone_number_id — ignoring')
      return NextResponse.json({ ok: true })
    }

    // Resolve tenant via phone_number_id — this is the multi-tenant mapping
    const connection = await db('whatsapp_connections').where({ phone_number_id: phoneNumberId }).first()
    if (!connection) {
      console.warn(`[WhatsappWebhook] No DB connection for phoneNumberId=${phoneNumberId} — ignoring`)
      return NextResponse.json({ ok: true })
    }

    // Profile name comes from contacts array (may not always be present)
    const profileName: string | null = value.contacts?.[0]?.profile?.name ?? null

    let kick = false
    let delaySeconds = Number.POSITIVE_INFINITY
    for (const message of messages) {
      const messageId = message.id as string | undefined
      const from = message.from as string | undefined
      if (!messageId || !from) {
        console.warn('[WhatsappWebhook] Missing required fields — ignoring one message')
        // Observability for the sender WhatsApp may stop identifying by phone
        // once users adopt usernames (`from` omitted, `from_user_id` present).
        // Privacy-safe: no content, no phone, no user id, no message id.
        if (!from) {
          await track({
            agencyId: Number(connection.agency_id),
            event: 'whatsapp_sender_unresolved',
            props: {
              reason: 'missing_from',
              hasUserId: typeof message.from_user_id === 'string' && message.from_user_id.length > 0,
              hasMessageId: Boolean(messageId),
              messageType: typeof message.type === 'string' ? message.type.slice(0, 32) : null,
            },
          })
        }
        continue
      }
      console.log(
        `[WhatsappWebhook][routing][msgId=${messageId}] Resolved — phoneNumberId=${phoneNumberId}, userId=${connection.user_id}`,
      )
      try {
        const handled = await handleInboundWebhookMessage({
          message: message as never,
          phoneNumberId,
          profileName,
          connection,
        })
        if (handled.kick) {
          kick = true
          delaySeconds = Math.min(delaySeconds, handled.delaySeconds)
        }
      } catch (messageErr) {
        console.error(`[WhatsappWebhook][message][msgId=${messageId}] failed:`, messageErr)
      }
    }

    // One drain for the whole payload, waiting only until the FIRST job is due.
    // The minute-ly cron remains the backstop for anything still pending.
    if (kick) {
      after(async () => {
        try {
          const r = await runAutoResponseKick({
            delaySeconds: Number.isFinite(delaySeconds) ? delaySeconds : 0,
            limit: 5,
          })
          console.log(`[IRE] kick worker done ${JSON.stringify(r)}`)
        } catch (kickErr) {
          console.error('[auto-response] kick failed', { reason: (kickErr as Error)?.message })
        }
      })
    }

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[WhatsappWebhook] Unhandled error:', err)
    return NextResponse.json({ ok: true })
  }
}
