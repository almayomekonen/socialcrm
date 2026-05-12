import { getOrCreateLeadConversation } from '@/db/aiConversations'
import { appendMessage } from '@/db/aiMessages'
import { recordRun } from '@/db/aiRuns'
import { isCopilotPersistenceEnabled } from '@/lib/ai/flags'
import type { AiRunResult, ModelRole, TaskKind } from '@/lib/ai/types'

/**
 * Phase 1 persistence wrapper. Called by Copilot action sites AFTER the
 * underlying `runStructured` call resolves. Writes:
 *
 *   user message  →  appendMessage(role='user', actionId/userText/attachments)
 *   assistant msg →  appendMessage(role='assistant', structuredPayload, status)
 *   run row       →  recordRun(provider, model, tokens, cost, latency, success)
 *
 * Doctrine:
 *   - Fire-and-forget. ANY failure inside this function must be swallowed so
 *     the caller's user-visible result is unaffected. This is an audit layer,
 *     not a critical path.
 *   - No provider/model fields ever flow into ai_messages — they only go into
 *     ai_runs.
 *   - Gated by `AI_COPILOT_PERSIST`. When the flag is off, this function does
 *     nothing (no DB writes, no thread creation).
 *
 * Caller sites today:
 *   - actions/ai/_defineCachedLeadAction.ts (predefined actions)
 *   - actions/ai/leadAskQuestion.ts        (freeform ask)
 *
 * Cache-miss only: for cached actions, this only fires when the AI actually
 * ran. Cache hits within the TTL skip persistence — the timeline already
 * recorded that generation.
 */

export type PersistAssistantTurnInput<TData> = {
  agencyId: number
  leadId: number
  userId: number
  taskKind: TaskKind
  /** Resolved provider-chain role (`primary`/`volume`/`heavy`/`fallback`). */
  role: ModelRole
  /** User-facing operational mode (`fast`/`smart`/`advanced`) — null for predefined actions. */
  mode: string | null
  /** Predefined action id (e.g. 'draft-followup-message'). Null for freeform ask. */
  actionId: string | null
  /**
   * Text recorded on the marker row. For freeform ask this is the rep's typed
   * question; for predefined actions it's a short marker (e.g. "הודעת followup")
   * that reads correctly when the timeline UI lands.
   */
  userText: string
  /**
   * Role for the marker row that precedes the assistant turn. Defaults to
   * `'user'` (correct for freeform asks where the rep typed the prompt).
   * Predefined Copilot actions ("draft followup", "next step") were dogfooded
   * with role='user' but they aren't actual user utterances — they're
   * operational AI events triggered by a click. Phase 2 forward writes these
   * as `'system'`. Existing role='user' rows are remapped at read time by
   * `mapMessageRowToTimelineEntry`, so no DB migration is required.
   */
  markerRole?: 'user' | 'system'
  /** Attachments snapshot from the request (file IDs + metadata). */
  attachments?: unknown[]
  /** Lens IDs selected by the rep (freeform ask only). */
  lenses?: unknown[]
  /**
   * Structured Zod-validated payload from the AI. Stored verbatim on the
   * assistant message so the renderer can reproduce the card.
   */
  structuredPayload?: unknown
  /** Optional one-line synopsis derived from the structured payload. */
  assistantSynopsis?: string
  /** The unmodified router result — drives run-row contents + assistant status. */
  result: AiRunResult<TData>
  /** Captured by the caller right before invoking `runStructured`. */
  startedAt: Date
}

export async function persistAssistantTurn<TData>(
  input: PersistAssistantTurnInput<TData>,
): Promise<void> {
  if (!isCopilotPersistenceEnabled()) return
  try {
    const conversationId = await getOrCreateLeadConversation(
      input.agencyId,
      input.leadId,
      input.userId,
    )

    // 1) Marker row. role='user' for freeform asks; role='system' for
    //    predefined-action triggers (clicks, not utterances).
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

    // 2) Assistant row. On failure we still persist the turn so the timeline
    //    audit captures the attempt — status='failed' with errorReason set.
    const assistantStatus = input.result.ok ? 'complete' : 'failed'
    const errorReason = input.result.ok ? null : input.result.reason
    const assistantMessageId = await appendMessage({
      conversationId,
      agencyId: input.agencyId,
      role: 'assistant',
      mode: input.mode,
      actionId: input.actionId,
      taskKind: input.taskKind,
      status: assistantStatus,
      text: input.result.ok ? (input.assistantSynopsis ?? '') : '',
      structuredPayload: input.result.ok ? input.structuredPayload : undefined,
      errorReason,
    })

    // 3) Run row — the only place provider/model are recorded.
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
      provider: input.result.ok ? input.result.provider : null,
      model: input.result.ok ? input.result.model : null,
      inputTokens: input.result.ok ? input.result.inputTokens : 0,
      outputTokens: input.result.ok ? input.result.outputTokens : 0,
      costUsd: input.result.ok ? input.result.costUsd : 0,
      latencyMs: input.result.ok ? input.result.latencyMs : (input.result.latencyMs ?? null),
      success: input.result.ok,
      errorCode: input.result.ok ? null : input.result.reason,
      errorMessage: input.result.ok ? null : (input.result.message ?? null),
      startedAt: input.startedAt,
      endedAt,
    })
  } catch (err) {
    // Audit layer must never break the user-visible flow.
    console.warn('[ai] persist.assistant_turn.fail', (err as Error)?.message)
  }
}
