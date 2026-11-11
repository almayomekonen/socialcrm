'use client'

import { useId, useRef } from 'react'
import { Btn } from '@/lib/btns/Btn'
import { useAutoGrow } from '@/hooks/useAutoGrow'
import { AGENT_PROFILE_LIMITS as L } from '@/lib/inbox/autoresponse/conversational/agentProfile'

type Faq = { question: string; answer: string }

/**
 * "שאלות נפוצות" — the ready answers the agent quotes from, moved out of
 * `AutoResponseAgentProfile.tsx` (which crossed the soft limit) with three
 * changes: adding a question is a real secondary button, an empty list explains
 * itself with ONE example, and the answer box grows with its text.
 *
 * The example is shown, never pre-filled. A pre-filled pair would be saved as a
 * real answer the agent then gives customers — an invented business fact.
 *
 * Hebrew AI configuration (owner order: not localized); the caller renders it
 * inside the agent profile's declared Hebrew region.
 */
const inputClass =
  'mt-2 block w-full rounded-md border border-gray-200 bg-white px-4 py-2.5 text-sm outline-none focus:outline-2 focus:outline-offset-0 focus:outline-primary'

const EXAMPLE = { question: 'כמה זמן מראש צריך להזמין?', answer: 'מומלץ חודשיים מראש, ולפעמים יש מקום גם בהתראה קצרה.' }

export default function AgentFaqEditor({ value, onChange }: { value: Faq[]; onChange: (next: Faq[]) => void }) {
  const faqId = useId()
  const setFaq = (i: number, patch: Partial<Faq>) => onChange(value.map((f, j) => (j === i ? { ...f, ...patch } : f)))

  return (
    <div>
      <h3 id={faqId} className='text-sm font-semibold text-gray-700'>
        שאלות נפוצות
      </h3>
      <p className='mt-0.5 text-xs leading-relaxed text-gray-500'>הסוכן עונה מהתשובות שלכם בלבד, ולא מוסיף עליהן</p>

      <div className='mt-2 flex flex-col gap-4' aria-labelledby={faqId}>
        {value.length === 0 && (
          <div className='rounded-lg border border-dashed border-gray-300 bg-white px-4.5 py-3.5' data-faq-empty>
            <p className='text-sm text-gray-700'>עוד לא הוספתם שאלות נפוצות. לדוגמה:</p>
            <dl className='mt-2 text-sm leading-relaxed text-gray-600'>
              <dt className='font-medium text-gray-700'>{EXAMPLE.question}</dt>
              <dd className='mt-0.5'>{EXAMPLE.answer}</dd>
            </dl>
          </div>
        )}

        {value.map((f, i) => (
          <FaqItem key={i} index={i} idBase={faqId} faq={f} onChange={(patch) => setFaq(i, patch)} onRemove={() => onChange(value.filter((_, j) => j !== i))} />
        ))}

        {value.length < L.faqItems && (
          <div>
            <Btn type='button' variant='outline' icon='plus' lbl='הוספת שאלה נפוצה' onClick={() => onChange([...value, { question: '', answer: '' }])} />
          </div>
        )}
      </div>
    </div>
  )
}

function FaqItem({ index: i, idBase, faq, onChange, onRemove }: { index: number; idBase: string; faq: Faq; onChange: (patch: Partial<Faq>) => void; onRemove: () => void }) {
  const answerRef = useRef<HTMLTextAreaElement>(null)
  useAutoGrow(answerRef, faq.answer)
  return (
    <div className='rounded-lg border border-gray-200 bg-white px-4.5 py-3.5'>
      <label className='text-sm font-medium text-gray-700' htmlFor={`${idBase}-q${i}`}>
        שאלה {i + 1}
      </label>
      <input
        id={`${idBase}-q${i}`}
        type='text'
        value={faq.question}
        maxLength={L.faqQuestion}
        onChange={(e) => onChange({ question: e.target.value })}
        placeholder={`למשל: ${EXAMPLE.question}`}
        className={inputClass}
      />
      <label className='mt-3 block text-sm font-medium text-gray-700' htmlFor={`${idBase}-a${i}`}>
        התשובה
      </label>
      <textarea
        ref={answerRef}
        id={`${idBase}-a${i}`}
        rows={2}
        value={faq.answer}
        maxLength={L.faqAnswer}
        onChange={(e) => onChange({ answer: e.target.value })}
        placeholder={`למשל: ${EXAMPLE.answer}`}
        className={`${inputClass} resize-none overflow-hidden leading-relaxed`}
      />
      <button type='button' className='mt-2.5 text-sm font-medium text-gray-700 underline underline-offset-2' onClick={onRemove}>
        הסרת השאלה
      </button>
    </div>
  )
}
