'use client'

import { keyOf, setNotSetAllowed } from '@/lib/inbox/autoresponse/questionnaire/builder/editorOps'
import { applyTextCheck, currentTextCheck } from '../answerCheck'
import { useFlowEditor } from './flowContext'

const EXPECT = [
  { value: 'any', label: 'כל תשובה' },
  { value: 'date', label: 'תאריך' },
  { value: 'location', label: 'מיקום / מקום' },
] as const

/** "איזו תשובה אנחנו מצפים לקבל?" for a free-text question, and "not decided yet" where it applies. */
export default function FlowTextAnswer({ questionKey: key }: { questionKey: string }) {
  const { model, edit } = useFlowEditor()
  const question = model.questions.find((q) => keyOf(q) === key)
  if (!question) return null
  const expect = currentTextCheck(question)
  return (
    <div className='grid gap-1.5'>
      <label className='text-xs text-gray-600' htmlFor={`${key}-expect`}>
        איזו תשובה אנחנו מצפים לקבל?
      </label>
      <select
        id={`${key}-expect`}
        value={expect === 'date' || expect === 'location' ? expect : 'any'}
        onChange={(e) => {
          const next = e.target.value
          if (next === 'any' && (expect === 'none' || expect === 'meaningful')) return
          edit((m) => applyTextCheck(m, key, next === 'any' ? 'meaningful' : (next as 'date' | 'location')))
        }}
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
  )
}
