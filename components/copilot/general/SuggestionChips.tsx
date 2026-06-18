'use client'

import { BRIEFING_EXAMPLES, BRIEFING_INTENT_IDS } from '@/lib/copilot/general/registry'
import { GUIDE_ENTRIES } from '@/lib/copilot/general/guideMap'

export const DRIVE_SUGGESTION = 'מצא קובץ ב-Google Drive'

export function briefingSuggestions(): string[] {
  return [...BRIEFING_INTENT_IDS.map((id) => BRIEFING_EXAMPLES[id][0]), DRIVE_SUGGESTION]
}

export function allSuggestions(): string[] {
  return [...briefingSuggestions(), ...GUIDE_ENTRIES.map((g) => g.examples[0])]
}

/**
 * Short curated fallback after an out-of-set question — a few high-value prompts,
 * not the full catalog. Each phrase classifies deterministically.
 */
export function curatedSuggestions(): string[] {
  return ['מה דורש תשומת לב', 'מי צריך מעקב היום', 'מה מצב המערכת', 'פגישות היום']
}

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
