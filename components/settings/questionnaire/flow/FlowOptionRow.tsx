'use client'

import { Handle, Position } from '@xyflow/react'
import {
  addFollowUp,
  conditionOf,
  dependentsOf,
  keyOf,
  newRef,
  questionsFull,
  reactKey,
  removeOption,
  updateOption,
} from '@/lib/inbox/autoresponse/questionnaire/builder/editorOps'
import type { BuilderOption } from '@/lib/inbox/autoresponse/questionnaire/builder/model'
import PhrasingsEditor from '../PhrasingsEditor'
import IconChooser from '../IconChooser'
import { QUESTIONS_FULL, consequenceText } from '../builderCopy'
import { useLimitedAction } from '../LimitedButton'
import OptionLabelLimit, { optionLabelDescribedBy, useOptionLabelInput } from '../OptionLabelLimit'
import { useFlowEditor } from './flowContext'

/**
 * One answer, as the customer sees it in the menu ("💄 איפור"), with the one
 * action that matters on a map: "+ שאלת המשך" — if the customer chooses this,
 * ask them this too. The arrow for that route leaves from this row.
 *
 * Icon and name are separate fields (the icon is decoration after the name in
 * WhatsApp); other ways customers write it are folded underneath.
 */
export default function FlowOptionRow({
  questionKey,
  option,
  number,
  canRemove,
  invalid,
}: {
  questionKey: string
  option: BuilderOption
  number: number
  canRemove: boolean
  invalid: boolean
}) {
  const { model, edit, reveal, select, announce, confirm, routedOptions } = useFlowEditor()
  const optionKey = keyOf(option)
  const inputId = `${reactKey(option)}-label`
  const singleChoice = model.questions.find((q) => keyOf(q) === questionKey)?.answer.kind === 'single_choice'
  const labelInput = useOptionLabelInput((label) => edit((m) => updateOption(m, questionKey, optionKey, { label })))
  const name = option.label.trim() || `אפשרות ${number}`
  const followUps = model.questions.filter((q) => {
    const c = conditionOf(q)
    return c?.questionId === questionKey && c.anyOf.length === 1 && c.anyOf[0] === optionKey
  })

  const remove = () => {
    const run = () => edit((m) => removeOption(m, questionKey, optionKey))
    const consequence = consequenceText(dependentsOf(model, questionKey, [optionKey]))
    if (!consequence) return run()
    confirm({ msg: `להסיר את "${name}"?\n${consequence}`, confirmLbl: `הסרת "${name}"`, destructive: true, run })
  }

  const addFollow = () => {
    const ref = newRef()
    edit((m) => addFollowUp(m, questionKey, optionKey, 'text', ref))
    announce(`נוספה שאלת המשך למי שבוחר "${name}"`)
    select(ref)
    reveal(ref)
  }
  // A follow-up is a question: at 12 the action says so instead of adding one (editorBase.ts MAX_QUESTIONS).
  const follow = useLimitedAction(questionsFull(model) ? QUESTIONS_FULL : null, addFollow)

  return (
    <li className='relative grid gap-1'>
      <div className='flex items-center gap-1.5'>
        <span aria-hidden='true' className='w-5 shrink-0 text-xs font-semibold text-gray-500'>
          {number}.
        </span>
        <label className='sr-only' htmlFor={inputId}>
          תשובה {number}
        </label>
        <input
          id={inputId}
          value={option.label}
          placeholder='כתבו תשובה'
          aria-invalid={invalid}
          aria-describedby={optionLabelDescribedBy(inputId, option.label, singleChoice)}
          onChange={(e) => labelInput.change(e.target.value)}
          className='nodrag h-8 min-w-0 flex-1 rounded-md border border-transparent bg-gray-50 px-2 text-sm hover:border-gray-200 focus:border-gray-200 focus:bg-white focus:outline-2 focus:outline-primary aria-invalid:border-red-400'
        />
        <IconChooser
          icon={option.icon}
          answerName={name}
          onChange={(icon) => edit((m) => updateOption(m, questionKey, optionKey, { icon: icon ?? '' }))}
        />
        {canRemove && (
          <button
            type='button'
            aria-label={`מחיקת התשובה ${name}`}
            onClick={remove}
            className='nodrag flex size-7 shrink-0 items-center justify-center rounded text-gray-400 hover:bg-gray-100 hover:text-gray-700 focus-visible:outline-2 focus-visible:outline-primary'
          >
            ×
          </button>
        )}
      </div>
      <div className='ps-6'>
        <OptionLabelLimit id={inputId} label={option.label} refused={labelInput.refused} singleChoice={singleChoice} />
      </div>
      <div className='flex flex-wrap items-center gap-x-3 ps-6'>
        {followUps.length > 0 ? (
          <button
            type='button'
            onClick={() => {
              select(reactKey(followUps[0]))
              reveal(reactKey(followUps[0]))
            }}
            className='nodrag text-xs font-medium text-ink underline underline-offset-2'
          >
            ממשיך לשאלת המשך
          </button>
        ) : (
          <>
            <button
              type='button'
              {...follow.buttonProps}
              className={`nodrag text-xs font-medium text-primary hover:underline ${follow.blocked ? 'cursor-not-allowed opacity-50' : ''}`}
            >
              + שאלת המשך אם בוחרים בזה
            </button>
            {follow.reason}
          </>
        )}
      </div>
      <div className='nodrag ps-6'>
        <PhrasingsEditor
          phrasings={option.phrasings}
          optionLabel={option.label}
          summaryLabel={option.phrasings.length ? 'ניסוחים של לקוחות' : '+ איך לקוחות יכולים לנסח את זה?'}
          onChange={(phrasings) => edit((m) => updateOption(m, questionKey, optionKey, { phrasings }))}
        />
      </div>
      {/* The route for this answer leaves from here (drawn only when it has its own route). */}
      <Handle
        type='source'
        position={Position.Left}
        id={`opt-${optionKey}-l`}
        isConnectable={false}
        className={`!size-2 !min-h-0 !min-w-0 !border-0 !bg-indigo-400 ${routedOptions.has(`${questionKey}:${optionKey}-l`) ? '' : '!opacity-0'}`}
        style={{ top: 16 }}
      />
      <Handle
        type='source'
        position={Position.Right}
        id={`opt-${optionKey}-r`}
        isConnectable={false}
        className={`!size-2 !min-h-0 !min-w-0 !border-0 !bg-indigo-400 ${routedOptions.has(`${questionKey}:${optionKey}-r`) ? '' : '!opacity-0'}`}
        style={{ top: 16 }}
      />
    </li>
  )
}
