/**
 * [AGENT-TRACE] — structured, observability-ONLY logging for one investigation.
 *
 * Mirrors lib/inbox/autoresponse/waTrace.ts: one line per checkpoint, a stable
 * prefix, the investigation's identity on every record, and the whole emit
 * wrapped so logging can never throw into the flow. This module changes no
 * behavior and is never read by the Agent.
 *
 * Never log customer message text or any other content here — trace records
 * carry identifiers, decisions and counts.
 */
export interface AgentTraceCtx {
  investigationId?: string | null
  agencyId?: number | string | null
  userId?: number | string | null
}

export function agentTrace(
  stage: string,
  ctx: AgentTraceCtx = {},
  extra: Record<string, unknown> = {},
): void {
  try {
    const record = {
      stage,
      timestamp: new Date().toISOString(),
      investigationId: ctx.investigationId ?? null,
      agencyId: ctx.agencyId ?? null,
      userId: ctx.userId ?? null,
      ...extra,
    }
    console.log('[AGENT-TRACE] ' + stage + ' ' + JSON.stringify(record))
  } catch {
    // logging must never affect the flow
  }
}
