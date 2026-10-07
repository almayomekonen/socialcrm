'use client'

import { useId } from 'react'
import { Btn } from '@/lib/btns/Btn'
import type { BuilderOption } from '@/lib/inbox/autoresponse/questionnaire/builder/model'
import type { EditorIssue } from '@/lib/inbox/autoresponse/questionnaire/builder/editorView'
import PhrasingsEditor from './PhrasingsEditor'

/**
 * One answer option: its name, an optional icon, and other ways customers say
 * it. The name and the icon are separate fields because they are separate
 * things: the name is what is recognised and what the נציג reads; the icon is
 * decoration after it in the menu ("1. חתונה 💍") and nothing else.
 */
export default function OptionRow({
  option,
  number,
  onChange,
  onRemove,
  canRemove,
  issues,
}: {
  option: BuilderOption
  number: number
  onChange: (patch: Partial<Pick<BuilderOption, 'label' | 'icon' | 'phrasings'>>) => void
  onRemove: () => void
  canRemove: boolean
  issues: EditorIssue[]
}) {
  const id = useId()
  const name = option.label.trim() || `אפשרות ${number}`
  const errorId = `${id}-error`

  return (
    <li className='grid gap-2 rounded-md border border-gray-200 bg-white p-3'>
      <div className='flex flex-wrap items-end gap-2'>
        <span aria-hidden='true' className='pb-2 text-sm font-semibold text-gray-500'>
          {number}.
        </span>
        <div className='grid min-w-40 flex-1 gap-1'>
          <label htmlFor={`${id}-label`} className='text-xs text-gray-600'>
            שם האפשרות {number}
          </label>
          <input
            id={`${id}-label`}
            value={option.label}
            maxLength={24}
            onChange={(e) => onChange({ label: e.target.value })}
            placeholder='למשל: חתונה'
            aria-invalid={issues.length > 0}
            aria-describedby={issues.length ? errorId : undefined}
            className='h-9 rounded-md border border-gray-200 bg-white px-2.5 text-sm focus:outline-2 focus:outline-primary aria-invalid:border-red-500'
          />
        </div>
        <div className='grid w-24 gap-1'>
          <label htmlFor={`${id}-icon`} className='text-xs text-gray-600'>
            אייקון (רשות)
          </label>
          <input
            id={`${id}-icon`}
            value={option.icon ?? ''}
            maxLength={8}
            onChange={(e) => onChange({ icon: e.target.value })}
            className='h-9 rounded-md border border-gray-200 bg-white px-2.5 text-center text-sm focus:outline-2 focus:outline-primary'
          />
        </div>
        <Btn
          type='button'
          size='small'
          variant='ghost'
          icon='trash'
          aria-label={`מחיקת האפשרות ${name}`}
          onClick={onRemove}
          disabled={!canRemove}
          title={canRemove ? undefined : 'בשאלת בחירה צריכות להיות לפחות שתי אפשרויות'}
        />
      </div>
      {issues.length > 0 && (
        <ul id={errorId} className='grid gap-0.5'>
          {issues.map((i, n) => (
            <li key={n} className='text-sm text-red-600'>
              {i.text}
            </li>
          ))}
        </ul>
      )}
      <PhrasingsEditor
        phrasings={option.phrasings}
        optionLabel={option.label}
        onChange={(phrasings) => onChange({ phrasings })}
      />
    </li>
  )
}
