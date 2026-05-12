'use client'

import CopilotResponseCard from './CopilotResponseCard'
import { UserMessagePill } from './primitives/UserMessagePill'
import { SystemActivityRow } from './primitives/SystemActivityRow'
import { AssistantMeta } from './primitives/AssistantMeta'
import type { CopilotActionId } from '@/lib/copilot/copilotResponse'
import type { TimelineEntry } from '@/lib/copilot/timeline'

type Props = {
  entry: TimelineEntry
  staticRender: boolean
  onRetry?: (actionId: CopilotActionId) => void
}

export default function CopilotTimelineEntry({ entry, staticRender, onRetry }: Props) {
  if (entry.kind === 'user') {
    return <UserMessagePill text={entry.text} />
  }

  if (entry.kind === 'system') {
    return <SystemActivityRow text={entry.text} actionId={entry.actionId} createdAt={entry.createdAt} />
  }

  if (entry.kind === 'assistant-failed') {
    return (
      <div className='flex flex-col gap-0.5'>
        <CopilotResponseCard
          state='error'
          actionId={entry.actionId}
          reason={entry.errorReason}
          onRetry={() => onRetry?.(entry.actionId)}
        />
        <AssistantMeta time={entry.createdAt} />
      </div>
    )
  }

  if (entry.kind === 'assistant-success') {
    return (
      <div className='flex flex-col gap-0.5'>
        <CopilotResponseCard state='success' payload={entry.payload} staticRender={staticRender} />
        <AssistantMeta time={entry.createdAt} />
      </div>
    )
  }

  return null
}
