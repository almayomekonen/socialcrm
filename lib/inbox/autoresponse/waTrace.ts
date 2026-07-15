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
      ...extra,
    }
    console.log('[WA-TRACE] ' + stage + ' ' + JSON.stringify(record))
  } catch {
    // logging must never affect the flow
  }
}
