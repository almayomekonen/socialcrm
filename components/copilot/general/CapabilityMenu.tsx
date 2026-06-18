'use client'

import SuggestionChips, { curatedSuggestions } from './SuggestionChips'

/**
 * The honest out-of-set fallback: shows exactly what the assistant can answer.
 * Tapping a suggestion re-submits it. Never a guessed answer to an unsupported
 * question.
 */
export default function CapabilityMenu({ onPick }: { onPick: (text: string) => void }) {
  return (
    <div className='space-y-1.5'>
      <p className='text-[12.5px] text-gray-500'>אני יכול לעזור עם:</p>
      <SuggestionChips items={curatedSuggestions()} onPick={onPick} />
    </div>
  )
}
