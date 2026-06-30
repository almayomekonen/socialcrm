import { GRAPH_BASE } from '@/lib/facebook/graph'

export type SendWhatsappTextResult = { ok: true; wamid: string } | { ok: false; error: string; code?: string }

export async function sendWhatsappText(args: {
  phoneNumberId: string
  accessToken: string
  to: string
  body: string
}): Promise<SendWhatsappTextResult> {
  const { phoneNumberId, accessToken, to, body } = args
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
        to,
        type: 'text',
        text: { preview_url: false, body },
      }),
    })

    const data = await res.json().catch(() => ({}) as Record<string, unknown>)

    if (!res.ok) {
      const err = (data as { error?: { message?: string; code?: number; error_subcode?: number } }).error
      console.error('[WhatsappSend] Graph API error', {
        status: res.status,
        code: err?.code,
        subcode: err?.error_subcode,
        message: err?.message,
      })
      return { ok: false, error: err?.message || `HTTP ${res.status}`, code: err?.code != null ? String(err.code) : undefined }
    }

    const wamid = (data as { messages?: { id?: string }[] }).messages?.[0]?.id
    if (!wamid) {
      console.error('[WhatsappSend] Missing message id in response', data)
      return { ok: false, error: 'no-message-id' }
    }

    return { ok: true, wamid }
  } catch (err) {
    console.error('[WhatsappSend] fetch failed', err)
    return { ok: false, error: (err as Error)?.message || 'network-error' }
  }
}
