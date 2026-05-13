import { getOrCreateLeadConversation } from '@/db/aiConversations'
import { appendMessage } from '@/db/aiMessages'
import { recordRun } from '@/db/aiRuns'
import { isCopilotPersistenceEnabled } from '@/lib/ai/flags'
import type { AiFailure, AiFailureReason, AiRunResult, ModelRole, TaskKind } from '@/lib/ai/types'
import type { CopilotModeId } from '@/lib/ai/copilotModes'

function isAiFailure<T>(r: AiRunResult<T>): r is AiFailure {
  return r.ok === false
}

export type PersistAssistantTurnInput<TData> = {
  agencyId: number
  leadId: number
  userId: number
  taskKind: TaskKind
  role: ModelRole
  mode: CopilotModeId | null
  actionId: string | null
  userText: string

  markerRole?: 'user' | 'system'
  attachments?: unknown[]
  lenses?: unknown[]
  structuredPayload?: unknown
  assistantSynopsis?: string
  result: AiRunResult<TData>
  startedAt: Date
}

export async function persistAssistantTurn<TData>(input: PersistAssistantTurnInput<TData>): Promise<void> {
  if (!isCopilotPersistenceEnabled()) return
  try {
    const conversationId = await getOrCreateLeadConversation(input.agencyId, input.leadId, input.userId)

    await appendMessage({
      conversationId,
      agencyId: input.agencyId,
      role: input.markerRole ?? 'user',
      mode: input.mode,
      actionId: input.actionId,
      text: input.userText,
      attachments: input.attachments ?? [],
      lenses: input.lenses ?? [],
      status: 'complete',
    })

    const result = input.result
    let failureReason: AiFailureReason | null = null
    let failureMessage: string | null = null
    let failureLatencyMs: number | null = null
    if (isAiFailure(result)) {
      failureReason = result.reason
      failureMessage = result.message ?? null
      failureLatencyMs = result.latencyMs ?? null
    }

    const assistantMessageId = await appendMessage({
      conversationId,
      agencyId: input.agencyId,
      role: 'assistant',
      mode: input.mode,
      actionId: input.actionId,
      taskKind: input.taskKind,
      status: result.ok ? 'complete' : 'failed',
      text: result.ok ? (input.assistantSynopsis ?? '') : '',
      structuredPayload: result.ok ? input.structuredPayload : undefined,
      errorReason: failureReason,
    })

    const endedAt = new Date()
    await recordRun({
      messageId: assistantMessageId,
      conversationId,
      agencyId: input.agencyId,
      leadId: input.leadId,
      userId: input.userId,
      taskKind: input.taskKind,
      mode: input.mode,
      role: input.role,
      provider: result.ok ? result.provider : null,
      model: result.ok ? result.model : null,
      inputTokens: result.ok ? result.inputTokens : 0,
      outputTokens: result.ok ? result.outputTokens : 0,
      costUsd: result.ok ? result.costUsd : 0,
      latencyMs: result.ok ? result.latencyMs : failureLatencyMs,
      success: result.ok,
      errorCode: failureReason,
      errorMessage: failureMessage,
      startedAt: input.startedAt,
      endedAt,
    })
  } catch (err) {
    console.warn('[ai] persist.assistant_turn.fail', (err as Error)?.message)
  }
}
