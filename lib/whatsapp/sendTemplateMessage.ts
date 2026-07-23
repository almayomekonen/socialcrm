import { GRAPH_BASE, GRAPH_VERSION } from '@/lib/facebook/graph'
import { waTrace, type WaTraceCtx } from '@/lib/inbox/autoresponse/waTrace'
import { toIsraeliWhatsappRecipient } from '@/lib/whatsapp/israeliPhone'
import type { SendWhatsappTextResult } from '@/lib/whatsapp/sendMessage'

/**
 * Send an APPROVED template message to a single recipient.
 *
 * Additive sibling of `sendWhatsappText` (RFC §11 seam): it reuses the exact same
 * recipient normalization (Israeli local → 972…) and the same structured
 * success/failure envelope (`SendWhatsappTextResult`), but posts a
 * `type: 'template'` payload. A template message delivers even after the 24-hour
 * customer-care window has closed — that is the whole point of this path. It does
 * NOT touch the free-text send, so nothing about ordinary replies changes.
 */

export type SendWhatsappTemplateArgs = {
  phoneNumberId: string
  accessToken: string
  to: string
  /** The Meta template `name` (machine slug) of an approved template. */
  name: string
  /** BCP-47 language code the template was created with (e.g. `he`). */
  language: string
  /** Positional body params in `{{1}},{{2}}…` order; each must be non-empty. */
  params: string[]
  trace?: WaTraceCtx
}

export async function sendWhatsappTemplate(args: SendWhatsappTemplateArgs): Promise<SendWhatsappTextResult> {
  const { phoneNumberId, accessToken, to, name, language, params } = args
  // Same normalization as the text path — the number reaching Meta must be E.164.
  const recipient = toIsraeliWhatsappRecipient(to)
  const components =
    params.length > 0 ? [{ type: 'body', parameters: params.map((text) => ({ type: 'text', text })) }] : []

  waTrace('WHATSAPP_SEND_REQUEST', args.trace ?? {}, {
    phone_number_id: phoneNumberId,
    graphVersion: GRAPH_VERSION,
    recipient,
    kind: 'template',
    templateName: name,
    paramCount: params.length,
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
        type: 'template',
        template: {
          name,
          language: { code: language },
          ...(components.length ? { components } : {}),
        },
      }),
    })

    const data = (await res.json().catch(() => ({}))) as {
      messages?: { id?: string }[]
      error?: { message?: string; type?: string; code?: number; error_subcode?: number; fbtrace_id?: string }
    }

    if (!res.ok) {
      const err = data.error
      waTrace('WHATSAPP_SEND_RESPONSE', args.trace ?? {}, {
        ok: false,
        httpStatus: res.status,
        errorCode: err?.code ?? null,
        subcode: err?.error_subcode ?? null,
        message: err?.message ?? null,
        fbtrace_id: err?.fbtrace_id ?? null,
        xFbTraceId: res.headers.get('x-fb-trace-id'),
        xFbRequestId: res.headers.get('x-fb-request-id'),
      })
      console.error('[WhatsappTemplateSend] Graph API error', {
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
      console.error('[WhatsappTemplateSend] Missing message id in response', data)
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
    console.error('[WhatsappTemplateSend] fetch failed', err)
    return { ok: false, error: (err as Error)?.message || 'network-error' }
  }
}
