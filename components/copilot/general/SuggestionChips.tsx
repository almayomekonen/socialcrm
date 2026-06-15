'use client'

import { BRIEFING_EXAMPLES, BRIEFING_INTENT_IDS } from '@/lib/copilot/general/registry'
import { GUIDE_ENTRIES } from '@/lib/copilot/general/guideMap'

/** Phrased to trigger the Drive-search keyword detector (action + drive noun). */
export const DRIVE_SUGGESTION = 'מצא קובץ ב-Google Drive'

/** First example utterance per briefing intent + Drive — the "quick questions" set. */
export function briefingSuggestions(): string[] {
  return [...BRIEFING_INTENT_IDS.map((id) => BRIEFING_EXAMPLES[id][0]), DRIVE_SUGGESTION]
}

/** Full set incl. guide topics — used by the out-of-set capability menu. */
export function allSuggestions(): string[] {
  return [...briefingSuggestions(), ...GUIDE_ENTRIES.map((g) => g.examples[0])]
}

/** Tappable chip row. Reused by the proactive strip and the capability menu. */
export default function SuggestionChips({ items, onPick }: { items: string[]; onPick: (text: string) => void }) {
  return (
    <div className='flex flex-wrap gap-1.5'>
      {items.map((s) => (
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
  )
}
