'use client'

import { useId } from 'react'
import type { AgentTone } from '@/lib/inbox/autoresponse/conversational/agentProfile'

/**
 * "טון מועדף בשיחות עסקיות" — one compact single-select row instead of five large
 * radio cards. Each option's description shows under the row for the selected
 * option only, so the choice stays scannable and the explanation is still there.
 *
 * Native radios, visually hidden inside the chip: arrow keys, the group's name
 * and the checked state come from the platform, and the chip draws the same
 * selected ring the page's radio cards use (`has-checked:ring-solid`).
 *
 * Hebrew AI configuration (owner order: not localized); the caller renders it
 * inside the agent profile's declared Hebrew region.
 */
export const TONES: { value: AgentTone | ''; label: string; hint: string }[] = [
  { value: '', label: 'לפי הלקוח', hint: 'הסוכן מתאים את עצמו לאופן שבו הלקוח כותב' },
  { value: 'warm', label: 'חם ומקצועי', hint: 'אדיב, נעים, עם יחס אישי' },
  { value: 'professional', label: 'מקצועי וענייני', hint: 'קצר, ברור, בלי סלנג' },
  { value: 'friendly', label: 'קליל וחברי', hint: 'שפה יומיומית ומשוחררת' },
  { value: 'formal', label: 'רשמי ומנומס', hint: 'פנייה מכובדת, בלי קיצורים' },
]

export default function AgentToneChips({ value, onChange }: { value: AgentTone | ''; onChange: (tone: AgentTone | '') => void }) {
  const name = useId()
  const hintId = useId()
  const selected = TONES.find((t) => t.value === value) ?? TONES[0]
  return (
    <fieldset aria-describedby={hintId}>
      <legend className='text-sm font-semibold text-gray-700'>טון מועדף בשיחות עסקיות</legend>
      <div className='mt-2 flex flex-wrap gap-2'>
        {TONES.map((tone) => (
          <label
            key={tone.value || 'auto'}
            className='cursor-pointer rounded-full border border-gray-200 bg-white px-3.5 py-1.5 text-sm font-medium text-gray-700 transition-colors hover:border-gray-300 has-checked:border-solid has-checked:text-ink has-checked:ring-1 has-checked:ring-solid has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-primary'
          >
            <input
              type='radio'
              name={name}
              className='sr-only'
              checked={value === tone.value}
              onChange={() => onChange(tone.value)}
            />
            {tone.label}
          </label>
        ))}
      </div>
      <p id={hintId} className='mt-2 text-xs leading-relaxed text-gray-500' aria-live='polite'>
        {selected.hint}
      </p>
    </fieldset>
  )
}
