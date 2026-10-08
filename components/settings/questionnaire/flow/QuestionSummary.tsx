'use client'

import { Handle, Position } from '@xyflow/react'
import { keyOf, optionsOf } from '@/lib/inbox/autoresponse/questionnaire/builder/editorOps'
import type { BuilderQuestion } from '@/lib/inbox/autoresponse/questionnaire/builder/model'
import type { EditorIssue } from '@/lib/inbox/autoresponse/questionnaire/builder/editorView'
import { currentTextCheck } from '../answerCheck'

const EXPECT_LABEL = { none: 'כל תשובה', meaningful: 'כל תשובה', date: 'תאריך', location: 'מיקום / מקום' } as const

/**
 * A question at rest on the map: what the customer reads, and the answers they
 * can pick, the way WhatsApp numbers them. No fields, no settings: the map is
 * for seeing the conversation. Clicking the box opens its editor in place.
 */
export default function QuestionSummary({
  question,
  number,
  onlyFor,
  issues,
  onEdit,
  routed,
}: {
  question: BuilderQuestion
  number: number
  onlyFor: string | null
  issues: EditorIssue[]
  onEdit: () => void
  /** Whether this answer's own route leaves from this side ('l' or 'r'). */
  routed: (optionKey: string, side: 'l' | 'r') => boolean
}) {
  const options = optionsOf(question)
  const errors = issues.filter((i) => i.severity === 'error')
  const prompt = question.prompt.trim()
  return (
    <div
      dir='rtl'
      className={`grid w-[300px] gap-2 rounded-xl border bg-white p-3 shadow-sm ${errors.length ? 'border-red-300' : 'border-gray-200'}`}
    >
      <Handle type='target' position={Position.Top} id='in' isConnectable={false} className='!opacity-0' />
      <div className='flex items-center justify-between gap-2'>
        <p className='text-xs font-semibold text-gray-500'>שאלה {number}</p>
        <button
          type='button'
          onClick={onEdit}
          aria-label={`עריכת שאלה ${number}${prompt ? `: ${prompt.slice(0, 40)}` : ''}`}
          className='nodrag rounded px-1.5 text-xs text-primary hover:underline focus-visible:outline-2 focus-visible:outline-primary'
        >
          עריכה
        </button>
      </div>
      {onlyFor && (
        <p className='rounded-md bg-indigo-50 px-2 py-1 text-xs text-indigo-900'>
          נשאלת רק מי שבחר: <span className='font-medium'>{onlyFor}</span>
        </p>
      )}
      <p className={`line-clamp-3 whitespace-pre-line text-sm leading-relaxed ${prompt ? 'text-ink' : 'text-gray-400'}`}>
        {prompt || 'עוד לא נכתבה שאלה'}
      </p>
      {options.length > 0 ? (
        <ol className='grid gap-1'>
          {options.map((o, i) => (
            <li key={o.ref ?? o.id} className='relative rounded-md bg-gray-50 px-2 py-1 text-sm text-gray-800'>
              {i + 1}. {o.label.trim() || <span className='text-gray-400'>תשובה ללא שם</span>} {o.icon}
              <Handle
                type='source'
                position={Position.Left}
                id={`opt-${keyOf(o)}-l`}
                isConnectable={false}
                className={`!size-2 !min-h-0 !min-w-0 !border-0 !bg-indigo-400 ${routed(keyOf(o), 'l') ? '' : '!opacity-0'}`}
              />
              <Handle
                type='source'
                position={Position.Right}
                id={`opt-${keyOf(o)}-r`}
                isConnectable={false}
                className={`!size-2 !min-h-0 !min-w-0 !border-0 !bg-indigo-400 ${routed(keyOf(o), 'r') ? '' : '!opacity-0'}`}
              />
            </li>
          ))}
        </ol>
      ) : (
        <p className='text-xs text-gray-500'>תשובה חופשית · {EXPECT_LABEL[currentTextCheck(question)]}</p>
      )}
      {errors.length > 0 && <p className='text-xs font-medium text-red-700'>יש כאן מה להשלים. לחצו לעריכה.</p>}
      <Handle type='source' position={Position.Bottom} id='next' isConnectable={false} className='!opacity-0' />
    </div>
  )
}
