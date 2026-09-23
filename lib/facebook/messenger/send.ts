import { graphRequest, type MetaGraphError } from '@/lib/facebook/graphClient'
import { buildMessengerMessage, type MessengerRichContent } from '@/lib/facebook/messenger/structured'

/**
 * POST /{PAGE-ID}/messages — one reply inside the standard window.
 *
 * `messaging_type: RESPONSE` only. SocialCRM never sends UPDATE (proactive) or
 * MESSAGE_TAG: a reply exists because the person wrote first, and no tag has
 * been requested in App Review. The caller has already verified the window.
 */

type SendOutcome = { ok: true; mid: string } | { ok: false; error: MetaGraphError }

function readMid(data: { message_id?: string } | undefined, status: number): SendOutcome {
  const mid = data?.message_id
  if (typeof mid !== 'string' || !mid) {
    return {
      ok: false,
      error: { kind: 'invalid_response', status, code: null, subcode: null, type: null, message: null },
    }
  }
  return { ok: true, mid }
}

/** Plain text. Kept as its own entry point — it is the overwhelmingly common send. */
export async function sendMessengerText(input: {
  pageId: string
  pageAccessToken: string
  psid: string
  text: string
  fetchImpl?: typeof fetch
}): Promise<SendOutcome> {
  return sendMessengerMessage({ ...input, content: {} })
}

/**
 * Text, quick replies, a button/generic template, or an attachment by URL.
 *
 * The `message` object is built by `structured.ts`, which owns Meta's limits and
 * has already been given a validated shape. A `null` message means the caller
 * asked to send nothing — refused here rather than at Meta, where it returns an
 * opaque code.
 */
export async function sendMessengerMessage(input: {
  pageId: string
  pageAccessToken: string
  psid: string
  text: string
  content: MessengerRichContent
  fetchImpl?: typeof fetch
}): Promise<SendOutcome> {
  const message = buildMessengerMessage(input.text, input.content)
  if (!message) {
    return {
      ok: false,
      error: { kind: 'invalid_response', status: 0, code: null, subcode: null, type: null, message: null },
    }
  }

  const result = await graphRequest<{ recipient_id?: string; message_id?: string }>({
    method: 'POST',
    path: `/${encodeURIComponent(input.pageId)}/messages`,
    token: input.pageAccessToken,
    body: {
      recipient: { id: input.psid },
      messaging_type: 'RESPONSE',
      message,
    },
    fetchImpl: input.fetchImpl,
  })
  if ('error' in result) return { ok: false, error: result.error }
  return readMid(result.data, 200)
}
