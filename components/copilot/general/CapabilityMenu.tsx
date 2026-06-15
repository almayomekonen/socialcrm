'use client'

import { BRIEFING_EXAMPLES, BRIEFING_INTENT_IDS } from '@/lib/copilot/general/registry'
import { GUIDE_ENTRIES } from '@/lib/copilot/general/guideMap'

/**
 * The honest out-of-set fallback: shows exactly what the assistant can answer.
 * Tapping a suggestion re-submits it as the next question. Never a guessed
 * answer to an unsupported question.
 */
export default function CapabilityMenu({ onPick }: { onPick: (text: string) => void }) {
  const suggestions = [
    ...BRIEFING_INTENT_IDS.map((id) => BRIEFING_EXAMPLES[id][0]),
    ...GUIDE_ENTRIES.map((g) => g.examples[0]),
  ]
  return (
    <div className='space-y-1.5'>
      <p className='text-[12.5px] text-gray-500'>אני יכול לעזור עם:</p>
      <div className='flex flex-wrap gap-1.5'>
        {suggestions.map((s) => (
          <button
            key={s}
            type='button'
            onClick={() => onPick(s)}
            className='rounded-full border border-gray-200 px-2.5 py-1 text-[12px] text-gray-700 hover:bg-gray-50 transition-colors'
          >
            {s}
          </button>
        ))}
      </div>
    </div>
  )
}
