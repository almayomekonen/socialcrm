export type TaskKind =
  | 'lead.summary'
  | 'lead.classify'
  | 'lead.followup'
  | 'lead.nextStep'
  | 'lead.askQuestion'
  | 'pipeline.weekly'
  | 'health.check'
  | 'copilot.classifyIntent'
  | 'copilot.generalReason'
  | 'conversation.analysis'
  | 'inbox.autoResponse'
  | 'agent.investigate'

export type ProviderName = 'anthropic' | 'google' | 'openai' | 'internal'

export type ModelRole = 'primary' | 'volume' | 'heavy' | 'fallback'

export type AiSuccess<T> = {
  ok: true
  data: T
  provider: ProviderName
  model: string
  inputTokens: number
  outputTokens: number
  costUsd: number
  latencyMs: number
}

export type AiFailureReason =
  | 'disabled'
  | 'forbidden'
  | 'no-providers'
  | 'over-quota'
  | 'all-providers-failed'
  | 'invalid-input'
  // Product-access denials (Phase 2). Distinct, typed business reasons — never a
  // fake provider error — so the client can show the correct upgrade/activation
  // message. See lib/ai/access.ts.
  | 'subscription-required'
  | 'trial-not-started'
  // The included requests and purchased credits are used up (lib/credits/copilotRequest.ts).
  | 'ai-credits-exhausted'

export type AiFailure = {
  ok: false
  reason: AiFailureReason
  message?: string
  latencyMs?: number
}

export type AiRunResult<T> = AiSuccess<T> | AiFailure

export type AiRequestLog = {
  userId: number | null
  agencyId: number | null
  leadId: number | null
  taskKind: TaskKind
  provider: ProviderName | null
  model: string | null
  inputTokens: number
  outputTokens: number
  costUsd: number
  latencyMs: number
  success: boolean
  errorCode: string | null
  createdAt: string
}
