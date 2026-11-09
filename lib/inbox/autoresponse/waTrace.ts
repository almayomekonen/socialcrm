/**
 * [WA-TRACE] — structured, observability-ONLY logging for the WhatsApp
 * auto-response pipeline. This module changes no behavior: every emit is a pure
 * console line wrapped so it can never throw into the flow. One line per
 * checkpoint, with a stable prefix and the required context on every record.
 */
export interface WaTraceCtx {
  conversationId?: number | string | null
  jobId?: number | string | null
  agencyId?: number | string | null
  messageId?: number | string | null
  triggerSequence?: number | string | null
}

/** Fields holding a customer's number. `phone_number_id` is the business's own id and stays. */
const PHONE_FIELDS = new Set(['recipient', 'phoneNumber'])
/** Fields holding text a provider wrote, which may quote a number, link or token. */
const PROVIDER_TEXT_FIELDS = new Set(['message', 'error', 'error_data'])

/** Enough to tell two guests apart in a trace, never enough to reach one. */
export function maskPhone(value: unknown): string | null {
  if (value == null || value === '') return null
  const digits = String(value).replace(/\D/g, '')
  return digits.length > 4 ? `***${digits.slice(-4)}` : '***'
}

export function redactLogText<T extends string | null | undefined>(text: T): T | string {
  if (!text) return text
  return text
    .replace(/https?:\/\/[^\s"'<>]+/gi, '<url>')
    .replace(/Bearer\s+\S+/gi, 'Bearer <redacted>')
    .replace(/\bEAA[A-Za-z0-9]{20,}\b/g, '<token>')
    .replace(/(?<![\w.])\+?\d(?:[\s-]?\d){7,14}(?!\w)/g, '<phone>')
}

function redactProviderValue(value: unknown): unknown {
  if (typeof value === 'string') return redactLogText(value)
  if (Array.isArray(value)) return value.map(redactProviderValue)
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, redactProviderValue(v)]))
  }
  return value
}

function redactTraceFields(extra: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(extra).map(([key, value]) => {
      if (PHONE_FIELDS.has(key)) return [key, maskPhone(value)]
      return [key, PROVIDER_TEXT_FIELDS.has(key) ? redactProviderValue(value) : value]
    }),
  )
}

export function waTrace(stage: string, ctx: WaTraceCtx = {}, extra: Record<string, unknown> = {}): void {
  try {
    const record = {
      stage,
      timestamp: new Date().toISOString(),
      conversationId: ctx.conversationId ?? null,
      jobId: ctx.jobId ?? null,
      agencyId: ctx.agencyId ?? null,
      messageId: ctx.messageId ?? null,
      triggerSequence: ctx.triggerSequence ?? null,
      ...redactTraceFields(extra),
    }
    console.log('[WA-TRACE] ' + stage + ' ' + JSON.stringify(record))
  } catch {
    // logging must never affect the flow
  }
}
