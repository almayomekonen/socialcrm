'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Icon from '@/lib/Icon'
import { useCopilot } from '@/lib/copilot/useCopilot'
import { useCopilotContext } from '@/lib/copilot/copilotContextStore'
import type { CopilotActionId } from '@/lib/copilot/copilotResponse'
import {
  shouldKeepEphemeralFailed,
  type AssistantFailedEntry,
  type AssistantInFlightEntry,
  type TimelineEntry,
} from '@/lib/copilot/timeline'
import CopilotTimeline from './CopilotTimeline'
import CopilotComposer from './CopilotComposer'
import { getCopilotTimeline } from '@/actions/ai/getCopilotTimeline'
import { useDispatchAsk } from './panel/useDispatchAsk'
import { useDispatchPredefined } from './panel/useDispatchPredefined'

/**
 * Phase 3 UI — timeline-backed Copilot panel with proper history/active
 * separation.
 *
 * Two state surfaces for history/active, plus a third for unpersisted failures:
 *   entries          — persisted history fetched from the DB. Renders STATIC.
 *   inFlight         — at-most-one optimistic generation row. Renders ANIMATED.
 *   ephemeralFailed  — token-scoped assistant-failed when dispatch throws / ok:false
 *                      before a hydrated failed row exists (Wave A9).
 *
 * Freshness gate: when a dispatch completes and a refetch lands new entries,
 * their ids are added to `freshIds` for ~2.5s so their CopilotResponseCard
 * renders with reveal/typing animation once. After the window, they fall
 * back to static rendering — refresh / lead-switch / scroll never replays them.
 */

const FRESH_WINDOW_MS = 2500

export default function CopilotPanel() {
  const { closePanel } = useCopilot()
  const ctx = useCopilotContext()
  const currentLeadId = ctx?.kind === 'lead' ? ctx.leadId : null

  const [entries, setEntries] = useState<TimelineEntry[]>([])
  const [inFlight, setInFlight] = useState<AssistantInFlightEntry | null>(null)
  const [ephemeralFailed, setEphemeralFailed] = useState<AssistantFailedEntry | null>(null)
  const [freshIds, setFreshIds] = useState<Set<number | string>>(new Set())
  const [isHydrating, setIsHydrating] = useState(false)

  const dispatchTokenRef = useRef(0)
  const freshClearTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Ref mirror of `entries` so the refetch diff can read previous-state without
  // an updater callback (avoids calling a setter from inside another setter).
  const entriesRef = useRef<TimelineEntry[]>([])

  const onDispatchStart = useCallback(() => {
    setEphemeralFailed(null)
  }, [])

  const reportFailure = useCallback((entry: AssistantFailedEntry, token: number) => {
    if (dispatchTokenRef.current !== token) return
    setEphemeralFailed(entry)
  }, [])

  const applyEntriesFromHydration = useCallback((next: TimelineEntry[]) => {
    if (freshClearTimerRef.current) clearTimeout(freshClearTimerRef.current)
    setFreshIds(new Set())
    setEphemeralFailed(null)
    entriesRef.current = next
    setEntries(next)
  }, [])

  const applyEntriesFromRefetch = useCallback((next: TimelineEntry[]) => {
    const prev = entriesRef.current
    const prevIds = new Set<number | string>(prev.map((e) => e.id))
    const newIds = next.map((e) => e.id).filter((id) => !prevIds.has(id))
    entriesRef.current = next
    setEntries(next)
    setEphemeralFailed((ephemeral) =>
      shouldKeepEphemeralFailed(prev, next, ephemeral) ? ephemeral : null,
    )
    if (newIds.length > 0) {
      setFreshIds(new Set(newIds))
      if (freshClearTimerRef.current) clearTimeout(freshClearTimerRef.current)
      freshClearTimerRef.current = setTimeout(() => setFreshIds(new Set()), FRESH_WINDOW_MS)
    }
  }, [])

  useEffect(() => {
    const token = ++dispatchTokenRef.current
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
        // Network/DB hiccup. Keep last-known entries + any ephemeral failure card.
      }
    },
    [applyEntriesFromRefetch],
  )

  const dispatchPredefined = useDispatchPredefined({
    leadId: currentLeadId,
    setInFlight,
    refetchTimeline,
    dispatchTokenRef,
    onDispatchStart,
    reportFailure,
  })

  const { dispatchAsk, lastAskRef } = useDispatchAsk({
    leadId: currentLeadId,
    setInFlight,
    refetchTimeline,
    dispatchTokenRef,
    onDispatchStart,
    reportFailure,
  })

  const dispatchRetry = useCallback(
    (actionId: CopilotActionId) => {
      // 'drive-results' rides the same submit path as 'ask-question' — the
      // server (askLeadQuestion) decides which payload variant to build.
      if (actionId === 'ask-question' || actionId === 'drive-results' || actionId === 'conversational') {
        const last = lastAskRef.current
        if (last) dispatchAsk(last.text, last.lenses, last.attachments, last.mode)
        return
      }
      dispatchPredefined(actionId)
    },
    [dispatchAsk, dispatchPredefined, lastAskRef],
  )

  const loadingActionId = inFlight ? inFlight.actionId : null
  const suggestedActions = ctx?.kind === 'lead' ? ctx.suggestedActions : []
  const composerPlaceholder = ctx?.kind === 'lead' ? `שאל משהו על ${ctx.leadName}` : 'שאל את העוזר…'
  const timelineEntries = ephemeralFailed ? [...entries, ephemeralFailed] : entries

  return (
    <div className='h-full flex flex-col items-stretch'>
      <TopAnchor onClose={closePanel} />

      <div className='flex-1 overflow-hidden px-3'>
        <CopilotTimeline
          entries={timelineEntries}
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
        <span className='text-xs font-medium text-gray-700'>עוזר חכם</span>
      </div>
      <button
        type='button'
        onClick={onClose}
        aria-label='סגור עוזר חכם'
        className='group p-1 rounded-full hover:bg-gray-100 transition-colors duration-150'
      >
        <Icon name='xmark' type='reg' className='size-4 bg-gray-950 group-hover:bg-gray-700 transition-colors' />
      </button>
    </div>
  )
}
