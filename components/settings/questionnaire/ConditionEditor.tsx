'use client'

import { useId } from 'react'
import { Select } from '@/lib/form'
import { describeCondition, questionName } from '@/lib/inbox/autoresponse/questionnaire/builder/conditionText'
import { keyOf, optionsOf, type Condition } from '@/lib/inbox/autoresponse/questionnaire/builder/editorOps'
import type { BuilderQuestion, BuilderQuestionnaire } from '@/lib/inbox/autoresponse/questionnaire/builder/model'

/**
 * "מתי?" as a sentence the owner builds: pick an earlier question, tick the
 * answers. The result is read back in words ("סוג האירוע הוא חתונה או חינה"),
 * never as a rule.
 *
 * One condition per question or ending, as the runtime supports today. The
 * model already holds a list (model.ts `shownWhen.conditions`), so a later
 * "and also…" row extends this component rather than replacing it.
 */
export default function ConditionEditor({
  model,
  sources,
  condition,
  onChange,
  allowAlways,
  legend,
  sentencePrefix,
}: {
  model: BuilderQuestionnaire
  /** Questions this condition may depend on. */
  sources: BuilderQuestion[]
  condition: Condition | null
  onChange: (next: Condition | null) => void
  /** Questions may appear always; a custom ending always has a condition. */
  allowAlways: boolean
  legend: string
  sentencePrefix: string
}) {
  const id = useId()
  const conditional = condition !== null || !allowAlways
  const source = condition ? sources.find((q) => keyOf(q) === condition.questionId) : undefined
  const sentence = describeCondition(model, condition)

  if (!sources.length) {
    return (
      <fieldset className='grid gap-2'>
        <legend className='text-sm font-semibold text-gray-700'>{legend}</legend>
        <p className='text-sm text-gray-600'>
          {allowAlways ? 'השאלה מופיעה תמיד. ' : ''}כדי לבחור לפי תשובה, צריכה להיות לפני כן שאלה עם אפשרויות לבחירה.
        </p>
      </fieldset>
    )
  }

  const pickSource = (questionKey: string) => onChange(questionKey ? { questionId: questionKey, anyOf: [] } : null)
  const toggle = (optionKey: string, on: boolean) => {
    if (!condition) return
    const anyOf = on ? [...condition.anyOf, optionKey] : condition.anyOf.filter((k) => k !== optionKey)
    onChange({ ...condition, anyOf })
  }

  return (
    <fieldset className='grid gap-3'>
      <legend className='text-sm font-semibold text-gray-700'>{legend}</legend>

      {allowAlways && (
        <div className='flex flex-wrap gap-x-6 gap-y-2'>
          <label className='flex items-center gap-2 text-sm'>
            <input
              type='radio'
              name={`${id}-mode`}
              className='accent-solid'
              checked={!conditional}
              onChange={() => onChange(null)}
            />
            תמיד
          </label>
          <label className='flex items-center gap-2 text-sm'>
            <input
              type='radio'
              name={`${id}-mode`}
              className='accent-solid'
              checked={conditional}
              onChange={() => pickSource(keyOf(sources[sources.length - 1]))}
            />
            רק לפי תשובה קודמת
          </label>
        </div>
      )}

      {conditional && (
        <div className='grid gap-3 rounded-md border border-gray-200 bg-gray-50 p-3'>
          <Select
            lbl='לפי התשובה לשאלה'
            value={condition?.questionId ?? ''}
            onChange={(e) => pickSource(e.target.value)}
            placeholder={allowAlways ? undefined : 'בחרו שאלה'}
            options={sources.map((q) => ({ id: keyOf(q), name: questionName(q) }))}
          />
          {source && (
            <div role='group' aria-label='התשובות שבהן זה קורה' className='flex flex-wrap gap-x-5 gap-y-1.5'>
              <p className='w-full text-sm text-gray-700'>כשהלקוח בחר:</p>
              {optionsOf(source).map((o) => (
                <label key={keyOf(o)} className='flex items-center gap-2 text-sm'>
                  <input
                    type='checkbox'
                    className='size-4 accent-solid'
                    checked={condition?.anyOf.includes(keyOf(o)) ?? false}
                    onChange={(e) => toggle(keyOf(o), e.target.checked)}
                  />
                  {o.label.trim() || 'אפשרות ללא שם'}
                </label>
              ))}
            </div>
          )}
        </div>
      )}

      {sentence && (
        <p className='text-sm text-gray-800'>
          <span className='font-medium'>{sentencePrefix}</span> {sentence}
        </p>
      )}
    </fieldset>
  )
}
