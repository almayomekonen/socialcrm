'use client'

import { useCallback, useTransition, type Dispatch, type SetStateAction } from 'react'
import { nextOptimisticId, OPTIMISTIC_SEQUENCE, type AssistantInFlightEntry } from '@/lib/copilot/timeline'
import { HANDLERS, type PredefinedActionId } from './handlers'

/**
 * Encapsulates the predefined-action dispatch path (tools popover entries
 * like draft-followup-message / next-best-step). Symmetric with
 * useDispatchAsk but uses the HANDLERS catalog to pick the server call.
 */
export function useDispatchPredefined({
  leadId,
  setInFlight,
  refetchTimeline,
  dispatchTokenRef,
}: {
  leadId: number | null
  setInFlight: Dispatch<SetStateAction<AssistantInFlightEntry | null>>
  refetchTimeline: (leadId: number, token: number) => Promise<void>
  dispatchTokenRef: { current: number }
}) {
  const [, startTransition] = useTransition()

  return useCallback(
    (actionId: PredefinedActionId) => {
      if (leadId == null) return
      const handler = HANDLERS[actionId]
      const token = ++dispatchTokenRef.current

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
          await handler.fn(leadId)
        } catch {
          // Refetch will reflect persisted state (or absence); in-flight clears regardless.
        }
        if (dispatchTokenRef.current === token) setInFlight(null)
        await refetchTimeline(leadId, token)
      })
    },
    [leadId, setInFlight, refetchTimeline, dispatchTokenRef],
  )
}
