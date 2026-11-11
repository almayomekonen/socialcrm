import { GRAPH_BASE } from '@/lib/facebook/graph'
import { SEND_TIMEOUT_MS } from '@/lib/ownerWhatsappReminders/constants'
import { classifyRejection } from './sendReminder'

/**
 * Free-text replies from the SocialCRM platform number, for the WhatsApp
 * assistant only. A reply is only ever sent to a person who has just written to
 * us (Meta's customer-service window); the caller enforces that window and the
 * "never twice" rule (wa_assistant_jobs.replyState).
 *
 * Outcomes mirror sendReminder.ts: `sent` (2xx + message id), `unknown`
 * (timeout, network, 5xx, 2xx without id; NEVER retried) or `rejected`.
 * Logs carry the job id, HTTP status and Meta's code only: never the number,
 * the token or the text.
 */

export type PlatformTextOutcome =
  | { kind: 'sent'; wamid: string }
  | { kind: 'unknown'; reason: 'timeout' | 'network' | 'server_error' | 'no_message_id'; httpStatus?: number }
  | { kind: 'rejected'; scope: 'rate_limit' | 'account' | 'recipient' | 'other'; code: string | null; httpStatus: number }

export const MAX_REPLY_CHARS = 1600
export const TYPING_TIMEOUT_MS = 3_000

export function buildPlatformTextPayload(input: { toDigits: string; body: string; replyToWamid?: string | null }) {
  return {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: input.toDigits,
    type: 'text',
    text: { preview_url: false, body: input.body.slice(0, MAX_REPLY_CHARS) },
    ...(input.replyToWamid ? { context: { message_id: input.replyToWamid } } : {}),
  }
}

/** Meta's reply-button limits: body 1024 characters, up to 3 buttons, title 20, id 256. */
export const MAX_BUTTON_BODY_CHARS = 1024
export type ReplyButton = { id: string; title: string }
/** A PDF shown above the buttons. Meta fetches `link` once, when the message is sent. */
export type ReplyDocument = { link: string; filename: string }

export function buildPlatformButtonsPayload(input: { toDigits: string; body: string; buttons: readonly ReplyButton[]; document?: ReplyDocument | null; replyToWamid?: string | null }) {
  return {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: input.toDigits,
    type: 'interactive',
    interactive: {
      type: 'button',
      ...(input.document ? { header: { type: 'document', document: { link: input.document.link, filename: input.document.filename } } } : {}),
      body: { text: input.body.slice(0, MAX_BUTTON_BODY_CHARS) },
      action: { buttons: input.buttons.slice(0, 3).map((b) => ({ type: 'reply', reply: { id: b.id.slice(0, 256), title: b.title.slice(0, 20) } })) },
    },
    ...(input.replyToWamid ? { context: { message_id: input.replyToWamid } } : {}),
  }
}

async function post(phoneNumberId: string, accessToken: string, payload: unknown, timeoutMs: number) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(`${GRAPH_BASE}/${phoneNumberId}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal,
    })
    const data = (await res.json().catch(() => null)) as { messages?: { id?: string }[]; error?: { code?: number } } | null
    return { res, data }
  } finally {
    clearTimeout(timer)
  }
}

export async function sendPlatformText(input: {
  phoneNumberId: string
  accessToken: string
  toE164: string
  body: string
  replyToWamid?: string | null
  /** Reply buttons (an interactive message) instead of plain text. Same outcomes, same never-resend rule. */
  buttons?: readonly ReplyButton[]
  /** Only with `buttons`: the PDF the owner is being asked about. */
  document?: ReplyDocument | null
  jobId: number
  timeoutMs?: number
}): Promise<PlatformTextOutcome> {
  const toDigits = input.toE164.replace(/\D/g, '')
  const payload = input.buttons?.length
    ? buildPlatformButtonsPayload({ toDigits, body: input.body, buttons: input.buttons, document: input.document, replyToWamid: input.replyToWamid })
    : buildPlatformTextPayload({ toDigits, body: input.body, replyToWamid: input.replyToWamid })
  let outcome: PlatformTextOutcome
  try {
    const { res, data } = await post(input.phoneNumberId, input.accessToken, payload, input.timeoutMs ?? SEND_TIMEOUT_MS)
    if (res.ok) {
      const wamid = data?.messages?.[0]?.id
      outcome = wamid ? { kind: 'sent', wamid } : { kind: 'unknown', reason: 'no_message_id', httpStatus: res.status }
    } else if (res.status >= 500) {
      outcome = { kind: 'unknown', reason: 'server_error', httpStatus: res.status }
    } else {
      const code = data?.error?.code != null ? String(data.error.code) : null
      outcome = { kind: 'rejected', scope: classifyRejection(code), code, httpStatus: res.status }
    }
  } catch (err) {
    outcome = { kind: 'unknown', reason: (err as Error)?.name === 'AbortError' ? 'timeout' : 'network' }
  }
  const detail = outcome.kind === 'rejected' ? { scope: outcome.scope, code: outcome.code, httpStatus: outcome.httpStatus } : outcome.kind === 'unknown' ? { reason: outcome.reason } : {}
  console.log('[WaAssistant][send]', { jobId: input.jobId, kind: outcome.kind, ...detail })
  return outcome
}

/**
 * "Read" plus a typing indicator on the owner's message: the instant feedback
 * that the assistant is working. Best effort and not a message: a failure is
 * logged and ignored, and it never affects the reply.
 */
export async function sendPlatformTypingIndicator(input: { phoneNumberId: string; accessToken: string; inboundWamid: string; jobId: number }): Promise<void> {
  try {
    const { res } = await post(
      input.phoneNumberId,
      input.accessToken,
      { messaging_product: 'whatsapp', status: 'read', message_id: input.inboundWamid, typing_indicator: { type: 'text' } },
      TYPING_TIMEOUT_MS,
    )
    if (!res.ok) console.log('[WaAssistant][typing] not accepted', { jobId: input.jobId, httpStatus: res.status })
  } catch {
    console.log('[WaAssistant][typing] failed', { jobId: input.jobId })
  }
}
