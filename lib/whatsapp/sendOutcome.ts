/**
 * When a WhatsApp send has an UNKNOWN outcome, shared by both customer send
 * primitives (sendMessage.ts, sendTemplateMessage.ts) so they cannot drift.
 *
 * A Meta Graph error body (`{ error: { … } }`) is an answer: Meta looked at the
 * request and refused it, so nothing was delivered. Everything below is NOT an
 * answer, and the message may already be on the customer's phone:
 *
 *   - the request timed out, or the connection dropped or reset (no response);
 *   - a non-2xx response WITHOUT a Graph error body (a gateway or edge error,
 *     e.g. an HTML 502/504 page, which says nothing about the message);
 *   - a 2xx response with no message id, or a body that could not be read.
 *
 * Those are reported as `ambiguous: true`. Callers must never resend them
 * automatically. A failure before the request is made (the opt-out gate, a
 * missing recipient) is never ambiguous: nothing left this process.
 */

/**
 * Upper bound for one automated Graph send. Comfortably below the 60 s function
 * limit and the 60 s auto-response lease, so a hung request ends as a reported
 * ambiguous outcome instead of a killed worker whose job is later reclaimed.
 */
export const AUTOMATED_SEND_TIMEOUT_MS = 15_000

export type UnknownOutcome = { ok: false; error: string; httpStatus?: number; ambiguous: true }

export function hasGraphErrorBody(data: unknown): boolean {
  if (!data || typeof data !== 'object') return false
  const err = (data as { error?: unknown }).error
  return !!err && typeof err === 'object'
}

/** A non-2xx response that carries no Graph error body: we cannot tell whether Meta accepted it. */
export function unknownHttpOutcome(status: number): UnknownOutcome {
  return { ok: false, error: `HTTP ${status} without a Graph error body`, httpStatus: status, ambiguous: true }
}

/** A 2xx response we could not read a message id from: most likely accepted. */
export function missingMessageIdOutcome(status: number): UnknownOutcome {
  return { ok: false, error: 'no-message-id', httpStatus: status, ambiguous: true }
}

/** The request left this process and no response came back. */
export function transportFailureOutcome(err: unknown): UnknownOutcome {
  const name = (err as Error)?.name
  const timedOut = name === 'TimeoutError' || name === 'AbortError'
  return { ok: false, error: timedOut ? 'send-timeout' : (err as Error)?.message || 'network-error', ambiguous: true }
}

export function timeoutSignal(timeoutMs: number | undefined): AbortSignal | undefined {
  const ms = Number(timeoutMs)
  return Number.isFinite(ms) && ms > 0 ? AbortSignal.timeout(Math.floor(ms)) : undefined
}
