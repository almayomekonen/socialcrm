'use client'

import { useId } from 'react'
import type { BuilderOption } from '@/lib/inbox/autoresponse/questionnaire/builder/model'
import type { EditorIssue } from '@/lib/inbox/autoresponse/questionnaire/builder/editorView'
import LimitedButton from './LimitedButton'
import PhrasingsEditor from './PhrasingsEditor'
import IconChooser from './IconChooser'
import OptionLabelLimit, { optionLabelDescribedBy, useOptionLabelInput } from './OptionLabelLimit'

/**
 * One answer option, on one line: its number as WhatsApp shows it, its name,
 * an optional icon, and (folded under the name) other ways customers say it.
 * The name and the icon are separate fields because they are separate things:
 * the name is what is recognised and what the נציג reads; the icon is
 * decoration after it in the menu ("1. חתונה 💍").
 *
 * The column headings ("אפשרות", "אייקון") are drawn once by the list; each
 * input carries its own screen-reader label.
 */
export default function OptionRow({
  option,
  number,
  onChange,
  onRemove,
  removeBlockedReason,
  issues,
  singleChoice,
}: {
  option: BuilderOption
  number: number
  singleChoice: boolean
  onChange: (patch: Partial<Pick<BuilderOption, 'label' | 'icon' | 'phrasings'>>) => void
  onRemove: () => void
  removeBlockedReason: string | null
  issues: EditorIssue[]
}) {
  const id = useId()
  const name = option.label.trim() || `אפשרות ${number}`
  const errorId = `${id}-error`
  const missing = issues.some((i) => i.code === 'missing_text')
  const labelInput = useOptionLabelInput((label) => onChange({ label }))
  const describedBy = [issues.length ? errorId : null, optionLabelDescribedBy(id, option.label, singleChoice)].filter(Boolean).join(' ')

  return (
    <li className='grid grid-cols-[1.5rem_minmax(0,1fr)_4.5rem_2.5rem] items-start gap-x-2 gap-y-1'>
      <span aria-hidden='true' className='pt-2 text-sm font-semibold text-gray-500'>
        {number}.
      </span>
      <div className='grid gap-1'>
        <label htmlFor={`${id}-label`} className='sr-only'>
          שם האפשרות {number}
        </label>
        <input
          id={`${id}-label`}
          value={option.label}
          onChange={(e) => labelInput.change(e.target.value)}
          placeholder='למשל: חתונה'
          aria-invalid={issues.length > 0}
          aria-describedby={describedBy}
          className='h-9 rounded-md border border-gray-200 bg-white px-2.5 text-sm focus:outline-2 focus:outline-primary aria-invalid:border-red-500'
        />
        {issues.length > 0 && (
          <p id={errorId} className='text-xs text-red-600'>
            {missing ? 'כתבו שם לאפשרות.' : issues.map((i) => i.text).join(' ')}
          </p>
        )}
        <OptionLabelLimit id={id} label={option.label} refused={labelInput.refused} singleChoice={singleChoice} />
        <PhrasingsEditor
          phrasings={option.phrasings}
          optionLabel={option.label}
          onChange={(phrasings) => onChange({ phrasings })}
        />
      </div>
      <div className='flex justify-center'>
        <IconChooser icon={option.icon} answerName={name} onChange={(icon) => onChange({ icon: icon ?? '' })} />
      </div>
      <LimitedButton
        size='icon'
        variant='ghost'
        icon='trash'
        aria-label={`מחיקת האפשרות ${name}`}
        blockedReason={removeBlockedReason}
        onClick={onRemove}
      />
    </li>
  )
}
