'use client'

import { useCallback, useEffect, useRef, useState, useTransition } from 'react'
import Icon from '@/lib/Icon'
import { useCopilot } from '@/lib/copilot/useCopilot'
import { useCopilotContext } from '@/lib/copilot/copilotContextStore'
import type { CopilotActionId, CopilotResponsePayload } from '@/lib/copilot/copilotResponse'
import {
  nextOptimisticId,
  OPTIMISTIC_SEQUENCE,
  type AssistantInFlightEntry,
  type TimelineEntry,
} from '@/lib/copilot/timeline'
import CopilotTimeline from './CopilotTimeline'
import CopilotComposer from './CopilotComposer'
import { generateLeadFollowupMessage } from '@/actions/ai/leadFollowup'
import { generateLeadNextBestStep } from '@/actions/ai/leadNextStep'
import { askLeadQuestion } from '@/actions/ai/leadAskQuestion'
import { getCopilotTimeline } from '@/actions/ai/getCopilotTimeline'
import type { LensId } from '@/lib/ai/prompts/leadAskQuestion'
import type { CopilotAttachmentPayload } from '@/lib/copilot/attachments'
import { PREDEFINED_ACTIONS } from '@/lib/copilot/leadActions'
import type { CopilotModeId } from '@/lib/ai/copilotModes'

/**
 * Phase 3 UI — timeline-backed Copilot panel with proper history/active
 * separation.
 *
 * Two state surfaces, never mixed:
 *
 *   entries    — persisted history fetched from the DB. Renders STATIC.
 *   inFlight   — at-most-one optimistic generation row. Renders ANIMATED.
 *
 * Freshness gate: when a dispatch completes and a refetch lands new entries,
 * their ids are added to `freshIds` for ~2.5s so their CopilotResponseCard
 * renders with reveal/typing animation once. After the window, they fall back
 * to static rendering — refresh / lead-switch / scroll never replays them.
 */

type PredefinedActionId = Exclude<CopilotActionId, 'ask-question'>

type ActionHandler = {
  id: PredefinedActionId
  label: string
  loadingLabel: string
  fn: (leadId: number) => Promise<{ ok: true; data: any } | { ok: false; reason: string; message?: string }>
  toPayload: (data: any) => CopilotResponsePayload
}

const HANDLERS: Record<PredefinedActionId, ActionHandler> = {
  'draft-followup-message': {
    ...PREDEFINED_ACTIONS['draft-followup-message'],
    loadingLabel: 'מנסח הודעה…',
    fn: (leadId) => generateLeadFollowupMessage(leadId),
    toPayload: (data) => ({ actionId: 'draft-followup-message', data }),
  },
  'next-best-step': {
    ...PREDEFINED_ACTIONS['next-best-step'],
    loadingLabel: 'בוחן את הצעד הבא…',
    fn: (leadId) => generateLeadNextBestStep(leadId),
    toPayload: (data) => ({ actionId: 'next-best-step', data }),
  },
}

const ASK_LOADING_LABEL = 'מעבד את השאלה…'
const FRESH_WINDOW_MS = 2500

type LastAsk = {
  text: string
  lenses: LensId[]
  attachments: CopilotAttachmentPayload[]
  mode: CopilotModeId
}

export default function CopilotPanel() {
  const { closePanel } = useCopilot()
  const ctx = useCopilotContext()
  const currentLeadId = ctx?.kind === 'lead' ? ctx.leadId : null

  const [entries, setEntries] = useState<TimelineEntry[]>([])
  const [inFlight, setInFlight] = useState<AssistantInFlightEntry | null>(null)
  const [freshIds, setFreshIds] = useState<Set<number | string>>(new Set())
  const [isHydrating, setIsHydrating] = useState(false)
  const [, startTransition] = useTransition()

  const dispatchTokenRef = useRef(0)
  const lastAskRef = useRef<LastAsk | null>(null)
  const freshClearTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Ref mirror of `entries` so the refetch diff can read previous-state without
  // an updater callback (avoids calling a setter from inside another setter).
  const entriesRef = useRef<TimelineEntry[]>([])

  // Hydration paths: lead change OR initial mount. Hydration NEVER marks
  // entries as fresh — historical content is settled by definition.
  const applyEntriesFromHydration = useCallback((next: TimelineEntry[]) => {
    if (freshClearTimerRef.current) clearTimeout(freshClearTimerRef.current)
    setFreshIds(new Set())
    entriesRef.current = next
    setEntries(next)
  }, [])

  // Refetch-after-dispatch: diff against previous to identify just-arrived
  // entries. Those animate exactly once, then settle.
  const applyEntriesFromRefetch = useCallback((next: TimelineEntry[]) => {
    const prevIds = new Set<number | string>(entriesRef.current.map((e) => e.id))
    const newIds = next.map((e) => e.id).filter((id) => !prevIds.has(id))
    entriesRef.current = next
    setEntries(next)
    if (newIds.length > 0) {
      setFreshIds(new Set(newIds))
      if (freshClearTimerRef.current) clearTimeout(freshClearTimerRef.current)
      freshClearTimerRef.current = setTimeout(() => setFreshIds(new Set()), FRESH_WINDOW_MS)
    }
  }, [])

  useEffect(() => {
    const token = ++dispatchTokenRef.current
    lastAskRef.current = null
    setInFlight(null)

    if (!currentLeadId) {
      applyEntriesFromHydration([])
      setIsHydrating(false)
      return
    }

    setIsHydrating(true)
    getCopilotTimeline(currentLeadId)
      .then((res) => {
        if (dispatchTokenRef.current !== token) return
        applyEntriesFromHydration(res.ok ? res.entries : [])
        setIsHydrating(false)
      })
      .catch(() => {
        if (dispatchTokenRef.current !== token) return
        applyEntriesFromHydration([])
        setIsHydrating(false)
      })
  }, [currentLeadId, applyEntriesFromHydration])

  useEffect(() => {
    return () => {
      if (freshClearTimerRef.current) clearTimeout(freshClearTimerRef.current)
    }
  }, [])

  const refetchTimeline = useCallback(
    async (leadId: number, token: number) => {
      try {
        const res = await getCopilotTimeline(leadId)
        if (dispatchTokenRef.current !== token) return
        if (res.ok) applyEntriesFromRefetch(res.entries)
      } catch {
        // Network/DB hiccup. Keep last-known entries; the in-flight is cleared
        // by the dispatcher regardless.
      }
    },
    [applyEntriesFromRefetch],
  )

  const dispatchPredefined = useCallback(
    (actionId: PredefinedActionId) => {
      if (!ctx || ctx.kind !== 'lead') return
      const handler = HANDLERS[actionId]
      const leadId = ctx.leadId
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
          // Refetch will reflect whatever persisted (or didn't); the in-flight
          // clears regardless.
        }
        if (dispatchTokenRef.current === token) setInFlight(null)
        await refetchTimeline(leadId, token)
      })
    },
    [ctx, refetchTimeline],
  )

  const dispatchAsk = useCallback(
    (text: string, lenses: LensId[], attachments: CopilotAttachmentPayload[], mode: CopilotModeId) => {
      if (!ctx || ctx.kind !== 'lead') return
      lastAskRef.current = { text, lenses, attachments, mode }
      const leadId = ctx.leadId
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
          // See dispatchPredefined.
        }
        if (dispatchTokenRef.current === token) setInFlight(null)
        await refetchTimeline(leadId, token)
      })
    },
    [ctx, refetchTimeline],
  )

  const dispatchRetry = useCallback(
    (actionId: CopilotActionId) => {
      if (actionId === 'ask-question') {
        const last = lastAskRef.current
        if (last) dispatchAsk(last.text, last.lenses, last.attachments, last.mode)
        return
      }
      dispatchPredefined(actionId)
    },
    [dispatchAsk, dispatchPredefined],
  )

  const loadingActionId = inFlight ? inFlight.actionId : null
  const suggestedActions = ctx?.kind === 'lead' ? ctx.suggestedActions : []
  const composerPlaceholder = ctx?.kind === 'lead' ? `שאל משהו על ${ctx.leadName}` : 'שאל את העוזר…'

  return (
    <div className='h-full flex flex-col items-stretch'>
      <TopAnchor onClose={closePanel} />

      <div className='flex-1 overflow-hidden px-3'>
        <CopilotTimeline
          entries={entries}
          inFlight={inFlight}
          freshIds={freshIds}
          isHydrating={isHydrating}
          noLead={currentLeadId == null}
          onRetry={dispatchRetry}
        />
      </div>

      <div className='w-full px-3 pb-3 pt-3'>
        <CopilotComposer
          actions={suggestedActions}
          onAction={dispatchPredefined}
          onSubmit={dispatchAsk}
          loadingId={loadingActionId}
          placeholder={composerPlaceholder}
          leadId={currentLeadId}
          disabled={ctx?.kind !== 'lead'}
        />
      </div>
    </div>
  )
}

function TopAnchor({ onClose }: { onClose: () => void }) {
  return (
    <div className='shrink-0 w-full h-8 flex items-center justify-between px-2'>
      <div className='flex items-center gap-1.5'>
        <Icon name='sparkles' type='reg' className='size-3.5 bg-gray-400' />
        <span className='text-[12.5px] font-medium text-gray-700'>עוזר חכם</span>
      </div>
      <button
        type='button'
        onClick={onClose}
        aria-label='סגור עוזר חכם'
        className='group p-1 rounded-full hover:bg-gray-100 transition-colors duration-150'
      >
        <Icon
          name='xmark'
          type='reg'
          className='size-4 bg-gray-950 group-hover:bg-gray-700 transition-colors'
        />
      </button>
    </div>
  )
}
