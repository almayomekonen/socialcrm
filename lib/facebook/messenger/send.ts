import { graphRequest, type MetaGraphError } from '@/lib/facebook/graphClient'

/**
 * POST /{PAGE-ID}/messages — one text reply inside the standard window.
 *
 * `messaging_type: RESPONSE` only. SocialCRM never sends UPDATE (proactive) or
 * MESSAGE_TAG: a reply exists because the person wrote first, and no tag has
 * been requested in App Review. The caller has already verified the window.
 */
export async function sendMessengerText(input: {
  pageId: string
  pageAccessToken: string
  psid: string
  text: string
}): Promise<{ ok: true; mid: string } | { ok: false; error: MetaGraphError }> {
  const result = await graphRequest<{ recipient_id?: string; message_id?: string }>({
    method: 'POST',
    path: `/${encodeURIComponent(input.pageId)}/messages`,
    token: input.pageAccessToken,
    body: {
      recipient: { id: input.psid },
      messaging_type: 'RESPONSE',
      message: { text: input.text },
    },
  })
  if ('error' in result) return { ok: false, error: result.error }
  const mid = result.data?.message_id
  if (typeof mid !== 'string' || !mid) {
    return {
      ok: false,
      error: { kind: 'invalid_response', status: 200, code: null, subcode: null, type: null, message: null },
    }
  }
  return { ok: true, mid }
}
