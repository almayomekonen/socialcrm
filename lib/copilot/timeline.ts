import type { CopilotActionId, CopilotResponseErrorReason, CopilotResponsePayload } from './copilotResponse'
import type { CopilotModeId } from '@/lib/ai/copilotModes'
import type { AiMessageRow } from '@/db/aiMessages'

/**
 * Phase 2 timeline domain model.
 *
 * A TimelineEntry is what the panel renders. It is NOT the raw DB row. The DB
 * row is a fact about persistence (role, status, structuredPayload, ...). The
 * timeline entry is a fact about rendering (which card variant, which marker
 * text, which retry handler).
 *
 * The mapper `mapMessageRowToTimelineEntry` is the single point that translates
 * between the two. All UI-side code consumes TimelineEntry; no UI-side code
 * inspects `AiMessageRow` directly. This keeps the doctrine intact: the row
 * has columns that should never reach the UI surface (e.g. provider/model live
 * on ai_runs, not here — but the same discipline applies to internal fields).
 */

/** Entry sources:
 *  - `persisted`  — read back from ai_messages
 *  - `optimistic` — synthetic in-flight entry while a server action is mid-call
 */
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

/**
 * Operational AI event marker. Two cases collapse here:
 *  1. Rows persisted with role='system' (Phase 2 forward writes).
 *  2. Legacy rows persisted with role='user' AND an `actionId` of a predefined
 *     action (Phase 1 writes, before the system-role correction). The legacy
 *     fallback is applied at map-time; no DB migration required.
 */
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
  if (raw === 'draft-followup-message' || raw === 'next-best-step' || raw === 'ask-question') return raw
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

/**
 * Map a persisted ai_messages row into a TimelineEntry. Returns null for rows
 * the timeline should ignore (e.g. an assistant row stuck in `pending` —
 * possible only if a future streaming path leaves orphans; Phase 2 should not
 * encounter these in practice).
 */
export function mapMessageRowToTimelineEntry(row: AiMessageRow): TimelineEntry | null {
  const base: Base = {
    id: row.id,
    sequence: row.sequence,
    createdAt: row.createdAt,
    source: 'persisted',
  }

  // Legacy fallback: predefined-action markers persisted as role='user' under
  // Phase 1. New writes use role='system'; either way they render as a system
  // marker. Freeform-ask user rows (actionId='ask-question') stay user.
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
    // pending / streaming / corrupted payload — drop. The renderer makes no
    // assumptions about these in Phase 2.
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
  if (actionId === 'draft-followup-message' || actionId === 'next-best-step' || actionId === 'ask-question') {
    // Trust the persisted shape. Zod-validated on the way in.
    return { actionId, data } as CopilotResponsePayload
  }
  return null
}

/* ───────────────────────── Optimistic helpers ───────────────────────── */

let optimisticCounter = 0

export function nextOptimisticId(prefix: string): string {
  optimisticCounter += 1
  return `opt-${prefix}-${optimisticCounter}-${Date.now()}`
}

/** A sequence value bigger than any persisted entry — keeps optimistic entries
 *  at the end during sorting without contaminating real sequence allocation. */
export const OPTIMISTIC_SEQUENCE = Number.MAX_SAFE_INTEGER
