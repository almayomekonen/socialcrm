import { GRAPH_BASE, GRAPH_VERSION } from '@/lib/facebook/graph'
import { waTrace, type WaTraceCtx } from '@/lib/inbox/autoresponse/waTrace'
import { toIsraeliWhatsappRecipient } from '@/lib/whatsapp/israeliPhone'

export type SendWhatsappTextSuccess = { ok: true; wamid: string }

export type SendWhatsappTextFailure = {
  ok: false
  /** Human-readable message (Graph message, HTTP fallback, or network error). */
  error: string
  /** Graph error `code` when present. */
  code?: string
  /** Graph `error_subcode` when present. */
  subcode?: string
  /** HTTP status from Graph (omitted on network failures). */
  httpStatus?: number
  /** Graph error `type` when present. */
  type?: string
  /** Graph `fbtrace_id` when present. */
  fbtraceId?: string
}

export type SendWhatsappTextResult = SendWhatsappTextSuccess | SendWhatsappTextFailure

type GraphErrorBody = {
  error?: {
    message?: string
    type?: string
    code?: number
    error_subcode?: number
    fbtrace_id?: string
  }
}

/** Compact, queryable string for `auto_response_jobs.lastError` (and logs). */
export function formatWhatsappSendFailure(failure: SendWhatsappTextFailure): string {
  const parts = ['whatsapp_send_failed']
  if (failure.httpStatus != null) parts.push(`http=${failure.httpStatus}`)
  if (failure.code) parts.push(`code=${failure.code}`)
  if (failure.subcode) parts.push(`subcode=${failure.subcode}`)
  if (failure.type) parts.push(`type=${failure.type}`)
  if (failure.fbtraceId) parts.push(`fbtrace=${failure.fbtraceId}`)
  const msg = (failure.error || '').replace(/\s+/g, ' ').trim()
  if (msg) parts.push(`message=${msg.slice(0, 400)}`)
  return parts.join(' ')
}

export async function sendWhatsappText(args: {
  phoneNumberId: string
  accessToken: string
  to: string
  body: string
  trace?: WaTraceCtx
}): Promise<SendWhatsappTextResult> {
  const { phoneNumberId, accessToken, to, body } = args
  // Normalize the recipient to E.164 (Israeli local → 972…). The number reaching
  // Meta and the trace must be the normalized one, or Meta returns 131026.
  const recipient = toIsraeliWhatsappRecipient(to)
  waTrace('WHATSAPP_SEND_REQUEST', args.trace ?? {}, {
    phone_number_id: phoneNumberId,
    graphVersion: GRAPH_VERSION,
    recipient,
    messageLength: (body ?? '').length,
  })
  try {
    const res = await fetch(`${GRAPH_BASE}/${phoneNumberId}/messages`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: recipient,
        type: 'text',
        text: { preview_url: false, body },
      }),
    })

    const data = (await res.json().catch(() => ({}))) as GraphErrorBody & {
      messages?: { id?: string }[]
      error?: GraphErrorBody['error'] & { error_data?: unknown }
    }

    if (!res.ok) {
      const err = data.error
      waTrace('WHATSAPP_SEND_RESPONSE', args.trace ?? {}, {
        ok: false,
        httpStatus: res.status,
        errorCode: err?.code ?? null,
        subcode: (err as { error_subcode?: number } | undefined)?.error_subcode ?? null,
        message: err?.message ?? null,
        error: data.error ?? null,
        error_data: (err as { error_data?: unknown } | undefined)?.error_data ?? null,
        fbtrace_id: err?.fbtrace_id ?? null,
        xFbTraceId: res.headers.get('x-fb-trace-id'),
        xFbRequestId: res.headers.get('x-fb-request-id'),
      })
      console.error('[WhatsappSend] Graph API error', {
        status: res.status,
        code: err?.code,
        subcode: err?.error_subcode,
        type: err?.type,
        fbtrace_id: err?.fbtrace_id,
        message: err?.message,
      })
      return {
        ok: false,
        error: err?.message || `HTTP ${res.status}`,
        code: err?.code != null ? String(err.code) : undefined,
        subcode: err?.error_subcode != null ? String(err.error_subcode) : undefined,
        httpStatus: res.status,
        type: err?.type,
        fbtraceId: err?.fbtrace_id,
      }
    }

    const wamid = data.messages?.[0]?.id
    if (!wamid) {
      console.error('[WhatsappSend] Missing message id in response', data)
      return { ok: false, error: 'no-message-id', httpStatus: res.status }
    }

    waTrace('WHATSAPP_SEND_RESPONSE', args.trace ?? {}, {
      ok: true,
      httpStatus: res.status,
      wamid,
      xFbTraceId: res.headers.get('x-fb-trace-id'),
      xFbRequestId: res.headers.get('x-fb-request-id'),
    })
    return { ok: true, wamid }
  } catch (err) {
    console.error('[WhatsappSend] fetch failed', err)
    return { ok: false, error: (err as Error)?.message || 'network-error' }
  }
}
