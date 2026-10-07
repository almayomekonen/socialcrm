'use client'

import { useId } from 'react'
import { Btn } from '@/lib/btns/Btn'
import { Switch } from '@/lib/form'
import {
  addOption,
  dependentsOf,
  disableOther,
  enableOther,
  keyOf,
  optionsOf,
  otherOf,
  removeOption,
  updateOption,
  updateQuestion,
} from '@/lib/inbox/autoresponse/questionnaire/builder/editorOps'
import type { EditorIssue } from '@/lib/inbox/autoresponse/questionnaire/builder/editorView'
import type { BuilderQuestion, BuilderQuestionnaire } from '@/lib/inbox/autoresponse/questionnaire/builder/model'
import OptionRow from './OptionRow'
import { consequenceText, type ConfirmRequest } from './builderCopy'

const MAX_OPTIONS = 10

type Edit = (change: (m: BuilderQuestionnaire) => BuilderQuestionnaire) => void

/**
 * The answers a customer can pick, numbered as WhatsApp shows them, and the one
 * switch for "אחר": turning it on adds the option and the follow-up question
 * asked after it (editorOptions.ts), so the owner writes one sentence instead
 * of wiring a branch.
 */
export default function OptionsEditor({
  model,
  question,
  edit,
  issues,
  confirm,
}: {
  model: BuilderQuestionnaire
  question: BuilderQuestion
  edit: Edit
  issues: EditorIssue[]
  confirm: (request: ConfirmRequest) => void
}) {
  const id = useId()
  const qKey = keyOf(question)
  const options = optionsOf(question)
  const other = otherOf(model, qKey)
  const optionIssues = (optionKey: string) => issues.filter((i) => i.optionId === optionKey)

  /** Remove an option (or "אחר" with its follow-up), saying first what else it changes. */
  const remove = (optionKey: string, label: string) => {
    const isOther = other !== null && keyOf(other.option) === optionKey
    const run = () => edit((m) => (isOther ? disableOther(m, qKey) : removeOption(m, qKey, optionKey)))
    const deps = dependentsOf(model, qKey, [optionKey])
    const followUpKey = isOther && other?.followUp ? keyOf(other.followUp) : null
    const consequence = consequenceText({ ...deps, questions: deps.questions.filter((k) => k !== followUpKey) })
    if (!consequence && !followUpKey) return run()
    const name = label.trim() || 'האפשרות'
    confirm({
      msg: [`להסיר את "${name}"?`, followUpKey ? 'גם שאלת ההמשך שלה תימחק.' : '', consequence ?? ''].filter(Boolean).join('\n'),
      confirmLbl: `הסרת "${name}"`,
      destructive: true,
      run,
    })
  }

  return (
    <div className='grid gap-3'>
      <ol className='grid gap-2' aria-label='האפשרויות ללקוח'>
        {options.map((o, i) => (
          <OptionRow
            key={keyOf(o)}
            option={o}
            number={i + 1}
            issues={optionIssues(keyOf(o))}
            canRemove={options.length > 2}
            onChange={(patch) => edit((m) => updateOption(m, qKey, keyOf(o), patch))}
            onRemove={() => remove(keyOf(o), o.label)}
          />
        ))}
      </ol>

      <div>
        <Btn
          type='button'
          size='small'
          variant='outline'
          icon='plus'
          lbl='הוספת אפשרות'
          onClick={() => edit((m) => addOption(m, qKey))}
          disabled={options.length >= MAX_OPTIONS}
          title={options.length >= MAX_OPTIONS ? 'אפשר עד 10 אפשרויות בשאלה' : undefined}
        />
      </div>

      <div className='grid gap-2 rounded-md border border-gray-200 p-3'>
        <Switch
          lbl='אפשר ללקוח לבחור "אחר"'
          checked={other !== null}
          disabled={!other && options.length >= MAX_OPTIONS}
          onChange={(e) =>
            e.target.checked ? edit((m) => enableOther(m, qKey)) : other && remove(keyOf(other.option), other.option.label)
          }
        />
        {other && !other.followUp && (
          <div className='flex flex-wrap items-center gap-2'>
            <p className='text-sm text-gray-700'>כשלקוח בוחר "{other.option.label}", כדאי לשאול אותו לפרטים.</p>
            <Btn
              type='button'
              size='small'
              variant='outline'
              lbl='הוספת שאלת המשך'
              onClick={() => edit((m) => enableOther(m, qKey))}
            />
          </div>
        )}
        {other?.followUp && (
          <div className='grid gap-1'>
            <label htmlFor={`${id}-followup`} className='text-sm text-gray-700'>
              מה נשאל כשהלקוח בוחר "{other.option.label}"?
            </label>
            <textarea
              id={`${id}-followup`}
              rows={2}
              maxLength={900}
              value={other.followUp.prompt}
              onChange={(e) => {
                const followUpKey = keyOf(other.followUp as BuilderQuestion)
                edit((m) => updateQuestion(m, followUpKey, { prompt: e.target.value }))
              }}
              className='rounded-md border border-gray-200 bg-white px-2.5 py-2 text-sm focus:outline-2 focus:outline-primary'
            />
            <p className='text-xs text-gray-500'>שאלת ההמשך מופיעה גם ככרטיס משלה ברשימת השאלות.</p>
          </div>
        )}
      </div>
    </div>
  )
}
