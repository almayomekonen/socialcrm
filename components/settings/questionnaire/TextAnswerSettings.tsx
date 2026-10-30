'use client'

import { useId, useState, type ReactNode } from 'react'
import { Checkbox, Select } from '@/lib/form'
import { keyOf, setNotSetAllowed, updateQuestion } from '@/lib/inbox/autoresponse/questionnaire/builder/editorOps'
import type { BuilderQuestion, BuilderQuestionnaire } from '@/lib/inbox/autoresponse/questionnaire/builder/model'
import { textCheckOf, type TextCheck } from './builderCopy'
import { textChecksIn } from './copyIn'
import { useT } from '@/lib/i18n/I18nProvider'
import { customerTextAttrs } from '@/lib/i18n/config'
import { applyTextCheck } from './answerCheck'

type Edit = (change: (m: BuilderQuestionnaire) => BuilderQuestionnaire) => void

/**
 * How a free-text answer is checked, in product words.
 *
 * "מיקום / מקום" is a Builder preset: the runtime check is the same as
 * "תשובה משמעותית" and the preset only adds location wording. A loaded
 * question shows as מיקום when its not-understood message is about a location.
 *
 * The two messages are optional and hidden until asked for: a normal question
 * needs neither, and the runtime's own fallback lines are sensible.
 */
export default function TextAnswerSettings({
  question,
  edit,
  leading,
}: {
  question: BuilderQuestion
  edit: Edit
  /** The answer-type select, drawn on the same line as the check. */
  leading: ReactNode
}) {
  const id = useId()
  const t = useT()
  const checks = textChecksIn(t)
  const key = keyOf(question)
  const messages = question.messages ?? {}
  const looksLikeLocation = question.answer.kind === 'text' && /מיקום|מקום/.test(messages.notUnderstood ?? '')
  const [chosen, setChosen] = useState<TextCheck | null>(null)
  const base = textCheckOf(question.answer.kind)
  const location = base === 'meaningful' && (chosen === null ? looksLikeLocation : chosen === 'location')
  const check: TextCheck = location ? 'location' : base
  const notSetAllowed = 'notSetAllowed' in question.answer ? question.answer.notSetAllowed : false
  const custom = Boolean(messages.notUnderstood || messages.askAgainAfterQuestion)
  // Closed by default even when set: a loaded questionnaire should read short.
  const [advancedOpen, setAdvancedOpen] = useState(false)

  const pick = (next: TextCheck) => {
    setChosen(next)
    edit((m) => applyTextCheck(m, key, next))
  }

  const setMessage = (field: 'notUnderstood' | 'askAgainAfterQuestion', value: string) =>
    edit((m) => updateQuestion(m, key, { messages: { ...messages, [field]: value.length ? value : undefined } }))

  return (
    <div className='grid gap-3'>
      <div className='grid gap-x-4 gap-y-3 sm:grid-cols-2'>
        {leading}
        <div>
          <Select
            lbl={t('admin.questionnaire.text.check')}
            value={check}
            onChange={(e) => pick(e.target.value as TextCheck)}
            options={checks.map((c) => ({ id: c.value, name: c.label }))}
          />
          <p className='mt-1 text-xs text-gray-500'>{checks.find((c) => c.value === check)?.hint}</p>
        </div>
      </div>

      {check !== 'none' && (
        <Checkbox
          lbl={t('admin.questionnaire.text.notSet')}
          checked={notSetAllowed}
          onChange={(e) => edit((m) => setNotSetAllowed(m, key, e.target.checked))}
        />
      )}

      {check !== 'none' && (
        <div>
          <button
            type='button'
            aria-expanded={advancedOpen}
            aria-controls={`${id}-messages`}
            onClick={() => setAdvancedOpen((o) => !o)}
            className='text-xs text-gray-600 underline underline-offset-2'
          >
            {advancedOpen ? t('admin.questionnaire.text.hideMessages') : t('admin.questionnaire.text.showMessages')}
            {!advancedOpen && custom && <span className='text-gray-500 no-underline'>{t('admin.questionnaire.text.custom')}</span>}
          </button>
          {advancedOpen && (
            <div id={`${id}-messages`} className='mt-2 grid gap-3'>
              <MessageField
                id={`${id}-invalid`}
                label={t('admin.questionnaire.text.invalidLabel')}
                hint={t('admin.questionnaire.text.invalidHint')}
                value={messages.notUnderstood ?? ''}
                onChange={(v) => setMessage('notUnderstood', v)}
              />
              <MessageField
                id={`${id}-reask`}
                label={t('admin.questionnaire.text.reaskLabel')}
                hint={t('admin.questionnaire.text.reaskHint')}
                value={messages.askAgainAfterQuestion ?? ''}
                onChange={(v) => setMessage('askAgainAfterQuestion', v)}
              />
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function MessageField({
  id,
  label,
  hint,
  value,
  onChange,
}: {
  id: string
  label: string
  hint: string
  value: string
  onChange: (v: string) => void
}) {
  const { locale } = useT()
  return (
    <div className='grid gap-1'>
      <label htmlFor={id} className='text-sm text-gray-700'>
        {label}
      </label>
      <textarea
        id={id}
        rows={2}
        maxLength={900}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-describedby={`${id}-hint`}
        {...customerTextAttrs(locale)}
        className='rounded-md border border-gray-200 bg-white px-2.5 py-2 text-sm focus:outline-2 focus:outline-primary'
      />
      <p id={`${id}-hint`} className='text-xs text-gray-500'>
        {hint}
      </p>
    </div>
  )
}
