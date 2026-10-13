'use client'

import { useId, useState } from 'react'
import { Btn } from '@/lib/btns/Btn'
import { Select } from '@/lib/form'
import { questionName } from '@/lib/inbox/autoresponse/questionnaire/builder/conditionText'
import {
  conditionOf,
  dependentsOf,
  keyOf,
  moveQuestion,
  removeQuestion,
  setAnswerKind,
  setPrompt,
  updateQuestion,
  type QuestionKind,
} from '@/lib/inbox/autoresponse/questionnaire/builder/editorOps'
import type { EditorIssue } from '@/lib/inbox/autoresponse/questionnaire/builder/editorView'
import type { BuilderQuestion, BuilderQuestionnaire } from '@/lib/inbox/autoresponse/questionnaire/builder/model'
import { ANSWER_TYPES, answerTypeOf, cardIssueText, consequenceText, type AnswerType, type ConfirmRequest } from './builderCopy'
import { cardDomId } from './focusCard'
import OptionsEditor from './OptionsEditor'
import QuestionWhen from './QuestionWhen'
import TextAnswerSettings from './TextAnswerSettings'

type Edit = (change: (m: BuilderQuestionnaire) => BuilderQuestionnaire) => void

const KIND_FOR: Record<AnswerType, QuestionKind> = { single: 'single_choice', multi: 'multi_choice', free: 'text_unchecked' }

/**
 * One question, as the three things the owner needs to know about it, in the
 * order and weight they matter:
 *   1. מה הלקוח יראה      — the message, first and largest;
 *   2. איך הלקוח יכול לענות — the answers, or how a written answer is checked;
 *   3. מתי השאלה תופיע     — a quiet line, unless the question depends on an
 *                            answer; then it leads the card and the card is
 *                            indented, so routes can be scanned down the page.
 * Order controls are named buttons, not a drag handle.
 *
 * `issues` arrive already filtered: a card shows problems only once the owner
 * has worked on it or tried to publish (QuestionnaireBuilder).
 */
export default function QuestionCard({
  model,
  question,
  index,
  issues,
  edit,
  confirm,
  onFocus,
  onLeave,
  announce,
  allowAllEnabled = false,
}: {
  model: BuilderQuestionnaire
  question: BuilderQuestion
  index: number
  issues: EditorIssue[]
  edit: Edit
  confirm: (request: ConfirmRequest) => void
  onFocus: () => void
  /** Focus left the card: from now on its problems are shown. */
  onLeave: () => void
  announce: (message: string) => void
  /** "לקוח יכול לענות 'הכל'", decided on the server (canUseQuestionnaireNaturalAnswers): shown only where it has an effect. */
  allowAllEnabled?: boolean
}) {
  const id = useId()
  const key = keyOf(question)
  const count = model.questions.length
  const name = questionName(question)
  const type = answerTypeOf(question.answer.kind)
  const ownIssues = issues.filter((i) => !i.optionId)
  const promptIssue = ownIssues.some((i) => i.field === 'prompt')
  const labelIssue = ownIssues.some((i) => i.field === 'label')
  const conditional = conditionOf(question) !== null
  const [whenEditing, setWhenEditing] = useState(false)
  const when = <QuestionWhen model={model} question={question} edit={edit} editing={whenEditing} setEditing={setWhenEditing} />

  const move = (by: -1 | 1) => {
    edit((m) => moveQuestion(m, key, by))
    announce(`השאלה "${name}" הועברה למקום ${index + 1 + by}`)
  }

  const changeType = (next: AnswerType) => {
    const run = () => edit((m) => setAnswerKind(m, key, KIND_FOR[next]))
    const consequence = next === 'free' ? consequenceText(dependentsOf(model, key)) : null
    if (!consequence) return run()
    confirm({
      msg: `לשנות את השאלה "${name}" לתשובה חופשית?\nהאפשרויות שלה יימחקו.\n${consequence}`,
      confirmLbl: 'שינוי לתשובה חופשית',
      destructive: true,
      run,
    })
  }

  const remove = () => {
    const consequence = consequenceText(dependentsOf(model, key))
    confirm({
      msg: [`למחוק את השאלה "${name}"?`, consequence ?? ''].filter(Boolean).join('\n'),
      confirmLbl: 'מחיקת השאלה',
      destructive: true,
      run: () => {
        edit((m) => removeQuestion(m, key))
        announce(`השאלה "${name}" נמחקה`)
      },
    })
  }

  const typeSelect = (
    <div>
      <Select
        lbl='סוג התשובה'
        value={type}
        onChange={(e) => changeType(e.target.value as AnswerType)}
        options={ANSWER_TYPES.map((t) => ({ id: t.value, name: t.label }))}
      />
      <p className='mt-1 text-xs text-gray-500'>{ANSWER_TYPES.find((t) => t.value === type)?.hint}</p>
    </div>
  )

  return (
    <article
      id={cardDomId(key)}
      aria-labelledby={`${id}-title`}
      onFocusCapture={onFocus}
      onBlurCapture={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) onLeave()
      }}
      className={`grid scroll-mt-24 gap-4 rounded-lg border bg-white p-5 ${conditional ? 'ms-8 border-s-4 border-s-gray-300' : ''} ${
        issues.some((i) => i.severity === 'error') ? 'border-red-300' : 'border-gray-200'
      }`}
    >
      <header className='flex flex-wrap items-center justify-between gap-2'>
        <h3 id={`${id}-title`} className='text-base font-semibold text-ink'>
          שאלה {index + 1}
          <span className='font-normal text-gray-600'> · {name}</span>
        </h3>
        <div className='flex items-center gap-1'>
          <Btn
            type='button'
            size='small'
            variant='ghost'
            icon='arrow-up'
            aria-label={`העברת השאלה "${name}" למעלה`}
            onClick={() => move(-1)}
            disabled={index === 0}
          />
          <Btn
            type='button'
            size='small'
            variant='ghost'
            icon='arrow-down'
            aria-label={`העברת השאלה "${name}" למטה`}
            onClick={() => move(1)}
            disabled={index === count - 1}
          />
          <Btn type='button' size='small' variant='ghost' icon='trash' aria-label={`מחיקת השאלה "${name}"`} onClick={remove} />
        </div>
      </header>

      {conditional && when}

      <section className='grid gap-2' aria-labelledby={`${id}-see`}>
        <h4 id={`${id}-see`} className='text-sm font-semibold text-gray-700'>
          מה הלקוח יראה
        </h4>
        <label htmlFor={`${id}-prompt`} className='sr-only'>
          נוסח השאלה
        </label>
        <textarea
          id={`${id}-prompt`}
          rows={Math.min(8, Math.max(2, question.prompt.split('\n').length + 1))}
          maxLength={900}
          value={question.prompt}
          placeholder='למשל: איזה שירות מעניין אתכם?'
          onChange={(e) => edit((m) => setPrompt(m, key, e.target.value))}
          aria-invalid={promptIssue}
          className='rounded-md border border-gray-200 bg-white px-3 py-2.5 text-sm leading-relaxed focus:outline-2 focus:outline-primary aria-invalid:border-red-500'
        />
        <div className='flex flex-wrap items-center gap-2'>
          <label htmlFor={`${id}-label`} className='text-xs text-gray-600'>
            שם קצר לסיכום שהנציג מקבל
          </label>
          <input
            id={`${id}-label`}
            value={question.label}
            maxLength={40}
            placeholder='למשל: סוג השירות'
            onChange={(e) => edit((m) => updateQuestion(m, key, { label: e.target.value }))}
            aria-invalid={labelIssue}
            className='h-8 min-w-0 flex-1 rounded-md border border-gray-200 bg-white px-2.5 text-sm focus:outline-2 focus:outline-primary aria-invalid:border-red-500 sm:max-w-64'
          />
        </div>
      </section>

      <section className='grid gap-3' aria-labelledby={`${id}-answer`}>
        <h4 id={`${id}-answer`} className='text-sm font-semibold text-gray-700'>
          איך הלקוח יכול לענות
        </h4>
        {type === 'free' ? (
          <TextAnswerSettings question={question} edit={edit} leading={typeSelect} />
        ) : (
          <>
            <div className='sm:max-w-[calc(50%-0.5rem)]'>{typeSelect}</div>
            <OptionsEditor
              model={model}
              question={question}
              edit={edit}
              issues={issues}
              confirm={confirm}
              allowAllEnabled={allowAllEnabled}
            />
          </>
        )}
      </section>

      {!conditional && when}

      {ownIssues.length > 0 && (
        <ul className='grid gap-1 rounded-md bg-red-50 px-3 py-2' aria-label={`דברים לתקן בשאלה "${name}"`}>
          {ownIssues.map((i, n) => (
            <li key={n} className={i.severity === 'warning' ? 'text-sm text-amber-800' : 'text-sm text-red-700'}>
              {i.severity === 'warning' ? 'המלצה: ' : ''}
              {cardIssueText(i)}
            </li>
          ))}
        </ul>
      )}
    </article>
  )
}
