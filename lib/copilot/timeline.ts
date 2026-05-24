import type { CopilotActionId, CopilotResponseErrorReason, CopilotResponsePayload } from './copilotResponse'
import type { CopilotModeId } from '@/lib/ai/copilotModes'
import type { AiMessageRow } from '@/db/aiMessages'

export type TimelineEntrySource = 'persisted' | 'optimistic'

type Base = {
  id: number | string
  sequence: number
  createdAt: string
  source: TimelineEntrySource
}

export type UserTimelineEntry = Base & {
  kind: 'user'
  text: string
}

export type SystemTimelineEntry = Base & {
  kind: 'system'
  text: string
  actionId: CopilotActionId | null
  mode: CopilotModeId | null
}

export type AssistantSuccessEntry = Base & {
  kind: 'assistant-success'
  payload: CopilotResponsePayload
  actionId: CopilotActionId
  mode: CopilotModeId | null
}

export type AssistantFailedEntry = Base & {
  kind: 'assistant-failed'
  actionId: CopilotActionId
  errorReason: CopilotResponseErrorReason
  mode: CopilotModeId | null
}

export type AssistantInFlightEntry = Base & {
  kind: 'assistant-loading'
  actionId: CopilotActionId
  actionLabel: string
  loadingHint: 'attachments' | 'general'
}

export type TimelineEntry =
  | UserTimelineEntry
  | SystemTimelineEntry
  | AssistantSuccessEntry
  | AssistantFailedEntry
  | AssistantInFlightEntry

/* ───────────────────────── Mapping ───────────────────────── */

const PREDEFINED_ACTION_IDS = new Set<string>(['draft-followup-message', 'next-best-step'])

function asCopilotActionId(raw: string | null): CopilotActionId | null {
  if (
    raw === 'draft-followup-message' ||
    raw === 'next-best-step' ||
    raw === 'ask-question' ||
    raw === 'drive-results' ||
    raw === 'conversational'
  ) {
    return raw
  }
  return null
}

function asCopilotModeId(raw: string | null): CopilotModeId | null {
  if (raw === 'fast' || raw === 'smart' || raw === 'advanced') return raw
  return null
}

function asErrorReason(raw: string | null): CopilotResponseErrorReason {
  if (
    raw === 'disabled' ||
    raw === 'forbidden' ||
    raw === 'no-providers' ||
    raw === 'over-quota' ||
    raw === 'all-providers-failed' ||
    raw === 'invalid-input'
  ) {
    return raw
  }
  return 'unknown'
}

export function mapMessageRowToTimelineEntry(row: AiMessageRow): TimelineEntry | null {
  const base: Base = {
    id: row.id,
    sequence: row.sequence,
    createdAt: row.createdAt,
    source: 'persisted',
  }

  const isLegacyPredefinedMarker =
    row.role === 'user' && row.actionId !== null && PREDEFINED_ACTION_IDS.has(row.actionId)

  if (row.role === 'system' || isLegacyPredefinedMarker) {
    return {
      ...base,
      kind: 'system',
      text: row.text,
      actionId: asCopilotActionId(row.actionId),
      mode: asCopilotModeId(row.mode),
    }
  }

  if (row.role === 'user') {
    return { ...base, kind: 'user', text: row.text }
  }

  if (row.role === 'assistant') {
    if (row.status === 'failed' || row.status === 'aborted') {
      return {
        ...base,
        kind: 'assistant-failed',
        actionId: asCopilotActionId(row.actionId) ?? 'ask-question',
        errorReason: asErrorReason(row.errorReason),
        mode: asCopilotModeId(row.mode),
      }
    }
    if (row.status === 'complete') {
      const payload = extractAssistantPayload(row.structuredPayload, row.actionId)
      if (payload) {
        return {
          ...base,
          kind: 'assistant-success',
          payload,
          actionId: payload.actionId,
          mode: asCopilotModeId(row.mode),
        }
      }
    }
    return null
  }

  return null
}

function extractAssistantPayload(
  raw: AiMessageRow['structuredPayload'],
  actionIdFallback: string | null,
): CopilotResponsePayload | null {
  if (!raw || typeof raw !== 'object') return null
  const candidate = raw as { actionId?: unknown; data?: unknown }
  const actionId = typeof candidate.actionId === 'string' ? candidate.actionId : actionIdFallback
  const data = candidate.data
  if (!actionId || data == null) return null
  if (
    actionId === 'draft-followup-message' ||
    actionId === 'next-best-step' ||
    actionId === 'ask-question' ||
    actionId === 'drive-results' ||
    actionId === 'conversational'
  ) {
    return { actionId, data } as CopilotResponsePayload
  }
  return null
}


let optimisticCounter = 0

export function nextOptimisticId(prefix: string): string {
  optimisticCounter += 1
  return `opt-${prefix}-${optimisticCounter}-${Date.now()}`
}

export const OPTIMISTIC_SEQUENCE = Number.MAX_SAFE_INTEGER
