import { db } from '@/config/db'
import type { ProviderName, ModelRole } from '@/lib/ai/types'

/**
 * Execution-truth layer. Every AI generation attempt records a row here. This
 * is the ONLY place provider names and model IDs are stored — the messages
 * table is provider-blind on purpose, so UI queries can never accidentally
 * surface them.
 *
 * Phase 1: one row per generation, linked to the assistant message it produced.
 * Phase 3+ will write multiple rows per message (one per fallback-chain attempt)
 * and add `streamingState` transitions.
 *
 * Writes here are fire-and-forget. A row that fails to insert must never break
 * the user-visible action. This mirrors the existing `logAiRequest` contract.
 */

export type RunStreamingState = 'none' | 'streamed' | 'aborted' | 'reconnected'

export type RecordRunInput = {
  messageId: number | null
  conversationId: number | null
  agencyId: number
  leadId: number
  userId: number | null
  taskKind: string
  mode: string | null
  role: ModelRole
  provider: ProviderName | null
  model: string | null
  chainIndex?: number | null
  inputTokens: number
  outputTokens: number
  costUsd: number
  latencyMs: number | null
  success: boolean
  errorCode: string | null
  errorMessage: string | null
  streamingState?: RunStreamingState | null
  startedAt: Date
  endedAt: Date | null
}

export async function recordRun(input: RecordRunInput): Promise<number | null> {
  try {
    const [row] = await db('ai_runs')
      .insert({
        messageId: input.messageId,
        conversationId: input.conversationId,
        agencyId: input.agencyId,
        leadId: input.leadId,
        userId: input.userId,
        taskKind: input.taskKind,
        mode: input.mode,
        role: input.role,
        provider: input.provider,
        model: input.model,
        chainIndex: input.chainIndex ?? null,
        inputTokens: input.inputTokens ?? 0,
        outputTokens: input.outputTokens ?? 0,
        costUsd: input.costUsd ?? 0,
        latencyMs: input.latencyMs,
        success: input.success,
        errorCode: input.errorCode,
        errorMessage: input.errorMessage ? String(input.errorMessage).slice(0, 1000) : null,
        streamingState: input.streamingState ?? null,
        startedAt: input.startedAt,
        endedAt: input.endedAt,
      })
      .returning('id')
    return row ? Number(row.id) : null
  } catch (err) {
    console.warn('[ai] ai_runs.insert.fail', (err as Error)?.message)
    return null
  }
}
