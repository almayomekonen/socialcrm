'use client'

import { Switch } from '@/lib/form'
import {
  addOption,
  dependentsOf,
  disableOther,
  enableOther,
  keyOf,
  reactKey,
  optionsOf,
  otherOf,
  questionsFull,
  removeOption,
  updateOption,
} from '@/lib/inbox/autoresponse/questionnaire/builder/editorOps'
import type { EditorIssue } from '@/lib/inbox/autoresponse/questionnaire/builder/editorView'
import type { BuilderQuestion, BuilderQuestionnaire } from '@/lib/inbox/autoresponse/questionnaire/builder/model'
import OptionRow from './OptionRow'
import LimitedButton, { useLimitedAction } from './LimitedButton'
import { focusCard } from './focusCard'
import { QUESTIONS_FULL, consequenceText, otherBlockedReason, type ConfirmRequest } from './builderCopy'

const MAX_OPTIONS = 10

type Edit = (change: (m: BuilderQuestionnaire) => BuilderQuestionnaire) => void

/**
 * The answers a customer can pick, numbered as WhatsApp shows them, and the one
 * switch for "אחר". Turning it on adds the option and a follow-up question
 * asked only after it (editorOptions.ts); the follow-up is a card of its own,
 * drawn right under this one, and this list says so in words with a link to
 * it, so the owner never edits the same text in two places.
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
  const qKey = keyOf(question)
  const options = optionsOf(question)
  const other = otherOf(model, qKey)
  const full = options.length >= MAX_OPTIONS
  const optionIssues = (optionKey: string) => issues.filter((i) => i.optionId === optionKey)
  const followUpNumber = other?.followUp ? model.questions.indexOf(other.followUp) + 1 : null
  // "אחר" comes with a follow-up question, so at 12 questions it cannot be turned on (editorBase.ts MAX_QUESTIONS).
  const questionsAreFull = questionsFull(model)
  const otherBlocked = otherBlockedReason({ hasOther: other !== null, optionsFull: full, questionsFull: questionsAreFull })
  const addOtherFollowUp = useLimitedAction(questionsAreFull ? QUESTIONS_FULL : null, () => edit((m) => enableOther(m, qKey)))

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
      <div className='grid gap-2'>
        <div aria-hidden='true' className='grid grid-cols-[1.5rem_minmax(0,1fr)_4.5rem_2.5rem] gap-x-2 text-xs text-gray-500'>
          <span />
          <span>אפשרות</span>
          <span className='text-center'>אייקון</span>
          <span />
        </div>
        <ol className='grid gap-2.5' aria-label='האפשרויות ללקוח'>
          {options.map((o, i) => (
            <OptionRow
              key={reactKey(o)}
              option={o}
              number={i + 1}
              issues={optionIssues(keyOf(o))}
              singleChoice={question.answer.kind === 'single_choice'}
              removeBlockedReason={options.length > 2 ? null : 'בשאלת בחירה צריכות להיות לפחות שתי אפשרויות.'}
              onChange={(patch) => edit((m) => updateOption(m, qKey, keyOf(o), patch))}
              onRemove={() => remove(keyOf(o), o.label)}
            />
          ))}
        </ol>
      </div>

      <div className='flex flex-wrap items-start justify-between gap-3'>
        <LimitedButton
          size='small'
          variant='outline'
          icon='plus'
          lbl='הוספת אפשרות'
          blockedReason={full ? 'אפשר עד 10 אפשרויות בשאלה.' : null}
          onClick={() => edit((m) => addOption(m, qKey))}
        />
        <div className='grid gap-1'>
          <Switch
            lbl='אפשר ללקוח לבחור "אחר"'
            checked={other !== null}
            disabled={otherBlocked !== null}
            aria-describedby={otherBlocked ? `${qKey}-other-full` : undefined}
            onChange={(e) =>
              e.target.checked ? edit((m) => enableOther(m, qKey)) : other && remove(keyOf(other.option), other.option.label)
            }
          />
          {otherBlocked && (
            <p id={`${qKey}-other-full`} className='text-xs text-gray-600'>
              {otherBlocked}
            </p>
          )}
        </div>
      </div>

      {other && (
        <p className='rounded-md bg-gray-50 px-3 py-2 text-sm text-gray-700'>
          {other.followUp ? (
            <>
              כשלקוח בוחר "{other.option.label}", נשאל אותו גם: "{other.followUp.prompt.trim() || 'שאלת המשך'}"{' '}
              <button
                type='button'
                onClick={() => focusCard(keyOf(other.followUp as BuilderQuestion))}
                className='font-medium text-ink underline underline-offset-2'
              >
                עריכת שאלת ההמשך (שאלה {followUpNumber})
              </button>
            </>
          ) : (
            <>
              כשלקוח בוחר "{other.option.label}", כדאי לשאול אותו לפרטים.{' '}
              <button
                type='button'
                {...addOtherFollowUp.buttonProps}
                className={`font-medium text-ink underline underline-offset-2 ${addOtherFollowUp.blocked ? 'cursor-not-allowed opacity-50' : ''}`}
              >
                הוספת שאלת המשך
              </button>{' '}
              {addOtherFollowUp.reason}
            </>
          )}
        </p>
      )}
    </div>
  )
}
