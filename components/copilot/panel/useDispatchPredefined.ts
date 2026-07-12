'use client'

import { useCallback, useTransition, type Dispatch, type SetStateAction } from 'react'
import {
  asErrorReason,
  createOptimisticFailedEntry,
  nextOptimisticId,
  OPTIMISTIC_SEQUENCE,
  type AssistantFailedEntry,
  type AssistantInFlightEntry,
} from '@/lib/copilot/timeline'
import { HANDLERS, type PredefinedActionId } from './handlers'

/**
 * Encapsulates the predefined-action dispatch path (tools popover entries
 * like draft-followup-message / next-best-step). Symmetric with
 * useDispatchAsk but uses the HANDLERS catalog to pick the server call.
 *
 * On throw or ok:false, reports a token-scoped optimistic assistant-failed
 * entry so the user never sees a silent empty timeline (Wave A9).
 */
export function useDispatchPredefined({
  leadId,
  setInFlight,
  refetchTimeline,
  dispatchTokenRef,
  onDispatchStart,
  reportFailure,
}: {
  leadId: number | null
  setInFlight: Dispatch<SetStateAction<AssistantInFlightEntry | null>>
  refetchTimeline: (leadId: number, token: number) => Promise<void>
  dispatchTokenRef: { current: number }
  onDispatchStart: () => void
  reportFailure: (entry: AssistantFailedEntry, token: number) => void
}) {
  const [, startTransition] = useTransition()

  return useCallback(
    (actionId: PredefinedActionId) => {
      if (leadId == null) return
      const handler = HANDLERS[actionId]
      const token = ++dispatchTokenRef.current
      onDispatchStart()

      setInFlight({
        kind: 'assistant-loading',
        id: nextOptimisticId(actionId),
        sequence: OPTIMISTIC_SEQUENCE,
        createdAt: new Date().toISOString(),
        source: 'optimistic',
        actionId,
        actionLabel: handler.loadingLabel,
        loadingHint: 'general',
      })

      startTransition(async () => {
        try {
          const res = await handler.fn(leadId)
          if (res && res.ok === false) {
            const reason = asErrorReason(res.reason)
            console.warn('[copilot.dispatch]', { actionId, reason })
            reportFailure(createOptimisticFailedEntry(actionId, reason), token)
          }
        } catch (err) {
          console.warn('[copilot.dispatch]', {
            actionId,
            err: err instanceof Error ? err.name : 'unknown',
          })
          reportFailure(createOptimisticFailedEntry(actionId, 'unknown'), token)
        }
        if (dispatchTokenRef.current === token) setInFlight(null)
        await refetchTimeline(leadId, token)
      })
    },
    [leadId, setInFlight, refetchTimeline, dispatchTokenRef, onDispatchStart, reportFailure],
  )
}
