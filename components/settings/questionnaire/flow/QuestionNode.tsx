'use client'

import { useEffect, useRef } from 'react'
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
  reactKey,
  optionsOf,
  otherOf,
  removeQuestion,
  setAnswerKind,
  setPrompt,
} from '@/lib/inbox/autoresponse/questionnaire/builder/editorOps'
import { answerTypeOf, cardIssueText, consequenceText, type AnswerType } from '../builderCopy'
import FlowOptionRow from './FlowOptionRow'
import FlowTextAnswer from './FlowTextAnswer'
import QuestionSummary from './QuestionSummary'
import { useFlowEditor } from './flowContext'
import { focusAfterRemoval } from './removalFocus'
import ArrowInsertButton from './ArrowInsertButton'

export type QuestionNodeData = { questionKey: string; nodeId: string }

const TYPE_LABELS: Record<AnswerType, string> = { single: 'בחירה של תשובה אחת', multi: 'בחירה של כמה תשובות', free: 'תשובה חופשית' }

/**
 * A question as a piece of the conversation: what the customer is asked, the
 * answers they can pick, and (for an answer that leads somewhere else) where
 * that route goes. Everything is edited in place; nothing opens a dialog
 * except a deletion that changes other questions.
 */
export default function QuestionNode({ data, selected }: NodeProps & { data: QuestionNodeData }) {
  const { model, edit, confirm, announce, issuesFor, leave, select, reveal, routedOptions, focusRequest, focusDone, returnFocusTo } = useFlowEditor()
  const promptRef = useRef<HTMLTextAreaElement>(null)
  // Just created ("+ הוספת שאלה" / "+ שאלת המשך"): the cursor goes straight to the question.
  // A new box stays invisible until React Flow has measured it, and focusing an
  // invisible field does nothing, so try for a few frames until focus lands.
  useEffect(() => {
    if (!selected || focusRequest !== data.nodeId) return
    let frames = 0
    let handle = 0
    const attempt = () => {
      const el = promptRef.current
      el?.focus({ preventScroll: true })
      if (el && document.activeElement === el) return focusDone()
      if (++frames < 30) handle = requestAnimationFrame(attempt)
    }
    attempt()
    return () => cancelAnimationFrame(handle)
  }, [selected, focusRequest, data.nodeId, focusDone])
  // Found by the render key, which never changes: React Flow hands a box its
  // data one render late, so a draft key that a save just replaced would miss
  // for a moment and remount the box (losing the cursor mid-typing).
  const index = model.questions.findIndex((q) => reactKey(q) === data.nodeId)
  const question = model.questions[index]
  const key = question ? keyOf(question) : data.questionKey
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
        const next = focusAfterRemoval(model, key)
        edit((m) => removeQuestion(m, key))
        announce(`השאלה "${name}" נמחקה`)
        select(null)
        returnFocusTo(next)
      },
    })

  if (!selected) {
    return (
      <>
        <QuestionSummary question={question} number={index + 1} onlyFor={onlyFor} issues={issues} onEdit={() => select(data.nodeId)} routed={(o, side) => routedOptions.has(`${key}:${o}-${side}`)} />
        <ArrowInsertButton nodeId={data.nodeId} />
      </>
    )
  }

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
        ref={promptRef}
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
        <FlowTextAnswer questionKey={key} />
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
          {other?.followUp && (
            <p className='rounded-md bg-gray-50 px-2 py-1.5 text-xs text-gray-700'>
              מי שבוחר "{other.option.label}" יישאל: "{other.followUp.prompt.trim() || 'שאלת המשך'}"{' '}
              <button
                type='button'
                onClick={() => {
                  const target = other.followUp?.ref ?? other.followUp?.id ?? ''
                  select(target)
                  reveal(target)
                }}
                className='nodrag font-medium text-ink underline underline-offset-2'
              >
                עריכה
              </button>
            </p>
          )}
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
      <ArrowInsertButton nodeId={data.nodeId} />
    </div>
  )
}
