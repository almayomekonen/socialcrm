import { createHash } from 'crypto'
import { runStructured } from '@/lib/ai/router'
import type { AiFailureReason } from '@/lib/ai/types'
import type { AnalysisMessage } from '@/db/conversationIntelligence'
import { NOVELTY_VALUES, type NoveltyKind } from '@/db/conversationIntelligence'
import {
  ACTION_VALUES,
  CONVERSATION_ANALYSIS_PROMPT_VERSION,
  CONVERSATION_ANALYSIS_SYSTEM_PROMPT,
  ConversationAnalysisSchema,
  INTENT_VALUES,
  TEMPERATURE_VALUES,
  buildConversationAnalysisUserMessage,
  type ConversationAnalysis,
  type ConversationIntent,
  type LeadTemperature,
  type SuggestedAction,
} from '@/lib/ai/prompts/conversationAnalysis'

/**
 * Composite conversation analyzer (Phase 3). ONE runStructured call returns
 * summary + intent + lead temperature + suggested action with confidences —
 * the router provides the provider fallback chain, agency allowlist gating,
 * daily spend caps, cost estimation and per-attempt logging. Worker-only:
 * nothing in the render path imports this module. The suggested action is a
 * recommendation only — nothing executes it.
 */

export const ANALYZER_VERSION = 'analysis-v4'
export const ANALYZER_SCHEMA_VERSION = 3
export const promptVersion = String(CONVERSATION_ANALYSIS_PROMPT_VERSION)

export type ConversationAnalyzerInput = {
  conversationId: number
  agencyId: number
  leadId: number | null
  channel: string
  leadName: string | null
  leadStatus: string | null
  customerName: string | null
  messages: AnalysisMessage[]
}

export type ConversationAnalyzerSuccess = {
  ok: true
  summary: { summary: string }
  intent: { intent: ConversationIntent; confidence: string }
  temperature: { temperature: LeadTemperature; confidence: string }
  action: {
    suggestedAction: SuggestedAction
    confidence: string
    reason: string
    actionMessage: string
    noveltyKind: NoveltyKind
    sourceMessageIds: number[]
  }
  inputHash: string
  modelProvider: string
  modelId: string
  inputTokens: number
  outputTokens: number
  costUsd: number
  latencyMs: number
}

export type ConversationAnalyzerFailure = {
  ok: false
  reason: AiFailureReason | 'empty-conversation' | 'invalid-output'
  /** Retryable failures go through job backoff; terminal ones fail the job outright. */
  retryable: boolean
  message?: string
}

export type ConversationAnalyzerResult = ConversationAnalyzerSuccess | ConversationAnalyzerFailure

/** Transient failures worth retrying; config/permission states are terminal. */
const RETRYABLE: ReadonlySet<string> = new Set(['over-quota', 'all-providers-failed'])

export function hashAnalysisInput(messages: AnalysisMessage[]): string {
  const normalized = messages.map((m) => `${m.sequence}:${m.direction}:${m.text}`).join('\n')
  return createHash('sha256').update(normalized).digest('hex')
}

export async function runConversationAnalyzer(input: ConversationAnalyzerInput): Promise<ConversationAnalyzerResult> {
  const meaningful = input.messages.filter((m) => m.text.trim().length > 0)
  if (meaningful.length === 0) {
    return { ok: false, reason: 'empty-conversation', retryable: false }
  }

  const inputHash = hashAnalysisInput(input.messages)
  const user = buildConversationAnalysisUserMessage({
    channel: input.channel,
    leadName: input.leadName,
    leadStatus: input.leadStatus,
    customerName: input.customerName,
    messages: input.messages,
  })

  const out = await runStructured({
    kind: 'conversation.analysis',
    schema: ConversationAnalysisSchema,
    schemaName: 'ConversationAnalysis',
    schemaDescription: 'ניתוח שיחה בין ליד לנציג: סיכום, כוונה וחום הליד',
    system: CONVERSATION_ANALYSIS_SYSTEM_PROMPT,
    user,
    agencyId: input.agencyId,
    leadId: input.leadId,
  })

  if (out.ok === false) {
    return { ok: false, reason: out.reason, retryable: RETRYABLE.has(out.reason), message: out.message }
  }

  const data = out.data as ConversationAnalysis
  const summary = data.summary?.trim()
  if (
    !summary ||
    !isOneOf(data.intent, INTENT_VALUES) ||
    !isOneOf(data.temperature, TEMPERATURE_VALUES) ||
    !isOneOf(data.suggestedAction, ACTION_VALUES)
  ) {
    return { ok: false, reason: 'invalid-output', retryable: true }
  }

  // Operator Take grounding (Law 1): keep only cited sequences that exist in the
  // analyzed set, then translate to message ids. A take with text but no grounded
  // citation is dropped to an empty id list here and never surfaces.
  const seqToId = new Map(input.messages.map((m) => [m.sequence, m.id]))
  const groundedIds = (Array.isArray(data.sourceSequences) ? data.sourceSequences : [])
    .filter((s) => seqToId.has(s))
    .map((s) => seqToId.get(s) as number)
  const noveltyKind: NoveltyKind = (NOVELTY_VALUES as readonly string[]).includes(data.noveltyKind)
    ? (data.noveltyKind as NoveltyKind)
    : 'none'
  const actionMessage = data.actionMessage?.trim() ?? ''

  return {
    ok: true,
    summary: { summary },
    intent: { intent: data.intent, confidence: data.intentConfidence },
    temperature: { temperature: data.temperature, confidence: data.temperatureConfidence },
    action: {
      suggestedAction: data.suggestedAction,
      confidence: data.actionConfidence,
      reason: data.actionReason?.trim() ?? '',
      actionMessage,
      noveltyKind,
      sourceMessageIds: actionMessage && groundedIds.length > 0 ? groundedIds : [],
    },
    inputHash,
    modelProvider: out.provider,
    modelId: out.model,
    inputTokens: out.inputTokens,
    outputTokens: out.outputTokens,
    costUsd: out.costUsd,
    latencyMs: out.latencyMs,
  }
}

function isOneOf<T extends string>(value: string, values: readonly T[]): value is T {
  return (values as readonly string[]).includes(value)
}
