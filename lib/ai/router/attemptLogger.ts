import { logAiRequest } from '../logger'
import type { ProviderName, TaskKind } from '../types'

/**
 * A failed image download reports the URL it tried, and image URLs here are signed. The
 * router logs these messages, so a URL never survives into one.
 */
export function withoutUrls(message: string): string {
  return message.replace(/https?:\/\/[^\s"'<>)]+/g, '[url]')
}

// Per-attempt logging + tracing for runStructured. Splits the success and
// failure paths so the orchestration loop only contains control flow.

const aiTrace = () => process.env.AI_TRACE === '1'

type CommonCtx = {
  kind: TaskKind
  userId: number | null
  agencyId: number | null
  leadId: number | null
  provider: ProviderName
  model: string
  attempt: number
  effectiveRole: string
  fallbackUsed: boolean
  callStartedAt: number
}

export function logAttemptSuccess(
  ctx: CommonCtx & { inputTokens: number; outputTokens: number; costUsd: number; latencyMs: number },
) {
  logAiRequest({
    userId: ctx.userId,
    agencyId: ctx.agencyId,
    leadId: ctx.leadId,
    taskKind: ctx.kind,
    provider: ctx.provider,
    model: ctx.model,
    inputTokens: ctx.inputTokens,
    outputTokens: ctx.outputTokens,
    costUsd: ctx.costUsd,
    latencyMs: ctx.latencyMs,
    success: true,
    errorCode: null,
  })

  if (aiTrace()) {
    // TEMPORARY [AI ROUTER] — successful attempt resolution.
    console.info(
      '[AI ROUTER]',
      JSON.stringify({
        kind: ctx.kind,
        role: ctx.effectiveRole,
        provider: ctx.provider,
        model: ctx.model,
        attempt: ctx.attempt,
        latencyMs: ctx.latencyMs,
        fallbackUsed: ctx.fallbackUsed,
        success: true,
      }),
    )
  }
}

export function logAttemptFailure(ctx: CommonCtx & { errorCode: string; message: string; err: unknown }) {
  console.warn(
    `[ai] router.call.fail provider=${ctx.provider} model=${ctx.model} attempt=${ctx.attempt} code=${ctx.errorCode} msg=${ctx.message}`,
  )

  if (process.env.COPILOT_TRACE === '1') {
    // TEMPORARY [drive.debug] — capture raw model text when generateObject fails to parse.
    const e = ctx.err as { text?: unknown; cause?: { text?: unknown } }
    const rawText = typeof e.text === 'string' ? e.text : typeof e.cause?.text === 'string' ? e.cause.text : null
    console.info('[copilot.trace] structured.rawResponse', {
      kind: ctx.kind,
      provider: ctx.provider,
      model: ctx.model,
      errorCode: ctx.errorCode,
      text: rawText ? rawText.slice(0, 2000) : null,
    })
  }

  if (aiTrace()) {
    console.warn(
      '[AI ROUTER]',
      JSON.stringify({
        kind: ctx.kind,
        role: ctx.effectiveRole,
        provider: ctx.provider,
        model: ctx.model,
        attempt: ctx.attempt,
        latencyMs: Date.now() - ctx.callStartedAt,
        fallbackUsed: ctx.fallbackUsed,
        success: false,
        errorCode: ctx.errorCode,
        message: ctx.message,
      }),
    )
  }

  logAiRequest({
    userId: ctx.userId,
    agencyId: ctx.agencyId,
    leadId: ctx.leadId,
    taskKind: ctx.kind,
    provider: ctx.provider,
    model: ctx.model,
    inputTokens: 0,
    outputTokens: 0,
    costUsd: 0,
    latencyMs: Date.now() - ctx.callStartedAt,
    success: false,
    errorCode: ctx.errorCode,
  })
}

export function logFallbackTrace(ctx: {
  kind: TaskKind
  effectiveRole: string
  from: ProviderName
  to: ProviderName
  toModel: string
  reason: string | undefined
  message: string | undefined
}) {
  if (!aiTrace()) return
  console.warn(
    '[FALLBACK]',
    JSON.stringify({
      kind: ctx.kind,
      role: ctx.effectiveRole,
      from: ctx.from,
      to: ctx.to,
      toModel: ctx.toModel,
      reason: ctx.reason ?? 'unknown',
      message: ctx.message,
    }),
  )
}
