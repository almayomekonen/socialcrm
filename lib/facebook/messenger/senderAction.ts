import { graphRequest, type MetaGraphError } from '@/lib/facebook/graphClient'

/**
 * POST /{PAGE-ID}/messages with a `sender_action` — typing indicator / mark seen.
 *
 * Per https://developers.facebook.com/docs/messenger-platform/send-messages/sender-actions
 * (checked 2026-09-23) the request must carry ONLY `recipient` and
 * `sender_action` — no `message`, no `messaging_type`. Meta rejects the call
 * otherwise, so the shape is deliberately not shared with the text sender.
 *
 * The same docs warn against letting "an unnatural amount of time" pass between
 * `typing_on` and `typing_off`; Messenger also expires the indicator on its own
 * after about 20 seconds, which is why the caller refreshes rather than sending
 * one `typing_on` and trusting it to persist.
 */
export type MessengerSenderAction = 'typing_on' | 'typing_off' | 'mark_seen'

export async function sendMessengerSenderAction(input: {
  pageId: string
  pageAccessToken: string
  psid: string
  action: MessengerSenderAction
  fetchImpl?: typeof fetch
}): Promise<{ ok: true } | { ok: false; error: MetaGraphError }> {
  const result = await graphRequest({
    method: 'POST',
    path: `/${encodeURIComponent(input.pageId)}/messages`,
    token: input.pageAccessToken,
    body: { recipient: { id: input.psid }, sender_action: input.action },
    // Shorter than a real send: a typing dot that arrives late is worthless, and
    // it must never hold a request open behind a slow Meta.
    timeoutMs: 4000,
    fetchImpl: input.fetchImpl,
  })
  if ('error' in result) return { ok: false, error: result.error }
  return { ok: true }
}
