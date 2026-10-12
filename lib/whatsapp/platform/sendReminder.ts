import { GRAPH_BASE } from '@/lib/facebook/graph'
import { REMINDER_TEMPLATE, SEND_TIMEOUT_MS } from '@/lib/ownerWhatsappReminders/constants'

/**
 * Send ONE owner reminder from the SocialCRM platform number.
 *
 * Deliberately NOT the agencies' `sendWhatsappTemplate`: that sender logs the
 * full recipient number, has no timeout, has no URL-button parameter and cannot
 * tell "Meta rejected it" from "we do not know". Agency sending is untouched.
 *
 * Outcomes:
 *   sent      HTTP 2xx with a message id.
 *   unknown   timeout, network failure, HTTP 5xx, or a 2xx without a message id.
 *             Meta may have sent it: the caller must NEVER send it again.
 *   rejected  HTTP 4xx. `scope` says what to do next:
 *               rate_limit  retry later (bounded),
 *               account     stop all sends for a while (token, permission,
 *                           payment, template or account problems),
 *               recipient   this recipient only,
 *               other       fail this delivery.
 *
 * Logs carry the delivery id, HTTP status and Meta's error code only: never the
 * number, the token or the payload.
 */

export type ReminderSendOutcome =
  | { kind: 'sent'; wamid: string }
  | { kind: 'unknown'; reason: 'timeout' | 'network' | 'server_error' | 'no_message_id'; httpStatus?: number }
  | { kind: 'rejected'; scope: 'rate_limit' | 'account' | 'recipient' | 'other'; code: string | null; httpStatus: number }

const RATE_LIMIT_CODES = new Set(['4', '80007', '130429', '131056'])
const ACCOUNT_CODES = new Set([
  '0', '3', '10', '100', '190', '200', '368',
  '131031', '131042', '131048', '131051',
  '132000', '132001', '132005', '132007', '132012', '132015', '132016', '132068', '132069',
  '133010', '135000',
])
const RECIPIENT_CODES = new Set(['131026', '131047', '131049', '131050', '131052', '130472'])

export function classifyRejection(code: string | null): 'rate_limit' | 'account' | 'recipient' | 'other' {
  if (code == null) return 'other'
  if (RATE_LIMIT_CODES.has(code)) return 'rate_limit'
  if (ACCOUNT_CODES.has(code)) return 'account'
  if (RECIPIENT_CODES.has(code)) return 'recipient'
  return 'other'
}

export function buildReminderPayload(input: { toDigits: string; waitingText: string; conversationId: number }) {
  return {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: input.toDigits,
    type: 'template',
    template: {
      name: REMINDER_TEMPLATE.name,
      language: { code: REMINDER_TEMPLATE.language },
      components: [
        { type: 'body', parameters: [{ type: 'text', text: input.waitingText }] },
        { type: 'button', sub_type: 'url', index: '0', parameters: [{ type: 'text', text: String(input.conversationId) }] },
      ],
    },
  }
}

export async function sendOwnerReminder(input: {
  phoneNumberId: string
  accessToken: string
  toE164: string
  waitingText: string
  conversationId: number
  deliveryId: number
  timeoutMs?: number
}): Promise<ReminderSendOutcome> {
  const payload = buildReminderPayload({
    toDigits: input.toE164.replace(/\D/g, ''),
    waitingText: input.waitingText,
    conversationId: input.conversationId,
  })
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), input.timeoutMs ?? SEND_TIMEOUT_MS)
  let outcome: ReminderSendOutcome
  try {
    const res = await fetch(`${GRAPH_BASE}/${input.phoneNumberId}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${input.accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal,
    })
    const data = (await res.json().catch(() => null)) as { messages?: { id?: string }[]; error?: { code?: number } } | null
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
  } finally {
    clearTimeout(timer)
  }
  const { kind } = outcome
  const detail = outcome.kind === 'rejected' ? { scope: outcome.scope, code: outcome.code, httpStatus: outcome.httpStatus } : outcome.kind === 'unknown' ? { reason: outcome.reason, httpStatus: outcome.httpStatus ?? null } : {}
  console.log('[OwnerWaReminder][send]', { deliveryId: input.deliveryId, kind, ...detail })
  return outcome
}
