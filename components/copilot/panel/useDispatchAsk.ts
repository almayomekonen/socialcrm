'use client'

import { useCallback, useRef, useTransition, type Dispatch, type SetStateAction } from 'react'
import {
  asErrorReason,
  createOptimisticFailedEntry,
  nextOptimisticId,
  OPTIMISTIC_SEQUENCE,
  type AssistantFailedEntry,
  type AssistantInFlightEntry,
} from '@/lib/copilot/timeline'
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
 *
 * On throw or ok:false, reports a token-scoped optimistic assistant-failed
 * entry so the user never sees a silent empty timeline (Wave A9).
 */
export function useDispatchAsk({
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
  const lastAskRef = useRef<LastAsk | null>(null)

  const dispatchAsk = useCallback(
    (text: string, lenses: LensId[], attachments: CopilotAttachmentPayload[], mode: CopilotModeId) => {
      if (leadId == null) return
      lastAskRef.current = { text, lenses, attachments, mode }
      const token = ++dispatchTokenRef.current
      onDispatchStart()

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
          const res = await askLeadQuestion(leadId, text, lenses, attachments, mode)
          if (res && res.ok === false) {
            const reason = asErrorReason(res.reason)
            console.warn('[copilot.dispatch]', { actionId: 'ask-question', reason })
            reportFailure(createOptimisticFailedEntry('ask-question', reason, mode), token)
          }
        } catch (err) {
          console.warn('[copilot.dispatch]', {
            actionId: 'ask-question',
            err: err instanceof Error ? err.name : 'unknown',
          })
          reportFailure(createOptimisticFailedEntry('ask-question', 'unknown', mode), token)
        }
        if (dispatchTokenRef.current === token) setInFlight(null)
        await refetchTimeline(leadId, token)
      })
    },
    [leadId, setInFlight, refetchTimeline, dispatchTokenRef, onDispatchStart, reportFailure],
  )

  return { dispatchAsk, lastAskRef }
}
