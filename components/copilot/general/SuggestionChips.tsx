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

export function curatedSuggestions(): string[] {
  return ['מה דורש תשומת לב', 'מי צריך מעקב היום', 'מה מצב המערכת', 'פגישות היום']
}

export default function SuggestionChips({
  items,
  onPick,
  disabled = false,
}: {
  items: string[]
  onPick: (text: string) => void
  disabled?: boolean
}) {
  return (
    <div className='flex flex-wrap gap-1.5'>
      {items.map((s) => (
        <button
          key={s}
          type='button'
          disabled={disabled}
          onClick={() => onPick(s)}
          className='rounded-full bg-gray-100 px-2.5 py-1 text-xs text-gray-600 hover:bg-gray-200 transition-colors'
        >
          {s}
        </button>
      ))}
    </div>
  )
}
