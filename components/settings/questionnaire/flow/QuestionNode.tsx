'use client'

import { Handle, Position, type NodeProps } from '@xyflow/react'
import { questionName } from '@/lib/inbox/autoresponse/questionnaire/builder/conditionText'
import {
  addOption,
  conditionOf,
  dependentsOf,
  disableOther,
  enableOther,
  keyOf,
  moveQuestion,
  optionsOf,
  otherOf,
  removeQuestion,
  setAnswerKind,
  setNotSetAllowed,
  setPrompt,
} from '@/lib/inbox/autoresponse/questionnaire/builder/editorOps'
import { applyTextCheck, currentTextCheck } from '../answerCheck'
import { answerTypeOf, cardIssueText, consequenceText, type AnswerType } from '../builderCopy'
import FlowOptionRow from './FlowOptionRow'
import QuestionSummary from './QuestionSummary'
import { useFlowEditor } from './flowContext'

export type QuestionNodeData = { questionKey: string; nodeId: string }

const TYPE_LABELS: Record<AnswerType, string> = { single: 'בחירה של תשובה אחת', multi: 'בחירה של כמה תשובות', free: 'תשובה חופשית' }
const EXPECT = [
  { value: 'any', label: 'כל תשובה' },
  { value: 'date', label: 'תאריך' },
  { value: 'location', label: 'מיקום / מקום' },
] as const

/**
 * A question as a piece of the conversation: what the customer is asked, the
 * answers they can pick, and (for an answer that leads somewhere else) where
 * that route goes. Everything is edited in place; nothing opens a dialog
 * except a deletion that changes other questions.
 */
export default function QuestionNode({ data, selected }: NodeProps & { data: QuestionNodeData }) {
  const { model, edit, confirm, announce, issuesFor, leave, select, routedOptions } = useFlowEditor()
  const key = data.questionKey
  const index = model.questions.findIndex((q) => keyOf(q) === key)
  const question = model.questions[index]
  if (!question) return null
  const type = answerTypeOf(question.answer.kind)
  const options = optionsOf(question)
  const other = otherOf(model, key)
  const issues = issuesFor(key)
  const own = issues.filter((i) => !i.optionId)
  const condition = conditionOf(question)
  const source = condition ? model.questions.find((q) => keyOf(q) === condition.questionId) : undefined
  const onlyFor = source
    ? condition!.anyOf.map((o) => optionsOf(source).find((x) => keyOf(x) === o)?.label || 'תשובה שנמחקה').join(' / ')
    : null
  const name = questionName(question)

  const changeType = (next: AnswerType) => {
    const kind = next === 'single' ? 'single_choice' : next === 'multi' ? 'multi_choice' : 'text'
    const run = () => edit((m) => setAnswerKind(m, key, kind))
    const consequence = next === 'free' ? consequenceText(dependentsOf(model, key)) : null
    if (!consequence) return run()
    confirm({ msg: `לשנות לתשובה חופשית?\nהתשובות של השאלה יימחקו.\n${consequence}`, confirmLbl: 'שינוי לתשובה חופשית', destructive: true, run })
  }

  const remove = () =>
    confirm({
      msg: [`למחוק את השאלה "${name}"?`, consequenceText(dependentsOf(model, key)) ?? ''].filter(Boolean).join('\n'),
      confirmLbl: 'מחיקת השאלה',
      destructive: true,
      run: () => {
        edit((m) => removeQuestion(m, key))
        announce(`השאלה "${name}" נמחקה`)
      },
    })

  if (!selected) {
    return <QuestionSummary question={question} number={index + 1} onlyFor={onlyFor} issues={issues} onEdit={() => select(data.nodeId)} routed={(o) => routedOptions.has(`${key}:${o}`)} />
  }

  const expect = currentTextCheck(question)
  return (
    <div
      dir='rtl'
      onFocusCapture={() => select(data.nodeId)}
      onBlurCapture={(e) => !e.currentTarget.contains(e.relatedTarget as Node | null) && leave(key)}
      className={`grid w-[340px] gap-2.5 rounded-xl border bg-white p-3.5 shadow-sm ${
        issues.some((i) => i.severity === 'error') ? 'border-red-300' : selected ? 'border-primary' : 'border-gray-200'
      }`}
    >
      <Handle type='target' position={Position.Top} id='in' isConnectable={false} className='!opacity-0' />
      <div className='flex items-center justify-between gap-2'>
        <p className='text-xs font-semibold text-gray-500'>שאלה {index + 1}</p>
        <div className='nodrag flex items-center'>
          {[
            ['↑', 'הקדמת השאלה', -1],
            ['↓', 'דחיית השאלה', 1],
          ].map(([sym, label, by]) => (
            <button
              key={label as string}
              type='button'
              aria-label={`${label} "${name}"`}
              onClick={() => edit((m) => moveQuestion(m, key, by as -1 | 1))}
              disabled={(by === -1 && index === 0) || (by === 1 && index === model.questions.length - 1)}
              className='flex size-7 items-center justify-center rounded text-gray-500 hover:bg-gray-100 disabled:opacity-30'
            >
              {sym}
            </button>
          ))}
          <button type='button' aria-label={`מחיקת השאלה "${name}"`} onClick={remove} className='flex size-7 items-center justify-center rounded text-gray-500 hover:bg-gray-100'>
            ×
          </button>
        </div>
      </div>

      {onlyFor && (
        <p className='rounded-md bg-gray-50 px-2 py-1 text-xs text-gray-700'>
          נשאלת רק מי שבחר: <span className='font-medium'>{onlyFor}</span>
        </p>
      )}

      <label className='sr-only' htmlFor={`${key}-prompt`}>
        מה נשאל את הלקוח
      </label>
      <textarea
        id={`${key}-prompt`}
        value={question.prompt}
        rows={Math.min(6, Math.max(2, question.prompt.split('\n').length))}
        placeholder='מה נשאל את הלקוח?'
        aria-invalid={own.some((i) => i.field === 'prompt')}
        onChange={(e) => edit((m) => setPrompt(m, key, e.target.value))}
        className='nodrag nowheel resize-none rounded-md border border-transparent bg-gray-50 px-2.5 py-2 text-sm font-medium leading-relaxed hover:border-gray-200 focus:border-gray-200 focus:bg-white focus:outline-2 focus:outline-primary aria-invalid:border-red-400'
      />

      <select
        aria-label='סוג התשובה'
        value={type}
        onChange={(e) => changeType(e.target.value as AnswerType)}
        className='nodrag h-8 rounded-md border border-gray-200 bg-white pe-7 ps-2 text-xs text-gray-700'
      >
        {(Object.keys(TYPE_LABELS) as AnswerType[]).map((t) => (
          <option key={t} value={t}>
            {TYPE_LABELS[t]}
          </option>
        ))}
      </select>

      {type === 'free' ? (
        <div className='grid gap-1.5'>
          <label className='text-xs text-gray-600' htmlFor={`${key}-expect`}>
            איזו תשובה אנחנו מצפים לקבל?
          </label>
          <select
            id={`${key}-expect`}
            value={expect === 'date' || expect === 'location' ? expect : 'any'}
            onChange={(e) => edit((m) => (e.target.value === 'any' ? m : applyTextCheck(m, key, e.target.value as 'date' | 'location')))}
            className='nodrag h-8 rounded-md border border-gray-200 bg-white pe-7 ps-2 text-xs'
          >
            {EXPECT.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          {(expect === 'date' || expect === 'location') && (
            <label className='nodrag flex items-center gap-2 text-xs text-gray-700'>
              <input
                type='checkbox'
                className='size-4 accent-solid'
                checked={'notSetAllowed' in question.answer && question.answer.notSetAllowed}
                onChange={(e) => edit((m) => setNotSetAllowed(m, key, e.target.checked))}
              />
              אפשר לענות "עדיין לא נקבע"
            </label>
          )}
        </div>
      ) : (
        <div className='grid gap-2'>
          <ol className='grid gap-2' aria-label='התשובות ללקוח'>
            {options.map((o, i) => (
              <FlowOptionRow
                key={o.ref ?? o.id}
                questionKey={key}
                option={o}
                number={i + 1}
                canRemove={options.length > 2}
                invalid={issues.some((x) => x.optionId === keyOf(o))}
              />
            ))}
          </ol>
          <div className='nodrag flex flex-wrap items-center justify-between gap-2'>
            {options.length < 10 && (
              <button type='button' onClick={() => edit((m) => addOption(m, key))} className='text-xs font-medium text-primary hover:underline'>
                + הוספת תשובה
              </button>
            )}
            <label className='flex items-center gap-1.5 text-xs text-gray-700'>
              <input
                type='checkbox'
                className='size-4 accent-solid'
                checked={other !== null}
                disabled={!other && options.length >= 10}
                onChange={(e) =>
                  e.target.checked
                    ? edit((m) => enableOther(m, key))
                    : other?.followUp
                      ? confirm({
                          msg: `להסיר את "${other.option.label}"?\nגם שאלת ההמשך שלה תימחק.`,
                          confirmLbl: `הסרת "${other.option.label}"`,
                          destructive: true,
                          run: () => edit((m) => disableOther(m, key)),
                        })
                      : edit((m) => disableOther(m, key))
                }
              />
              אפשר לבחור "אחר"
            </label>
          </div>
        </div>
      )}

      {own.length > 0 && (
        <ul className='grid gap-0.5 rounded-md bg-red-50 px-2 py-1.5 text-xs text-red-700'>
          {own.map((i, n) => (
            <li key={n}>{cardIssueText(i)}</li>
          ))}
        </ul>
      )}
      {issues.some((i) => i.optionId && i.code === 'missing_text') && <p className='text-xs text-red-700'>כתבו שם לכל תשובה.</p>}
      <Handle type='source' position={Position.Bottom} id='next' isConnectable={false} className='!opacity-0' />
    </div>
  )
}
