export type TaskKind =
  | 'lead.summary'
  | 'lead.classify'
  | 'lead.followup'
  | 'lead.nextStep'
  | 'lead.askQuestion'
  | 'pipeline.weekly'
  | 'health.check'
  | 'copilot.classifyIntent'
  | 'conversation.analysis'

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

export type AiFailureReason = 'disabled' | 'forbidden' | 'no-providers' | 'over-quota' | 'all-providers-failed' | 'invalid-input'

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
