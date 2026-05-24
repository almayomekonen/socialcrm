'use client'

import { useCallback, useRef, useTransition, type Dispatch, type SetStateAction } from 'react'
import { nextOptimisticId, OPTIMISTIC_SEQUENCE, type AssistantInFlightEntry } from '@/lib/copilot/timeline'
import { askLeadQuestion } from '@/actions/ai/leadAskQuestion'
import type { LensId } from '@/lib/ai/prompts/leadAskQuestion'
import type { CopilotAttachmentPayload } from '@/lib/copilot/attachments'
import type { CopilotModeId } from '@/lib/ai/copilotModes'

const ASK_LOADING_LABEL = 'מעבד את השאלה…'

export type LastAsk = {
  text: string
  lenses: LensId[]
  attachments: CopilotAttachmentPayload[]
  mode: CopilotModeId
}

/**
 * Encapsulates the freeform-ask dispatch path: optimistic in-flight,
 * server call, refetch. `lastAskRef` is exposed so the retry handler can
 * replay the last request.
 */
export function useDispatchAsk({
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
  const lastAskRef = useRef<LastAsk | null>(null)

  const dispatchAsk = useCallback(
    (text: string, lenses: LensId[], attachments: CopilotAttachmentPayload[], mode: CopilotModeId) => {
      if (leadId == null) return
      lastAskRef.current = { text, lenses, attachments, mode }
      const token = ++dispatchTokenRef.current

      setInFlight({
        kind: 'assistant-loading',
        id: nextOptimisticId('ask'),
        sequence: OPTIMISTIC_SEQUENCE,
        createdAt: new Date().toISOString(),
        source: 'optimistic',
        actionId: 'ask-question',
        actionLabel: ASK_LOADING_LABEL,
        loadingHint: attachments.length > 0 ? 'attachments' : 'general',
      })

      startTransition(async () => {
        try {
          await askLeadQuestion(leadId, text, lenses, attachments, mode)
        } catch {
          // Refetch will reflect whatever persisted (or didn't); in-flight clears regardless.
        }
        if (dispatchTokenRef.current === token) setInFlight(null)
        await refetchTimeline(leadId, token)
      })
    },
    [leadId, setInFlight, refetchTimeline, dispatchTokenRef],
  )

  return { dispatchAsk, lastAskRef }
}
