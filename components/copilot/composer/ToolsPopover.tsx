'use client'

import Icon from '@/lib/Icon'
import type { CopilotActionId, PredefinedCopilotActionId } from '@/lib/copilot/copilotResponse'
import type { CopilotSuggestedAction } from '@/lib/copilot/copilotContext'
import { POP_KEYFRAMES, isKnownActionId } from './constants'

export function ToolsPopover({
  actions,
  loadingId,
  onSelect,
}: {
  actions: CopilotSuggestedAction[]
  loadingId: CopilotActionId | null
  onSelect: (id: PredefinedCopilotActionId) => void
}) {
  return (
    <div
      role='menu'
      className={[
        'absolute bottom-full mb-2 inline-flex flex-col gap-0.5',
        'rounded-lg bg-white border border-gray-200 p-1.5 min-w-[200px]',
        'shadow-[0_8px_24px_-8px_rgba(15,23,42,0.12)]',
        'start-2',
      ].join(' ')}
      style={{ animation: 'cp-pop-in 140ms ease-out' }}
    >
      <style>{POP_KEYFRAMES}</style>
      {actions.map((action) => {
        const isLoading = loadingId === action.id
        return (
          <button
            key={action.id}
            type='button'
            role='menuitem'
            onClick={() => isKnownActionId(action.id) && onSelect(action.id)}
            disabled={loadingId !== null}
            data-action-id={action.id}
            className='group flex items-center gap-2 w-full px-2.5 py-2 rounded-md text-start hover:bg-gray-50 transition-colors duration-150 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-transparent'
          >
            {isLoading ? (
              <span
                className='inline-block size-3 rounded-full border-2 border-gray-200 border-t-gray-500 animate-spin shrink-0'
                aria-hidden='true'
              />
            ) : (
              <Icon
                name='sparkles'
                type='reg'
                className='size-3 bg-gray-400 group-hover:bg-primary transition-colors shrink-0'
              />
            )}
            <span className='text-xs text-gray-700 group-hover:text-gray-900 truncate'>{action.label}</span>
          </button>
        )
      })}
    </div>
  )
}
