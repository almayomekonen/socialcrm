'use client'

import type { CopilotResponseErrorReason } from '@/lib/copilot/copilotResponse'
import { ERROR_COPY } from './labels'

export function ErrorBody({ reason, onRetry }: { reason: CopilotResponseErrorReason; onRetry: () => void }) {
  const canRetry = reason === 'all-providers-failed' || reason === 'invalid-input' || reason === 'unknown'
  return (
    <div className='text-center pt-8' role='status' aria-live='polite'>
      <p className='text-xs text-gray-500 mb-2'>{ERROR_COPY[reason]}</p>
      {canRetry && (
        <button
          type='button'
          onClick={onRetry}
          className='text-xs text-gray-500 hover:text-gray-800 underline underline-offset-2'
        >
          נסה שוב
        </button>
      )}
    </div>
  )
}
