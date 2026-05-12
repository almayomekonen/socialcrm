'use client'

import { useEffect, useRef } from 'react'
import CopilotTimelineEntry from './CopilotTimelineEntry'
import ActiveGenerationRow from './ActiveGenerationRow'
import { EmptyTimelineState } from './primitives/EmptyTimelineState'
import type { CopilotActionId } from '@/lib/copilot/copilotResponse'
import type { AssistantInFlightEntry, TimelineEntry } from '@/lib/copilot/timeline'

type Props = {
  entries: TimelineEntry[]
  inFlight: AssistantInFlightEntry | null
  freshIds: Set<number | string>
  isHydrating: boolean
  noLead: boolean
  onRetry: (actionId: CopilotActionId) => void
}

export default function CopilotTimeline({
  entries,
  inFlight,
  freshIds,
  isHydrating,
  noLead,
  onRetry,
}: Props) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const previousLengthRef = useRef(0)
  const inFlightActive = inFlight != null

  useEffect(() => {
    const node = scrollRef.current
    if (!node) return
    const prev = previousLengthRef.current
    const next = entries.length
    previousLengthRef.current = next

    const distanceFromBottom = node.scrollHeight - node.scrollTop - node.clientHeight
    const isInitialFill = prev === 0 && (next > 0 || inFlightActive)
    const userIsNearBottom = distanceFromBottom < 80
    const shouldStick = isInitialFill || userIsNearBottom

    if (!shouldStick) return
    if (isInitialFill) {
      node.scrollTop = node.scrollHeight
    } else {
      requestAnimationFrame(() => {
        node.scrollTo({ top: node.scrollHeight, behavior: 'smooth' })
      })
    }
  }, [entries, inFlightActive])

  if (noLead) return <EmptyTimelineState mode='no-lead' />
  if (isHydrating && entries.length === 0) return <EmptyTimelineState mode='hydrating' />
  if (entries.length === 0 && !inFlightActive) return <EmptyTimelineState mode='empty' />

  return (
    <div ref={scrollRef} className='h-full overflow-y-auto pt-1 pb-2 scrollbar-slim'>
      <ul className='flex flex-col items-stretch gap-3'>
        {entries.map((entry) => (
          <li key={entryKey(entry)}>
            <CopilotTimelineEntry
              entry={entry}
              staticRender={!freshIds.has(entry.id)}
              onRetry={onRetry}
            />
          </li>
        ))}
        {inFlight && (
          <li key={entryKey(inFlight)}>
            <ActiveGenerationRow fallbackLabel={inFlight.actionLabel} hint={inFlight.loadingHint} />
          </li>
        )}
      </ul>
    </div>
  )
}

function entryKey(entry: TimelineEntry | AssistantInFlightEntry): string {
  return `${entry.source}-${entry.id}`
}
